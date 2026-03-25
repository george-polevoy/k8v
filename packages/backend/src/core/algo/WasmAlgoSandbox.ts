import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Graph, GraphCommand } from '../../types/index.js';

const WASM_ALGO_SANDBOX_CHILD_JS_PATH = fileURLToPath(
  new URL('./wasmAlgoSandboxChild.js', import.meta.url)
);
const WASM_ALGO_SANDBOX_CHILD_TS_PATH = fileURLToPath(
  new URL('./wasmAlgoSandboxChild.ts', import.meta.url)
);

interface WasmAlgoSandboxRequest {
  graph: Graph;
  wasmBase64: string;
  entrypoint: string;
  input: unknown;
}

interface WasmAlgoSandboxResponse {
  result: unknown;
  stagedCommands: GraphCommand[];
}

export class WasmAlgoSandboxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WasmAlgoSandboxError';
  }
}

export async function runWasmAlgoSandbox(params: {
  graph: Graph;
  wasm: Buffer;
  entrypoint: string;
  input: unknown;
  timeoutMs: number;
}): Promise<WasmAlgoSandboxResponse> {
  const payload: WasmAlgoSandboxRequest = {
    graph: params.graph,
    wasmBase64: params.wasm.toString('base64'),
    entrypoint: params.entrypoint,
    input: params.input,
  };
  const resultGuid = randomUUID();
  const resultMarker = `<${resultGuid}>`;
  const childPath = existsSync(WASM_ALGO_SANDBOX_CHILD_JS_PATH)
    ? WASM_ALGO_SANDBOX_CHILD_JS_PATH
    : WASM_ALGO_SANDBOX_CHILD_TS_PATH;
  const childArgs = [...process.execArgv, childPath];

  return await new Promise<WasmAlgoSandboxResponse>((resolve, reject) => {
    const child = spawn(process.execPath, childArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        K8V_RESULT_GUID: resultGuid,
      },
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;

    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, params.timeoutMs);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });

    child.on('error', (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeoutHandle);
      reject(error);
    });

    child.on('close', (code, signal) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeoutHandle);

      if (timedOut) {
        reject(new WasmAlgoSandboxError('Wasm algo execution timed out'));
        return;
      }

      if (signal) {
        reject(new WasmAlgoSandboxError(`Wasm algo sandbox terminated by signal ${signal}`));
        return;
      }

      if (code !== 0) {
        reject(new WasmAlgoSandboxError(
          `Wasm algo sandbox exited with code ${code}${stderr.trim() ? `\n${stderr.trim()}` : ''}`
        ));
        return;
      }

      const parsedPayload = extractResultPayload(stdout, resultMarker);
      if (!parsedPayload) {
        reject(new WasmAlgoSandboxError(
          `Wasm algo sandbox returned no wrapped payload${stderr.trim() ? `\n${stderr.trim()}` : ''}`
        ));
        return;
      }

      try {
        const parsed = JSON.parse(parsedPayload) as WasmAlgoSandboxResponse;
        resolve(parsed);
      } catch (error) {
        reject(new WasmAlgoSandboxError(
          `Wasm algo sandbox returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`
        ));
      }
    });

    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}

function extractResultPayload(stdout: string, resultMarker: string): string | undefined {
  const startIndex = stdout.indexOf(resultMarker);
  if (startIndex === -1) {
    return undefined;
  }

  const payloadStart = startIndex + resultMarker.length;
  const endIndex = stdout.indexOf(resultMarker, payloadStart);
  if (endIndex === -1) {
    return undefined;
  }

  return stdout.slice(payloadStart, endIndex);
}
