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
  buildBulkEditAlgoWasmBase64,
  buildComputeRejectAlgoWasmBase64,
  buildEchoAlgoWasmBase64,
  buildGraphGetAlgoWasmBase64,
  buildGraphQueryAlgoWasmBase64,
  buildInfiniteLoopAlgoWasmBase64,
  buildMissingRunAlgoWasmBase64,
} from './wasmTestUtils.ts';

interface AppTestContext {
  baseUrl: string;
  dataStore: DataStore;
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
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'k8v-algo-injection-test-'));
  const dataStore = new DataStore(':memory:', tmpDir);
  const nodeExecutor = new NodeExecutor(dataStore);
  const graphEngine = new GraphEngine(dataStore, nodeExecutor);
  const app = createApp({ dataStore, graphEngine });
  const server = app.listen(0);
  const port = (server.address() as AddressInfo).port;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    dataStore,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      dataStore.close();
      await fs.rm(tmpDir, { recursive: true, force: true });
    },
  };
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

async function registerAlgoInjection(params: {
  baseUrl: string;
  graphId: string;
  name: string;
  wasmBase64: string;
  entrypoint?: string;
}) {
  return await fetch(`${params.baseUrl}/api/graphs/${params.graphId}/algos`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: params.name,
      wasmBase64: params.wasmBase64,
      entrypoint: params.entrypoint,
    }),
  });
}

async function invokeAlgoInjection(params: {
  baseUrl: string;
  graphId: string;
  algoId: string;
  input?: unknown;
  noRecompute?: boolean;
}) {
  return await fetch(`${params.baseUrl}/api/graphs/${params.graphId}/algos/${params.algoId}/invoke`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      input: params.input,
      noRecompute: params.noRecompute,
    }),
  });
}

test('algo injection registration, listing, and deletion manage graph-scoped wasm metadata', async () => {
  const context = await setupTestServer();
  try {
    const graph = await createGraph(context.baseUrl, 'algo-registration');
    const wasmBase64 = await buildEchoAlgoWasmBase64();

    const registerResponse = await registerAlgoInjection({
      baseUrl: context.baseUrl,
      graphId: graph.id,
      name: 'echo',
      wasmBase64,
    });
    assert.equal(registerResponse.status, 200);
    const registered = await registerResponse.json();
    assert.equal(registered.algoInjection.name, 'echo');

    const listResponse = await fetch(`${context.baseUrl}/api/graphs/${graph.id}/algos`);
    assert.equal(listResponse.status, 200);
    const listed = await listResponse.json();
    assert.equal(listed.algoInjections.length, 1);
    assert.equal(listed.algoInjections[0].entrypoint, 'run');

    const deleteResponse = await fetch(
      `${context.baseUrl}/api/graphs/${graph.id}/algos/${registered.algoInjection.id}`,
      { method: 'DELETE' }
    );
    assert.equal(deleteResponse.status, 200);
    const deleted = await deleteResponse.json();
    assert.equal(deleted.deletedAlgoInjection.id, registered.algoInjection.id);

    const afterDelete = await fetch(`${context.baseUrl}/api/graphs/${graph.id}/algos`).then((response) => response.json());
    assert.deepEqual(afterDelete.algoInjections, []);
    assert.equal(await context.dataStore.getWasmArtifact(registered.algoInjection.artifactId), null);
  } finally {
    await context.close();
  }
});

test('algo injection registration rejects malformed base64 and missing run export', async () => {
  const context = await setupTestServer();
  try {
    const graph = await createGraph(context.baseUrl, 'algo-invalid-registration');

    const badBase64 = await registerAlgoInjection({
      baseUrl: context.baseUrl,
      graphId: graph.id,
      name: 'bad-base64',
      wasmBase64: 'not-base64!',
    });
    assert.equal(badBase64.status, 400);

    const missingRun = await registerAlgoInjection({
      baseUrl: context.baseUrl,
      graphId: graph.id,
      name: 'missing-run',
      wasmBase64: await buildMissingRunAlgoWasmBase64(),
    });
    assert.equal(missingRun.status, 400);
    const payload = await missingRun.json();
    assert.match(payload.error, /must export run/i);
  } finally {
    await context.close();
  }
});

