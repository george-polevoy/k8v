import { isWasmBinary } from '../wasmArtifacts.js';
import {
  isWasmMemory,
  requireWasmApi,
  unwrapWasmInstance,
  type WasmImports,
  type WasmInstanceLike,
} from './wasmApi.js';

export const DEFAULT_ALGO_INJECTION_ENTRYPOINT = 'run';
export const WASM_ALGO_IMPORT_MODULE = 'k8v';
export const WASM_ALGO_GRAPH_GET_IMPORT = 'graph_get';
export const WASM_ALGO_GRAPH_QUERY_IMPORT = 'graph_query';
export const WASM_ALGO_BULK_EDIT_IMPORT = 'bulk_edit';
export const WASM_ALGO_ALLOWED_IMPORTS = new Set([
  WASM_ALGO_GRAPH_GET_IMPORT,
  WASM_ALGO_GRAPH_QUERY_IMPORT,
  WASM_ALGO_BULK_EDIT_IMPORT,
]);

export class WasmAlgoValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WasmAlgoValidationError';
  }
}

export function createStubAlgoImports(): WasmImports {
  return {
    [WASM_ALGO_IMPORT_MODULE]: {
      [WASM_ALGO_GRAPH_GET_IMPORT]: () => 0n,
      [WASM_ALGO_GRAPH_QUERY_IMPORT]: (_ptr: number, _len: number) => 0n,
      [WASM_ALGO_BULK_EDIT_IMPORT]: (_ptr: number, _len: number) => 0n,
    },
  };
}

function validateAlgoImports(module: unknown): void {
  const wasmApi = requireWasmApi();
  for (const descriptor of wasmApi.Module.imports(module)) {
    if (descriptor.kind !== 'function') {
      throw new WasmAlgoValidationError(
        `Unsupported wasm import ${descriptor.module}.${descriptor.name}; only function imports are allowed`
      );
    }

    if (descriptor.module !== WASM_ALGO_IMPORT_MODULE) {
      throw new WasmAlgoValidationError(
        `Unsupported wasm import module "${descriptor.module}"; expected "${WASM_ALGO_IMPORT_MODULE}"`
      );
    }

    if (!WASM_ALGO_ALLOWED_IMPORTS.has(descriptor.name)) {
      throw new WasmAlgoValidationError(
        `Unsupported wasm import "${descriptor.module}.${descriptor.name}"`
      );
    }
  }
}

function validateAlgoExports(instance: WasmInstanceLike, entrypoint: string): void {
  if (!isWasmMemory(instance.exports.memory)) {
    throw new WasmAlgoValidationError('Wasm algo must export memory');
  }

  if (typeof instance.exports.alloc !== 'function') {
    throw new WasmAlgoValidationError('Wasm algo must export alloc(len: i32) -> i32');
  }

  if (typeof instance.exports[entrypoint] !== 'function') {
    throw new WasmAlgoValidationError(`Wasm algo must export ${entrypoint}(input_ptr: i32, input_len: i32)`);
  }
}

export async function validateWasmAlgoBinary(
  buffer: Buffer,
  entrypoint: string = DEFAULT_ALGO_INJECTION_ENTRYPOINT
): Promise<void> {
  if (!isWasmBinary(buffer)) {
    throw new WasmAlgoValidationError('Wasm module payload does not start with the WebAssembly magic header');
  }

  const wasmApi = requireWasmApi();
  let module: unknown;
  try {
    module = await wasmApi.compile(buffer);
  } catch (error) {
    throw new WasmAlgoValidationError(
      `Wasm module could not be compiled: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  validateAlgoImports(module);

  let instance: WasmInstanceLike;
  try {
    instance = unwrapWasmInstance(await wasmApi.instantiate(module, createStubAlgoImports()));
  } catch (error) {
    throw new WasmAlgoValidationError(
      `Wasm module could not be instantiated: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  validateAlgoExports(instance, entrypoint);
}
