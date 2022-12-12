import {
  createMachine,
  assign,
  spawn,
  actions,
  ActionObject,
} from 'xstate';
import { FetchError } from "./fetch";
import { WorkflowExecution, ChildWorkflowRef, CallbackEvent } from "./types.d";
import { st2_auth } from "./stackstormAuth";

const ST2_API_EXECUTIONS = "/st2api/v1/executions";

// Define the pure function for xstate
// https://xstate.js.org/docs/guides/actions.html#pure-action
const { pure } = actions;

import {
  StackstormResult,
  StackstormExecId
} from "../types/stackstorm.d"

// xstate service to call the ST2 API
const st2_poll_execution = async <T>(ctx: WorkflowExecution<T>, _: any): Promise<StackstormResult<T>> => {
  return fetch(ST2_API_EXECUTIONS + "/" + ctx.id, {
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

type SpawnChildAction = ActionObject<any, any>;

// Poll the state of an existing action or workflow execution (including children)
export const pollStackstormAction = <T>(id: StackstormExecId, callback: (e: CallbackEvent<T>) => void) => {
  console.log("Creating poll state machine", id);

  // `pure` xstate function to return new actors for previously unknown children
  // https://xstate.js.org/docs/guides/actions.html#pure-action
  const spawnChildActors = pure((ctx: WorkflowExecution<T>): SpawnChildAction[] | undefined => {
    // Reduce the array of child IDs to an array of actions to construct new child state machines for unknown children
    return ctx.result?.children?.reduce<SpawnChildAction[]>(
      (result: SpawnChildAction[], childId: StackstormExecId) => {
        if (!(ctx.children?.has(childId))) { // Child does not already exist
          const action: SpawnChildAction = assign({
            children: (child_ctx: any) => child_ctx.children.set(childId, spawn(pollStackstormAction<any>(childId, callback)))
          });
          result.push(action); // Append a new action to create a new child
        };
        return result;
      }, new Array<SpawnChildAction>()
    );
  });

  const workflowMachine = createMachine<WorkflowExecution<T>, any>({
    id: 'childStackstormWorkflowState',
    initial: 'polling',
    predictableActionArguments: true,
    context: {
      id: id,
      children: new Map<StackstormExecId, ChildWorkflowRef>()
    } as WorkflowExecution<T>,
    on: {
      // Any event of type error goes straight to state 'error'
      ERROR: { target: ".error" }
    },
    states: {
      maybe_retry: { // Stackstorm API call failed, check to see if it's a token refresh or a hard fail
        always: [
          {
            target: 'retry_auth',
            cond: (ctx: WorkflowExecution<T>) => (ctx.error instanceof FetchError && ctx.error.res.status == 401)
          },
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
          { target: 'polling', cond: (ctx: WorkflowExecution<T>) => ctx.resume === 'polling' },
          { target: 'error' }
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
              assign({ result: (_, event: any) => event.data }),
              (_: any, event: any) => callback({ "result": event.data, "id": event.data.id })
            ]
          },
          onError: {
            target: 'maybe_retry',
            actions: [
              assign({ resume: (_, event: any) => 'polling' }),
              assign({ error: (_, event: any) => event.data })
            ]
          }
        }
      },
      check_final: {
        // Check to see if this workflow has completed. Also spawns child flows if needed
        entry: spawnChildActors,
        always:
          [
            { target: 'complete', cond: (ctx: WorkflowExecution<T>) => (ctx.result?.status === "succeeded" || ctx.result?.status === "failed") },
            { target: 'delaying', cond: (ctx: WorkflowExecution<T>) => !(ctx.result?.status === "succeeded" || ctx.result?.status === "failed") },
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
      "st2_poll_execution": st2_poll_execution<T>,
      "st2_auth": st2_auth
    }
  });

  console.log("Poll state machine", workflowMachine);
  return workflowMachine;
}
