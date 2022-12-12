import {
  StackstormExecRequest,
  StackstormResult,
  StackstormExecId
} from "../types/stackstorm.d"

// Reference to a child workflow of the main workflow. Note that the result type of
// these is always `any` as we only pass the final result back up to the caller
export type ChildWorkflowRef = ActorRef<StackstormEvent, State<WorkflowExecution<any>, StackstormEvent, any, any, any>>;

// Result of an entire workflow tree
export interface WorkflowExecution<T> {
  result?: StackstormResult<T>;
  id: StackstormExecId;
  children: Map<StackstormExecId, ChildWorkflowRef>; // Map of actors processing a child workflow status
  resume?: string; // State to resume from after a retry
  error?: Response; // Error result from the fetch call
}

// Type of the event the callback receives
export interface CallbackEvent<T> {
  result: StackstormResult<T>;
  id: StackstormExecId;
}
