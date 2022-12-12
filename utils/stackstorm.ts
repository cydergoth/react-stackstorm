import {
  createMachine,
  assign,
  interpret,
  spawn,
  actions,
  ActionObject,
  ActorRef,
  State
} from 'xstate';
import { waitFor } from "xstate/lib/waitFor";

const ST2_API_EXECUTIONS = "/st2api/v1/executions";
const ST2_API_AUTH = "/lifecycle/api/v1/user/auth";

// Define the pure function for xstate
// https://xstate.js.org/docs/guides/actions.html#pure-action
const { pure } = actions;
const { log } = actions;

import {
  StackstormExecRequest,
  StackstormResult,
  StackstormExecId
} from "../types/stackstorm.d"

export type { StackstormExecLog, StackstormExecId, StackstormResult } from "../types/stackstorm.d";

export interface StackstormWorkflowTimeline {
  timestamp: Date,
  status: string,
  id: StackstormExecId,
  name: string
}

// Result of an entire workflow tree
export interface Execution<T> {
  result?: StackstormResult<T>;
  id: StackstormExecId;
  children: Map<StackstormExecId, ActorRef<StackstormEvent, State<StackstormChildStateContext, StackstormEvent, any, any, any>>>; //Map of actors processing a child workflow status
  resume?: string; // State to resume from after a retry
  error?: Response; // Error result from the fetch call
}

export const timeline = (workflows: Map<StackstormExecId, StackstormResult<any>>): StackstormWorkflowTimeline[] => {
  console.log("Timeline", workflows);
  const logs = new Array<StackstormWorkflowTimeline>();
  workflows.forEach((value, key) => {
    value.log?.map((l) => logs.push({ timestamp: new Date(Date.parse(l.timestamp)), status: l.status, id: key, name: value.action.name }));
  });
  const sortedTimeline = logs.sort(
    (objA, objB) => objA.timestamp.getTime() - objB.timestamp.getTime(),
  );
  console.log("Stored timeline", sortedTimeline);
  return sortedTimeline;
}

interface StackstormStateContext<T> extends Execution<T> {
  request?: StackstormExecRequest;
}

interface StackstormChildStateContext extends Execution<any> {
}

type StackstormEvent = { type: 'EXEC'; request: StackstormExecRequest }
  | { type: 'ERROR' }
  ;

class FetchError extends Error {
  readonly res: Response;

  constructor(message: string, res: Response) {
    super(message);
    this.res = res;
    this.name = 'FetchError';
  }
}

// Magic function to exhange user's SSO credentials for a Stackstorm token
// This uses a relay API exposed by the lifecycle service so we don't
// expose the ST2 auth endpoint directly
const st2_auth = async (context: any, _: any): Promise<any> => {
  console.log("Authenticating");
  return fetch(ST2_API_AUTH, {
    method: "GET",
    cache: "no-cache"
  }).then((res) => {
    if (!res.ok) {
      console.log("Auth failed", res);
      throw new FetchError("Stackstorm Auth failed: " + res.statusText, res);
    } else {
      return res;
    }
  }).then((res) => res);
}

