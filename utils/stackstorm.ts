import {
  createMachine,
  assign,
  interpret,
  State,
} from 'xstate';
import { waitFor } from "xstate/lib/waitFor";
import { FetchError } from "./fetch";
import { st2_auth } from "./stackstormAuth";
import { CallbackEvent, WorkflowExecution, ChildWorkflowRef } from "./types.d";
import { pollStackstormAction } from "./pollStackstorm";

const ST2_API_EXECUTIONS = "/st2api/v1/executions";

import {
  StackstormExecRequest,
  StackstormResult,
  StackstormExecId
} from "../types/stackstorm.d"

export type { StackstormExecLog, StackstormExecId, StackstormResult } from "../types/stackstorm.d";

// Type of events used in the state machines
type StackstormEvent = { type: 'EXEC'; request: StackstormExecRequest }
  | { type: 'ERROR' }
  ;

// Extended context used when creating the Stackstorm job machine
interface StackstormStateCtx<T> extends WorkflowExecution<T> {
  request?: StackstormExecRequest;
}

export const executeStackstormAction = async <T>(request: StackstormExecRequest, callback: (e: CallbackEvent<T>) => void, timeout: number = 60000) => {

  const st2_create_execution = async (ctx: StackstormStateCtx<T>, _: any): Promise<StackstormResult<T>> => {
    return fetch(ST2_API_EXECUTIONS, {
      method: "POST",
      body: JSON.stringify({
        action: ctx.request?.action as string,
        parameters: ctx.request?.parameters,
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

  const pollMachine = pollStackstormAction<T>("", callback);

  const stackstormStateMachine = createMachine<StackstormStateCtx<T>, StackstormEvent>({
    id: 'stackstormState',
    initial: 'setup',
    predictableActionArguments: true,
    context: {} as StackstormStateCtx<T>,
    on: {
      ERROR: { target: ".error" }
    },
    states: {
      setup: { /// Wait for a job request
        on: {
          EXEC: {
            target: "creating",
            actions: [assign({ request: (_, event: any) => event.request })]
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
                result: (_, event: any) => event.data,
                id: (_, event: any) => event.data.id,
                children: (_, event: any) => new Map<StackstormExecId, ChildWorkflowRef>()
              }),
              (_, event: any) => callback({ "result": event.data, "id": event.data.id })
            ]
          },
          onError: {
            target: 'maybe_retry',
            actions: [
              assign({ resume: (_, event: any) => 'creating' }),
              assign({ error: (_, event: any) => { console.log("Error", event.data); return event.data; } })
            ]
          }
        }
      },
      maybe_retry: { // Stackstorm API call failed, check to see if it's a token refresh or a hard fail
        always: [
          { target: 'retry_auth', cond: (ctx: StackstormStateCtx<T>) => ctx.error instanceof FetchError && ctx.error.res.status == 401 },
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
          { target: 'creating', cond: (ctx: StackstormStateCtx<T>) => ctx.resume === 'creating' },
          { target: 'polling', cond: (ctx: StackstormStateCtx<T>) => ctx.resume === 'polling' },
        ]
      },
      delaying: {
        after: {
          1000: { target: 'polling' }
        }
      },
      polling: {
        invoke: {
          src: pollMachine,
          data: {
            id: (ctx: StackstormStateCtx<T>, event: any) => ctx.id,
            children: () => new Map<StackstormExecId, ChildWorkflowRef>()
          },
          onError: {
            target: 'maybe_retry',
            actions: [
              assign({ resume: (_, event: any) => 'polling' }),
              assign({ error: (_, event: any) => { console.log("Error", event.data); return event.data; } })
            ]
          },
          onDone: {
            target: 'complete'
          }
        }
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
        "st2_auth": st2_auth
      }
    }
  );

  const service = interpret(stackstormStateMachine);
  service.start();
  service.send('EXEC', { request: request });
  // waitFor throws an Error if the timeout is exceeded
  await waitFor(service, (state: State<StackstormStateCtx<T>, StackstormEvent, any, any, any>) => state.matches('complete'), { timeout: timeout });
  service.stop();
  return;
}
