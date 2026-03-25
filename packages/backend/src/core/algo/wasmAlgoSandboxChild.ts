import process from 'node:process';
import { z } from 'zod';
import {
  applyGraphCommandMutation,
  Graph,
  GraphCommand,
  GraphQueryRequestSchema,
  type Graph as GraphType,
  type GraphCommand as GraphCommandType,
} from '../../types/index.js';
import { executeGraphQuery } from '../graphQuery.js';
import {
  isWasmMemory,
  requireWasmApi,
  unwrapWasmInstance,
  type WasmImports,
  type WasmInstanceLike,
} from './wasmApi.js';

const decoder = new TextDecoder();
const encoder = new TextEncoder();
const PackedPtrLenShift = 32n;
const CommandListSchema = z.array(GraphCommand).min(1);

interface SandboxRequest {
  graph: GraphType;
  wasmBase64: string;
  entrypoint: string;
  input: unknown;
}

interface SandboxResponse {
  result: unknown;
  stagedCommands: GraphCommandType[];
}

async function main(): Promise<void> {
  const raw = await readStdin();
  const payload = JSON.parse(raw) as SandboxRequest;
  const graph = Graph.parse(payload.graph);
  const wasmBuffer = Buffer.from(payload.wasmBase64, 'base64');
  const executionResult = await executeSandboxedAlgo({
    graph,
    wasmBuffer,
    entrypoint: payload.entrypoint,
    input: payload.input,
  });
  writeWrappedResult(executionResult);
}

async function executeSandboxedAlgo(params: {
  graph: GraphType;
  wasmBuffer: Buffer;
  entrypoint: string;
  input: unknown;
}): Promise<SandboxResponse> {
  let stagedGraph = structuredClone(params.graph);
  const stagedCommands: GraphCommandType[] = [];
  let instance: WasmInstanceLike | null = null;

  const writeJsonToGuest = (value: unknown): bigint => {
    if (!instance) {
      throw new Error('Wasm instance is not ready');
    }
    const memory = readMemory(instance);
    const alloc = readAlloc(instance);
    const bytes = encoder.encode(JSON.stringify(value));
    const ptr = alloc(bytes.byteLength);
    memory().set(bytes, ptr);
    return packPtrLen(ptr, bytes.byteLength);
  };

  const imports: WasmImports = {
    k8v: {
      graph_get: () => writeJsonToGuest(stagedGraph),
      graph_query: (ptr: number, len: number) => {
        const request = GraphQueryRequestSchema.parse(readJsonFromGuest(instance, ptr, len));
        const result = executeGraphQuery(stagedGraph, request);
        return writeJsonToGuest(result);
      },
      bulk_edit: (ptr: number, len: number) => {
        const parsedCommands = CommandListSchema.parse(readJsonFromGuest(instance, ptr, len));
        for (const command of parsedCommands) {
          if (command.kind === 'compute_graph' || command.kind === 'compute_node') {
            throw new Error(`Algo bulk_edit does not allow ${command.kind}`);
          }
          stagedGraph = applyGraphCommandMutation(stagedGraph, command);
          stagedCommands.push(command);
        }

        return writeJsonToGuest({
          commandCount: parsedCommands.length,
          graph: stagedGraph,
        });
      },
    },
  };

  const wasmApi = requireWasmApi();
  instance = unwrapWasmInstance(await wasmApi.instantiate(params.wasmBuffer, imports));
  const run = readEntrypoint(instance, params.entrypoint);
  const inputRef = writeJsonToGuest(params.input);
  const inputSlice = unpackPtrLen(inputRef);
  const resultRef = run(inputSlice.ptr, inputSlice.len);
  const resultSlice = unpackPtrLen(resultRef);
  const result = readJsonFromGuest(instance, resultSlice.ptr, resultSlice.len);

  return {
    result,
    stagedCommands,
  };
}

function readMemory(instance: WasmInstanceLike): () => Uint8Array {
  const memory = instance.exports.memory;
  if (!isWasmMemory(memory)) {
    throw new Error('Wasm algo must export memory');
  }

  return () => new Uint8Array(memory.buffer);
}

function readAlloc(instance: WasmInstanceLike): (len: number) => number {
  const alloc = instance.exports.alloc;
  if (typeof alloc !== 'function') {
    throw new Error('Wasm algo must export alloc(len: i32) -> i32');
  }

  return (len: number) => {
    const ptr = alloc(len);
    if (typeof ptr !== 'number' || !Number.isInteger(ptr) || ptr < 0) {
      throw new Error('Wasm alloc must return a non-negative i32 pointer');
    }
    return ptr;
  };
}

function readEntrypoint(
  instance: WasmInstanceLike,
  entrypoint: string
): (ptr: number, len: number) => number | bigint {
  const exported = instance.exports[entrypoint];
  if (typeof exported !== 'function') {
    throw new Error(`Wasm algo must export ${entrypoint}(input_ptr: i32, input_len: i32)`);
  }

  return (ptr: number, len: number) => exported(ptr, len) as number | bigint;
}

function readJsonFromGuest(
  instance: WasmInstanceLike | null,
  ptr: number,
  len: number
): unknown {
  if (!instance) {
    throw new Error('Wasm instance is not ready');
  }
  if (!Number.isInteger(ptr) || ptr < 0) {
    throw new Error(`Invalid wasm pointer ${ptr}`);
  }
  if (!Number.isInteger(len) || len < 0) {
    throw new Error(`Invalid wasm length ${len}`);
  }

  const memory = readMemory(instance)();
  const end = ptr + len;
  if (end > memory.byteLength) {
    throw new Error('Wasm pointer/length exceeded exported memory bounds');
  }

  return JSON.parse(decoder.decode(memory.slice(ptr, end)));
}

function packPtrLen(ptr: number, len: number): bigint {
  return (BigInt(len >>> 0) << PackedPtrLenShift) | BigInt(ptr >>> 0);
}

function unpackPtrLen(value: number | bigint): { ptr: number; len: number } {
  const packed = typeof value === 'bigint' ? value : BigInt(value >>> 0);
  return {
    ptr: Number(packed & 0xffffffffn),
    len: Number((packed >> PackedPtrLenShift) & 0xffffffffn),
  };
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function writeWrappedResult(result: SandboxResponse): void {
  const resultGuid = process.env.K8V_RESULT_GUID?.trim();
  if (!resultGuid) {
    throw new Error('Missing K8V_RESULT_GUID');
  }
  const marker = `<${resultGuid}>`;
  process.stdout.write(`${marker}${JSON.stringify(result)}${marker}`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});
