type StackstormExecId = string;
type StackstormActionRef = string;

export type StackstormParam = string | number | boolean | any[];

export interface StackstormExecRequest {
  action: StackstormActionRef;
  parameters: Map<string, StackstormParam>;
  delay?: number;
}

export interface StackstormParamDef {
  description: string;
  required: boolean;
  type: string;
  default: StackstormParam;
  _name?: string;
  enum?: any[];
}

export interface StackstormAction {
  tags: any[];
  uid: string;
  metadata_file: string;
  name: string;
  ref: StackstormActionRef;
  description: string;
  enabled: boolean;
  entry_point: string;
  pack: string;
  runner_type: string;
  parameters: Map<string, StackstormParamDef>;
  output_schema: Map<string, any>; // TODO: Type this
  notify: Map<string, any>; // TODO: Type this
  id: StackstormExecId;
}

export interface StackstormLiveAction {
  id: StackstormExecId;
  action: StackstormActionRef;
  action_is_workflow: boolean;
  parameters: Map<string, StackstormParam>;
  callback: any; // TODO: Type this
  runner_info: Map<string, string | number>;
}

export interface StackstormRBAC {
  user: string;
  roles: string[];
}

export interface StackstormContext {
  workflow_execution: StackstormExecId;
  user: string;
  pack: string;
  rbac: StackstormRBAC;
}

export interface StackstormExecLog {
  timestamp: string;
  status: string; // TODO: maybe enum?
}

export interface OrquestraResult<T> {
  output: T;
  errors: any[]; // TODO: Type this
}

export interface StackstormRunner {
  name: string;
  description: string;
  uid: string;
  enabled: boolean;
  runner_package: string;
  runner_module: string;
  runner_parameters: any;
  output_key: string;
  output_schema: any;
  id: StackstormExecId
}

export interface StackstormResult<T> {
  action: StackstormAction;
  runner: any; // TODO: Type this
  liveaction: StackstormLiveAction;
  status: string;
  start_timestamp: string;
  end_timestamp: string;
  parameters: Map<string, StackstormParam>;
  result_size: number;
  context: StackstormContext;
  children?: StackstormExecId[];
  log: StackstormExecLog[];
  web_url: string;
  id: StackstormExecId;
  result: OrquestraResult<T>;
  elapsed_seconds: number;
}
