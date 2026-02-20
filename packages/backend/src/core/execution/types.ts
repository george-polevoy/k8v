export interface ExecutionRequest {
  code: string;
  inputs: Record<string, any>;
  timeoutMs?: number;
}

export interface ExecutionResult {
  outputs: Record<string, any>;
  textOutput?: string;
  graphicsOutput?: string;
}

export interface ExecutionRuntime {
  execute(request: ExecutionRequest): Promise<ExecutionResult>;
}

export const DEFAULT_RUNTIME_ID = 'javascript_vm';
