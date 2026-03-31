export interface ExecutionMeta {
  custom: Record<string, unknown>;
  graph: {
    id: string | null;
    name: string | null;
  };
  node: {
    id: string;
    name: string;
  };
}

export interface ExecutionRequest {
  code: string;
  inputs: Record<string, any>;
  meta?: ExecutionMeta;
  timeoutMs?: number;
  pythonBin?: string;
  cwd?: string;
  graphId?: string;
  workerConcurrencyHint?: number;
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
export const PYTHON_RUNTIME_ID = 'python_process';
