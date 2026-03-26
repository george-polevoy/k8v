import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { AddressInfo } from 'node:net';
import { createApp } from '../src/app.ts';
import { DataStore } from '../src/core/DataStore.ts';
import { NodeExecutor } from '../src/core/NodeExecutor.ts';
import { GraphEngine } from '../src/core/GraphEngine.ts';
import { buildGraphCommandsFromGraphUpdate, type GraphCommand } from '../../domain/dist/index.js';
import {
  buildBulkEditAlgoWasmBuffer,
  buildComputeRejectAlgoWasmBuffer,
  buildGraphGetAlgoWasmBuffer,
  buildGraphQueryAlgoWasmBuffer,
  buildInfiniteLoopAlgoWasmBuffer,
  buildMissingRunAlgoWasmBuffer,
} from './wasmTestUtils.ts';

interface AppTestContext {
  baseUrl: string;
  dataStore: DataStore;
  tmpDir: string;
  close: () => Promise<void>;
}

function createNumericInputNode(id: string, value: number) {
  return {
    id,
    type: 'numeric_input',
    position: { x: 0, y: 0 },
    metadata: {
      name: `Numeric ${id}`,
      inputs: [],
      outputs: [{ name: 'value', schema: { type: 'number' } }],
    },
    config: {
      type: 'numeric_input',
      config: {
        value,
        min: 0,
        max: 100,
        step: 1,
      },
    },
    version: '1',
  };
}

async function setupTestServer(): Promise<AppTestContext> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'k8v-algo-invocation-test-'));
  const dataStore = new DataStore(':memory:', tmpDir);
  const nodeExecutor = new NodeExecutor(dataStore);
  const graphEngine = new GraphEngine(dataStore, nodeExecutor);
  const app = createApp({ dataStore, graphEngine });
  const server = app.listen(0);
  const port = (server.address() as AddressInfo).port;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    dataStore,
    tmpDir,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      dataStore.close();
      await fs.rm(tmpDir, { recursive: true, force: true });
    },
  };
}

async function writeWasmFile(tmpDir: string, fileName: string, buffer: Buffer): Promise<string> {
  const wasmPath = path.join(tmpDir, fileName);
  await fs.writeFile(wasmPath, buffer);
  return wasmPath;
}

async function fetchGraph(baseUrl: string, graphId: string) {
  const response = await fetch(`${baseUrl}/api/graphs/${graphId}`);
  assert.equal(response.status, 200);
  return await response.json();
}

async function submitGraphCommands(
  baseUrl: string,
  graphId: string,
  baseRevision: number,
  commands: GraphCommand[],
) {
  return await fetch(`${baseUrl}/api/graphs/${graphId}/commands`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      baseRevision,
      commands,
    }),
  });
}

