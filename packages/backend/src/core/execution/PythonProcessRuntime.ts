import { ExecutionRequest, ExecutionResult, ExecutionRuntime } from './types.js';
import {
  PythonExecutionManager,
  PythonExecutionTimeoutError,
} from './PythonExecutionManager.js';

export class PythonProcessRuntime implements ExecutionRuntime {
  private readonly pythonBin: string;
  private readonly timeoutRetryCount: number;
  private readonly executionManager: PythonExecutionManager;

  constructor(
    pythonBin: string = process.env.K8V_PYTHON_BIN || 'python3',
    timeoutRetryCount = 1,
    executionManager?: PythonExecutionManager
  ) {
    this.pythonBin = pythonBin;
    this.timeoutRetryCount = Math.max(0, Math.floor(timeoutRetryCount));
    this.executionManager = executionManager ?? new PythonExecutionManager();
  }

  async execute(request: ExecutionRequest): Promise<ExecutionResult> {
    const timeoutMs = request.timeoutMs ?? 30_000;
    const pythonBin = request.pythonBin ?? this.pythonBin;

    try {
      const maxAttempts = this.timeoutRetryCount + 1;
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
          return await this.executionManager.execute({
            code: request.code,
            inputs: request.inputs ?? {},
            timeoutMs,
            pythonBin,
            cwd: request.cwd,
            graphId: request.graphId,
            workerConcurrencyHint: request.workerConcurrencyHint,
          });
        } catch (error) {
          if (error instanceof PythonExecutionTimeoutError) {
            if (attempt < maxAttempts) {
              continue;
            }
            const retrySuffix = maxAttempts > 1 ? ` after ${maxAttempts} attempts` : '';
            return {
              outputs: {},
              textOutput: `Error: Script execution timed out${retrySuffix}`,
            };
          }
          throw error;
        }
      }

      return {
        outputs: {},
        textOutput: 'Error: Python runtime did not produce a result',
      };
    } catch (error: any) {
      const errorMessage = error?.message ?? String(error);
      return {
        outputs: {},
        textOutput: `Error: ${errorMessage}`,
      };
    }
  }

  async dropGraph(graphId: string): Promise<void> {
    await this.executionManager.dropGraph(graphId);
  }

  async dispose(): Promise<void> {
    await this.executionManager.dispose();
  }

  getActiveServiceCount(): number {
    return this.executionManager.getActiveServiceCount();
  }
}
