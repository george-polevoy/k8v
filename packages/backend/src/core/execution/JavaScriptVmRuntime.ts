import vm from 'node:vm';
import { ExecutionRuntime, ExecutionRequest, ExecutionResult } from './types.js';

/**
 * JavaScript runtime backed by Node's vm module.
 * This is an intermediate step toward stronger isolate/container runtimes.
 */
export class JavaScriptVmRuntime implements ExecutionRuntime {
  async execute(request: ExecutionRequest): Promise<ExecutionResult> {
    const textOutputLines: string[] = [];
    const graphicsOutputs: string[] = [];
    const outputs: Record<string, any> = {};

    const formatOutput = (...args: any[]): string => {
      return args
        .map((arg) => (typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)))
        .join(' ');
    };

    const logFn = (...args: any[]) => {
      textOutputLines.push(formatOutput(...args));
    };

    const contextObject = {
      inputs: request.inputs,
      outputs,
      print: logFn,
      log: logFn,
      console: {
        log: logFn,
        error: logFn,
        warn: logFn,
        info: logFn,
      },
      outputGraphics: (data: string) => {
        graphicsOutputs.push(data);
      },
      outputImage: (imageData: string) => {
        graphicsOutputs.push(imageData);
      },
    };

    try {
      const context = vm.createContext(contextObject, {
        codeGeneration: {
          strings: false,
          wasm: false,
        },
      });
      const script = new vm.Script(request.code, { filename: 'inline-node.js' });
      script.runInContext(context, { timeout: request.timeoutMs ?? 5000 });

      return {
        outputs,
        textOutput: textOutputLines.length > 0 ? textOutputLines.join('\n') : undefined,
        graphicsOutput: graphicsOutputs.length > 0 ? graphicsOutputs[graphicsOutputs.length - 1] : undefined,
      };
    } catch (error: any) {
      return {
        outputs: {},
        textOutput: `Error: ${error?.message ?? String(error)}`,
      };
    }
  }
}