export const executeStackstormAction = async <T>(request: StackstormExecRequest, callback: (e: any) => void) => {

  const st2_create_execution = async (context: StackstormStateContext<T>, _: any): Promise<StackstormResult<T>> => {
    return fetch(ST2_API_EXECUTIONS, {
      method: "POST",
      body: JSON.stringify({
        action: context.request?.action as string,
        parameters: context.request?.parameters,
        user: null,
      }),
      headers: {
        "Content-type": "application/json; charset=UTF-8"
      },
      cache: "no-cache"
    }).then((res) => {
      if (!res.ok) {
        console.log("Create failed", res);
        throw new FetchError("Stackstorm Job Creation failed: " + res.statusText, res);
      } else {
        return res;
      }
    }).then((res) => res.json() as unknown as StackstormResult<T>);
  }

  const st2_poll_execution = async (context: Execution<T>, _: any): Promise<StackstormResult<T>> => {
    console.log("poll", context);
    return fetch(ST2_API_EXECUTIONS + "/" + context.id, {
      method: "GET",
      headers: {
        "Content-type": "application/json; charset=UTF-8"
      },
      cache: "no-cache"
    }).then((res) => {
      if (!res.ok) {
        throw new FetchError("Stackstorm Job Poll failed: " + res.statusText, res);
      } else {
        return res;
      }
    }).then((res) => res.json() as unknown as StackstormResult<T>);
  }

  // `pure` xstate function to return new actors for previously unknown children
  // https://xstate.js.org/docs/guides/actions.html#pure-action
  const childActors = pure((ctx: StackstormStateContext<T>): ActionObject<any, any>[] | undefined => {
    console.log("Childactors", ctx);
    return ctx.result?.children?.reduce<ActionObject<any, any>[]>((result: ActionObject<any, any>[], childId) => { // Reduce the array of child IDs to an array of actions to construct new child state machines for unknown children
      if (!(ctx.children?.has(childId))) { // Child does not already exist
        const action = assign({
          children: (child_ctx: StackstormChildStateContext, event) => child_ctx.children.set(childId, spawn(createChildMachine(childId)))
        });
        result.push(action); // Append a new action to create a new child
      };

      console.log("New actions", result);
      return result;
    }, new Array<ActionObject<any, any>>());
  });

  const createChildMachine = (childId: StackstormExecId) => {
    return createMachine<StackstormChildStateContext, StackstormEvent>({
      id: 'childStackstormState',
      initial: 'polling',
      predictableActionArguments: true,
      context: {
        id: childId,
        children: new Map<StackstormExecId, any>()
      } as StackstormChildStateContext,
      on: {
        ERROR: { target: ".error" }
      },
      states: {
        maybe_retry: { // Stackstorm API call failed, check to see if it's a token refresh or a hard fail
          always: [
            { target: 'retry_auth', cond: (context, event) => context.error instanceof FetchError && context.error.res.status == 401 },
            { target: 'error' }
          ]
        },
        retry_auth: { // Authentication error, call the auth function to refresh the token and retry
          invoke: {
            src: 'st2_auth',
            onDone: { target: 'auth_done' },
            onError: { target: 'error' }
          }
        },
        auth_done: {
          always: [
            { target: 'polling', cond: (context, event) => context.resume === 'polling' },
            { target: 'error' }
          ]
        },
        delaying: {
          after: {
            1000: { target: 'polling' }
          }
        },
        polling: {
          entry: [
            log((context, event) => context, 'polling child')
          ],
          invoke: {
            src: "st2_poll_execution",
            onDone: {
              target: 'check_final',
              actions: [
                assign({ result: (ctx, event) => event.data }),
                (context, event) => callback({ "result": event.data, "id": event.data.id })
              ]
            },
            onError: {
              target: 'maybe_retry',
              actions: [
                assign({ resume: (context, event) => 'polling' }),
                assign({ error: (context, event) => event.data })
              ]
            }
          }
        },
        check_final: {
          entry: childActors,
          always:
            [
              { target: 'complete', cond: (context: StackstormStateContext<T>) => (context.result?.status === "succeeded" || context.result?.status === "failed") },
              { target: 'delaying', cond: (context: StackstormStateContext<T>) => !(context.result?.status === "succeeded" || context.result?.status === "failed") },
            ]

        },
        error: {
          type: 'final'
        },
        complete: {
          type: 'final'
        }
      }
    }, {
      services: {
        "st2_poll_execution": st2_poll_execution,
        "st2_auth": st2_auth
      }
    });
  }

  const stackstormStateMachine = createMachine<StackstormStateContext<T>, StackstormEvent>({
    id: 'stacksformState',
    initial: 'setup',
    predictableActionArguments: true,
    context: {} as StackstormStateContext<T>,
    on: {
      ERROR: { target: ".error" }
    },
    states: {
      setup: { /// Wait for a job request
        on: {
          EXEC: {
            target: "creating",
            actions: [assign({ request: (context, event: any) => event.request })]
          }
        }
      },
      creating: { // Create the job in stackstorm
        invoke: {
          src: 'st2_create_execution',
          onDone: {
            target: 'delaying',
            actions: [
              assign({
                result: (context, event) => event.data,
                id: (ctx, event) => event.data.id,
                children: (ctx, event) => new Map<StackstormExecId, ActorRef<StackstormEvent, State<StackstormChildStateContext, StackstormEvent, any, any, any>>>()
              }),
              (context, event) => callback({ "result": event.data, "id": event.data.id })
            ]
          },
          onError: {
            target: 'maybe_retry',
            actions: [
              assign({ resume: (context, event) => 'creating' }),
              assign({ error: (context, event) => { console.log("Error", event.data); return event.data; } })
            ]
          }
        }
      },
      maybe_retry: { // Stackstorm API call failed, check to see if it's a token refresh or a hard fail
        always: [
          { target: 'retry_auth', cond: (context, event) => context.error instanceof FetchError && context.error.res.status == 401 },
          { target: 'error' }
        ]
      },
      retry_auth: { // Authentication error, call the auth function to refresh the token and retry
        invoke: {
          src: 'st2_auth',
          onDone: { target: 'auth_done' },
          onError: { target: 'error' }
        }
      },
      auth_done: {
        always: [
          { target: 'creating', cond: (context, event) => context.resume === 'creating' },
          { target: 'polling', cond: (context, event) => context.resume === 'polling' },
        ]
      },
      delaying: {
        after: {
          1000: { target: 'polling' }
        }
      },
      polling: {
        invoke: {
          src: "st2_poll_execution",
          onDone: {
            target: 'check_final',
            actions: [
              assign({ result: (ctx, event) => event.data }),
              (context, event) => callback({ "result": event.data, "id": event.data.id })
            ]
          },
          onError: {
            target: 'maybe_retry',
            actions: [
              assign({ resume: (context, event) => 'polling' }),
              assign({ error: (context, event) => event.data })
            ]
          }
        }
      },
      check_final: {
        entry: childActors,
        always:
          [
            { target: 'complete', cond: (context: StackstormStateContext<T>) => (context.result?.status === "succeeded" || context.result?.status === "failed") },
            { target: 'delaying', cond: (context: StackstormStateContext<T>) => !(context.result?.status === "succeeded" || context.result?.status === "failed") },
          ]
      },
      error: {
        type: 'final'
      },
      complete: {
        type: 'final'
      }
    }
  },
    {
      services: {
        "st2_create_execution": st2_create_execution,
        "st2_poll_execution": st2_poll_execution,
        "st2_auth": st2_auth
      }
    }
  );

  const service = interpret(stackstormStateMachine);
  console.log("Service created");
  service.start();
  console.log("Service started");
  service.send('EXEC', { request: request });
  console.log("First transition");
  await waitFor(service, (state) => state.matches('complete'), { timeout: 60000 });
  service.stop();
  return;
}
