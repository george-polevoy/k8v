import fs from 'node:fs/promises';
import path from 'node:path';
import {
  normalizeGraphExecutionTimeoutMs,
} from '../types/index.js';
import { GraphCommandService } from './GraphCommandService.js';
import { DataStore } from './DataStore.js';
import { runWasmAlgoSandbox, WasmAlgoSandboxError } from './algo/WasmAlgoSandbox.js';
import {
  DEFAULT_ALGO_INJECTION_ENTRYPOINT,
  validateWasmAlgoBinary,
  WasmAlgoValidationError,
} from './algo/wasmAlgoValidation.js';

export class WasmAlgoRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WasmAlgoRequestError';
  }
}

export class WasmAlgoExecutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WasmAlgoExecutionError';
  }
}

export class WasmAlgoService {
  constructor(
    private readonly dataStore: DataStore,
    private readonly graphCommandService: GraphCommandService,
  ) {}

  async invokeWasmFile(params: {
    graphId: string;
    wasmPath: string;
    entrypoint?: string;
    input: unknown;
    noRecompute?: boolean;
  }): Promise<{
    status: 'ok';
    commandCount: number;
  }> {
    const graph = await this.requireGraph(params.graphId);
    const resolvedWasmPath = await resolveWasmPath(params.wasmPath);
    const entrypoint = (params.entrypoint ?? DEFAULT_ALGO_INJECTION_ENTRYPOINT).trim();
    if (!entrypoint) {
      throw new WasmAlgoRequestError('Wasm algo entrypoint must not be empty');
    }

    let wasmBuffer: Buffer;
    try {
      wasmBuffer = await fs.readFile(resolvedWasmPath);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new WasmAlgoRequestError(`Failed to read wasm file ${resolvedWasmPath}: ${message}`);
    }

    try {
      await validateWasmAlgoBinary(wasmBuffer, entrypoint);
    } catch (error) {
      if (error instanceof WasmAlgoValidationError) {
        throw new WasmAlgoRequestError(error.message);
      }
      throw error;
    }

    let sandboxResult;
    try {
      sandboxResult = await runWasmAlgoSandbox({
        graph,
        wasm: wasmBuffer,
        entrypoint,
        input: params.input,
        timeoutMs: normalizeGraphExecutionTimeoutMs(graph.executionTimeoutMs),
      });
    } catch (error) {
      if (error instanceof WasmAlgoSandboxError) {
        throw new WasmAlgoExecutionError(error.message);
      }
      throw error;
    }

    if (sandboxResult.stagedCommands.length === 0) {
      return {
        status: 'ok',
        commandCount: 0,
      };
    }

    await this.graphCommandService.executeCommands(
      graph.id,
      graph.revision,
      sandboxResult.stagedCommands,
      {
        noRecompute: params.noRecompute,
      }
    );

    return {
      status: 'ok',
      commandCount: sandboxResult.stagedCommands.length,
    };
  }

  private async requireGraph(graphId: string) {
    const graph = await this.dataStore.getGraph(graphId);
    if (!graph) {
      throw new Error(`Graph ${graphId} not found`);
    }
    return graph;
  }
}

async function resolveWasmPath(rawPath: string): Promise<string> {
  const trimmed = rawPath.trim();
  if (!trimmed) {
    throw new WasmAlgoRequestError('Wasm path must not be empty');
  }
  if (!path.isAbsolute(trimmed)) {
    throw new WasmAlgoRequestError('Wasm path must be an absolute filesystem path');
  }

  const resolvedPath = path.resolve(trimmed);
  let stat;
  try {
    stat = await fs.stat(resolvedPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new WasmAlgoRequestError(`Wasm path ${resolvedPath} is not readable: ${message}`);
  }

  if (!stat.isFile()) {
    throw new WasmAlgoRequestError(`Wasm path ${resolvedPath} must point to a file`);
  }

  return resolvedPath;
}

export {
  GraphRevisionConflictError,
} from './GraphCommandService.js';