test('algo injection invoke returns JSON output and can read graph state through graph_get', async () => {
  const context = await setupTestServer();
  try {
    const graph = await createGraph(context.baseUrl, 'algo-graph-get', {
      nodes: [createNumericInputNode('n-1', 7)],
    });
    const registerResponse = await registerAlgoInjection({
      baseUrl: context.baseUrl,
      graphId: graph.id,
      name: 'graph-get',
      wasmBase64: await buildGraphGetAlgoWasmBase64(),
    });
    const registered = await registerResponse.json();

    const invokeResponse = await invokeAlgoInjection({
      baseUrl: context.baseUrl,
      graphId: graph.id,
      algoId: registered.algoInjection.id,
      input: { ignored: true },
    });
    assert.equal(invokeResponse.status, 200);
    const invoked = await invokeResponse.json();
    assert.equal(invoked.result.id, graph.id);
    assert.equal(invoked.result.nodes.length, 1);
    assert.deepEqual(invoked.stagedCommands, []);
  } finally {
    await context.close();
  }
});

test('algo injection invoke can call graph_query and bulk_edit stages are committed once', async () => {
  const context = await setupTestServer();
  try {
    const graph = await createGraph(context.baseUrl, 'algo-query-edit', {
      nodes: [createNumericInputNode('n-1', 9)],
    });

    const queryRegister = await registerAlgoInjection({
      baseUrl: context.baseUrl,
      graphId: graph.id,
      name: 'query',
      wasmBase64: await buildGraphQueryAlgoWasmBase64(),
    });
    const queryAlgo = await queryRegister.json();
    const queryInvoke = await invokeAlgoInjection({
      baseUrl: context.baseUrl,
      graphId: graph.id,
      algoId: queryAlgo.algoInjection.id,
    });
    assert.equal(queryInvoke.status, 200);
    const queryPayload = await queryInvoke.json();
    assert.equal(queryPayload.result.nodes[0].id, 'n-1');

    const editRegister = await registerAlgoInjection({
      baseUrl: context.baseUrl,
      graphId: graph.id,
      name: 'rename',
      wasmBase64: await buildBulkEditAlgoWasmBase64('Renamed by algo'),
    });
    const editAlgo = await editRegister.json();
    const editInvoke = await invokeAlgoInjection({
      baseUrl: context.baseUrl,
      graphId: graph.id,
      algoId: editAlgo.algoInjection.id,
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

test('algo injection invoke rejects compute commands and preserves graph state on timeout', async () => {
  const context = await setupTestServer();
  try {
    const rejectGraph = await createGraph(context.baseUrl, 'algo-reject-timeout');

    const rejectRegister = await registerAlgoInjection({
      baseUrl: context.baseUrl,
      graphId: rejectGraph.id,
      name: 'reject-compute',
      wasmBase64: await buildComputeRejectAlgoWasmBase64(),
    });
    const rejectAlgo = await rejectRegister.json();
    const rejectInvoke = await invokeAlgoInjection({
      baseUrl: context.baseUrl,
      graphId: rejectGraph.id,
      algoId: rejectAlgo.algoInjection.id,
    });
    assert.equal(rejectInvoke.status, 400);
    const rejectPayload = await rejectInvoke.json();
    assert.match(rejectPayload.error, /does not allow compute_graph/i);

    const timeoutGraph = await createGraph(context.baseUrl, 'algo-timeout', {
      executionTimeoutMs: 25,
    });
    const timeoutRegister = await registerAlgoInjection({
      baseUrl: context.baseUrl,
      graphId: timeoutGraph.id,
      name: 'timeout',
      wasmBase64: await buildInfiniteLoopAlgoWasmBase64(),
    });
    const timeoutAlgo = await timeoutRegister.json();
    const timeoutInvoke = await invokeAlgoInjection({
      baseUrl: context.baseUrl,
      graphId: timeoutGraph.id,
      algoId: timeoutAlgo.algoInjection.id,
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

test('deleting a graph removes associated algo injection artifacts', async () => {
  const context = await setupTestServer();
  try {
    const graph = await createGraph(context.baseUrl, 'algo-graph-delete');
    const registerResponse = await registerAlgoInjection({
      baseUrl: context.baseUrl,
      graphId: graph.id,
      name: 'echo',
      wasmBase64: await buildEchoAlgoWasmBase64(),
    });
    const registered = await registerResponse.json();
    assert.ok(await context.dataStore.getWasmArtifact(registered.algoInjection.artifactId));

    const deleteResponse = await fetch(`${context.baseUrl}/api/graphs/${graph.id}`, {
      method: 'DELETE',
    });
    assert.equal(deleteResponse.status, 204);
    assert.equal(await context.dataStore.getWasmArtifact(registered.algoInjection.artifactId), null);
  } finally {
    await context.close();
  }
});