async function createGraph(
  baseUrl: string,
  name: string,
  seedPayload?: Record<string, unknown>,
) {
  const createResponse = await fetch(`${baseUrl}/api/graphs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  assert.equal(createResponse.status, 200);
  const created = await createResponse.json();

  if (seedPayload && Object.keys(seedPayload).length > 0) {
    const commands = buildGraphCommandsFromGraphUpdate(seedPayload);
    if (commands.length > 0) {
      const currentGraph = await fetchGraph(baseUrl, created.id);
      const updateResponse = await submitGraphCommands(
        baseUrl,
        created.id,
        currentGraph.revision ?? 0,
        commands
      );
      assert.equal(updateResponse.status, 200);
    }
  }

  return await fetchGraph(baseUrl, created.id);
}

async function invokeAlgoInjection(params: {
  baseUrl: string;
  graphId: string;
  wasmPath: string;
  entrypoint?: string;
  input?: unknown;
  noRecompute?: boolean;
}) {
  return await fetch(`${params.baseUrl}/api/graphs/${params.graphId}/algo/invoke`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      wasmPath: params.wasmPath,
      entrypoint: params.entrypoint,
      input: params.input,
      noRecompute: params.noRecompute,
    }),
  });
}

test('algo invoke requires an absolute wasm path and validates the requested entrypoint', async () => {
  const context = await setupTestServer();
  try {
    const graph = await createGraph(context.baseUrl, 'algo-invalid-invoke');

    const relativePath = await invokeAlgoInjection({
      baseUrl: context.baseUrl,
      graphId: graph.id,
      wasmPath: 'relative/module.wasm',
    });
    assert.equal(relativePath.status, 400);
    const relativePayload = await relativePath.json();
    assert.match(relativePayload.error, /absolute filesystem path/i);

    const missingRunPath = await writeWasmFile(
      context.tmpDir,
      'missing-run.wasm',
      await buildMissingRunAlgoWasmBuffer()
    );
    const missingRun = await invokeAlgoInjection({
      baseUrl: context.baseUrl,
      graphId: graph.id,
      wasmPath: missingRunPath,
    });
    assert.equal(missingRun.status, 400);
    const missingRunPayload = await missingRun.json();
    assert.match(missingRunPayload.error, /must export run/i);
  } finally {
    await context.close();
  }
});

test('algo invoke returns JSON output and can read graph state through graph_get', async () => {
  const context = await setupTestServer();
  try {
    const graph = await createGraph(context.baseUrl, 'algo-graph-get', {
      nodes: [createNumericInputNode('n-1', 7)],
    });
    const wasmPath = await writeWasmFile(
      context.tmpDir,
      'graph-get.wasm',
      await buildGraphGetAlgoWasmBuffer()
    );

    const invokeResponse = await invokeAlgoInjection({
      baseUrl: context.baseUrl,
      graphId: graph.id,
      wasmPath,
      input: { ignored: true },
    });
    assert.equal(invokeResponse.status, 200);
    const invoked = await invokeResponse.json();
    assert.equal(invoked.wasmPath, wasmPath);
    assert.equal(invoked.entrypoint, 'run');
    assert.equal(invoked.result.id, graph.id);
    assert.equal(invoked.result.nodes.length, 1);
    assert.deepEqual(invoked.stagedCommands, []);
  } finally {
    await context.close();
  }
});

test('algo invoke can call graph_query and bulk_edit stages are committed once', async () => {
  const context = await setupTestServer();
  try {
    const graph = await createGraph(context.baseUrl, 'algo-query-edit', {
      nodes: [createNumericInputNode('n-1', 9)],
    });

    const queryInvoke = await invokeAlgoInjection({
      baseUrl: context.baseUrl,
      graphId: graph.id,
      wasmPath: await writeWasmFile(
        context.tmpDir,
        'graph-query.wasm',
        await buildGraphQueryAlgoWasmBuffer()
      ),
    });
    assert.equal(queryInvoke.status, 200);
    const queryPayload = await queryInvoke.json();
    assert.equal(queryPayload.result.nodes[0].id, 'n-1');

    const editInvoke = await invokeAlgoInjection({
      baseUrl: context.baseUrl,
      graphId: graph.id,
      wasmPath: await writeWasmFile(
        context.tmpDir,
        'rename.wasm',
        await buildBulkEditAlgoWasmBuffer('Renamed by algo')
      ),
      input: { anything: true },
      noRecompute: true,
    });
    assert.equal(editInvoke.status, 200);
    const editPayload = await editInvoke.json();
    assert.equal(editPayload.stagedCommands.length, 1);
    assert.equal(editPayload.graph.name, 'Renamed by algo');

    const renamedGraph = await fetchGraph(context.baseUrl, graph.id);
    assert.equal(renamedGraph.name, 'Renamed by algo');
  } finally {
    await context.close();
  }
});

test('algo invoke rejects compute commands and preserves graph state on timeout', async () => {
  const context = await setupTestServer();
  try {
    const rejectGraph = await createGraph(context.baseUrl, 'algo-reject-timeout');

    const rejectInvoke = await invokeAlgoInjection({
      baseUrl: context.baseUrl,
      graphId: rejectGraph.id,
      wasmPath: await writeWasmFile(
        context.tmpDir,
        'reject-compute.wasm',
        await buildComputeRejectAlgoWasmBuffer()
      ),
    });
    assert.equal(rejectInvoke.status, 400);
    const rejectPayload = await rejectInvoke.json();
    assert.match(rejectPayload.error, /does not allow compute_graph/i);

    const timeoutGraph = await createGraph(context.baseUrl, 'algo-timeout', {
      executionTimeoutMs: 25,
    });
    const timeoutInvoke = await invokeAlgoInjection({
      baseUrl: context.baseUrl,
      graphId: timeoutGraph.id,
      wasmPath: await writeWasmFile(
        context.tmpDir,
        'timeout.wasm',
        await buildInfiniteLoopAlgoWasmBuffer()
      ),
    });
    assert.equal(timeoutInvoke.status, 400);
    const timeoutPayload = await timeoutInvoke.json();
    assert.match(timeoutPayload.error, /timed out/i);

    const afterTimeout = await fetchGraph(context.baseUrl, timeoutGraph.id);
    assert.equal(afterTimeout.name, timeoutGraph.name);
  } finally {
    await context.close();
  }
});
