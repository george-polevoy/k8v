export interface WasmMemoryLike {
  buffer: ArrayBufferLike;
}

export interface WasmInstanceLike {
  exports: Record<string, unknown>;
}

export interface WasmImportDescriptor {
  module: string;
  name: string;
  kind: string;
}

export type WasmHostFunction = (...args: number[]) => number | bigint;
export type WasmImports = Record<string, Record<string, WasmHostFunction>>;

interface WasmNamespace {
  Memory: new (...args: unknown[]) => WasmMemoryLike;
  Module: {
    imports(module: unknown): WasmImportDescriptor[];
  };
  compile(source: Buffer): Promise<unknown>;
  instantiate(source: unknown, imports?: WasmImports): Promise<unknown>;
}

export function requireWasmApi(): WasmNamespace {
  const wasmApi = (globalThis as typeof globalThis & { WebAssembly?: WasmNamespace }).WebAssembly;
  if (!wasmApi) {
    throw new Error('WebAssembly runtime is not available in this Node.js process');
  }
  return wasmApi;
}

export function unwrapWasmInstance(result: unknown): WasmInstanceLike {
  if (isWasmInstance(result)) {
    return result;
  }
  if (
    result &&
    typeof result === 'object' &&
    'instance' in result &&
    isWasmInstance((result as { instance?: unknown }).instance)
  ) {
    return (result as { instance: WasmInstanceLike }).instance;
  }
  throw new Error('Unexpected WebAssembly instantiation result');
}

export function isWasmMemory(value: unknown): value is WasmMemoryLike {
  return value instanceof requireWasmApi().Memory;
}

function isWasmInstance(value: unknown): value is WasmInstanceLike {
  return Boolean(value && typeof value === 'object' && 'exports' in value);
}
