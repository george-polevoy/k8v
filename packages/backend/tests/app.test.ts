import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { AddressInfo } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { createApp } from '../src/app.ts';
import { DataStore } from '../src/core/DataStore.ts';
import { NodeExecutor } from '../src/core/NodeExecutor.ts';
import { GraphEngine } from '../src/core/GraphEngine.ts';

interface AppTestContext {
  baseUrl: string;
  dataStore: DataStore;
  close: () => Promise<void>;
}

const AUTOTEST_GRAPH_PREFIX = 'autotests_';
const PNG_4X4_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAIUlEQVR4AVXBMQ0AIAADsJJM1mTjD+61h/uKoogaUSNqfK+QAylVq4ulAAAAAElFTkSuQmCC';

function toAutotestGraphName(name: string): string {
  return name.startsWith(AUTOTEST_GRAPH_PREFIX)
    ? name
    : `${AUTOTEST_GRAPH_PREFIX}${name}`;
}

function createValidInlineNode() {
  return {
    id: 'node-1',
    type: 'inline_code',
    position: { x: 0, y: 0 },
    metadata: {
      name: 'Inline',
      inputs: [],
      outputs: [{ name: 'output', schema: { type: 'number' } }],
    },
    config: {
      type: 'inline_code',
      code: 'outputs.output = 1;',
      runtime: 'javascript_vm',
    },
    version: '1',
  };
}

function createPassThroughNode(id: string) {
  return {
    id,
    type: 'inline_code',
    position: { x: 0, y: 0 },
    metadata: {
      name: `Node ${id}`,
      inputs: [{ name: 'input', schema: { type: 'number' } }],
      outputs: [{ name: 'output', schema: { type: 'number' } }],
    },
    config: {
      type: 'inline_code',
      code: 'outputs.output = inputs.input;',
      runtime: 'javascript_vm',
    },
    version: '1',
  };
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

function createPngGraphicsNode(id: string) {
  return {
    id,
    type: 'inline_code',
    position: { x: 0, y: 0 },
    metadata: {
      name: `Graphics ${id}`,
      inputs: [],
      outputs: [],
    },
    config: {
      type: 'inline_code',
      runtime: 'javascript_vm',
      code: `outputGraphics("data:image/png;base64,${PNG_4X4_BASE64}");`,
    },
    version: '1',
  };
}

async function setupTestServer(): Promise<AppTestContext> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'k8v-app-test-'));
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

async function createGraph(baseUrl: string, payload?: Record<string, unknown>) {
  const requestedName = typeof payload?.name === 'string'
    ? payload.name
    : 'runtime_graph';
  const nextPayload = {
    name: toAutotestGraphName(requestedName),
    nodes: [createValidInlineNode()],
    connections: [],
    ...payload,
  };

  if (typeof nextPayload.name === 'string') {
    nextPayload.name = toAutotestGraphName(nextPayload.name);
  }

  return fetch(`${baseUrl}/api/graphs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(nextPayload),
  });
}

function createSampleDrawing(id: string) {
  return {
    id,
    name: `Drawing ${id}`,
    position: { x: 100, y: 120 },
    paths: [
      {
        id: `${id}-path-1`,
        color: 'green',
        thickness: 3,
        points: [
          { x: 0, y: 0 },
          { x: 20, y: 10 },
        ],
      },
    ],
  };
}

function createLargeDrawing(id: string, pointCount = 12_000) {
  return {
    id,
    name: `Large Drawing ${id}`,
    position: { x: 80, y: 90 },
    paths: [
      {
        id: `${id}-path-1`,
        color: 'white',
        thickness: 3,
        points: Array.from({ length: pointCount }, (_value, index) => ({
          x: index % 480,
          y: Math.floor(index / 480),
        })),
      },
    ],
  };
}

test('POST /api/graphs accepts runtime in node config', async () => {
  const ctx = await setupTestServer();

  try {
    const response = await createGraph(ctx.baseUrl);
    assert.equal(response.status, 200);
    const graph = await response.json();
    assert.equal(graph.nodes[0].config.runtime, 'javascript_vm');
  } finally {
    await ctx.close();
  }
});

test('POST /api/graphs accepts python_process runtime in node config', async () => {
  const ctx = await setupTestServer();

  try {
    const node = createValidInlineNode();
    node.config.runtime = 'python_process';
    node.config.code = 'outputs.output = inputs.input * 2';
    node.metadata.inputs = [{ name: 'input', schema: { type: 'number' } }];

    const response = await createGraph(ctx.baseUrl, {
      nodes: [node],
    });
    assert.equal(response.status, 200);
    const graph = await response.json();
    assert.equal(graph.nodes[0].config.runtime, 'python_process');
  } finally {
    await ctx.close();
  }
});

test('POST /api/graphs accepts numeric_input nodes and compute returns numeric value', async () => {
  const ctx = await setupTestServer();

  try {
    const numericNode = createNumericInputNode('numeric-1', 42);
    const createResponse = await createGraph(ctx.baseUrl, {
      nodes: [numericNode],
    });
    assert.equal(createResponse.status, 200);
    const createdGraph = await createResponse.json();
    assert.equal(createdGraph.nodes[0].type, 'numeric_input');

    const computeResponse = await fetch(`${ctx.baseUrl}/api/graphs/${createdGraph.id}/compute`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nodeId: 'numeric-1' }),
    });
    assert.equal(computeResponse.status, 200);
    const result = await computeResponse.json();
    assert.equal(result.outputs.value, 42);
  } finally {
    await ctx.close();
  }
});

test('POST /api/graphs/:id/compute performs manual recompute even when node version is unchanged', async () => {
  const ctx = await setupTestServer();

  try {
    const createResponse = await createGraph(ctx.baseUrl, {
      nodes: [createValidInlineNode()],
    });
    assert.equal(createResponse.status, 200);
    const createdGraph = await createResponse.json();

    const firstComputeResponse = await fetch(`${ctx.baseUrl}/api/graphs/${createdGraph.id}/compute`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nodeId: 'node-1' }),
    });
    assert.equal(firstComputeResponse.status, 200);
    const firstResult = await firstComputeResponse.json();
    assert.equal(firstResult.outputs.output, 1);

    await delay(5);

    const secondComputeResponse = await fetch(`${ctx.baseUrl}/api/graphs/${createdGraph.id}/compute`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nodeId: 'node-1' }),
    });
    assert.equal(secondComputeResponse.status, 200);
    const secondResult = await secondComputeResponse.json();
    assert.equal(secondResult.outputs.output, 1);

    assert.equal(typeof firstResult.timestamp, 'number');
    assert.equal(typeof secondResult.timestamp, 'number');
    assert.ok(
      secondResult.timestamp > firstResult.timestamp,
      `expected second manual recompute timestamp (${secondResult.timestamp}) to be newer than first (${firstResult.timestamp})`
    );
  } finally {
    await ctx.close();
  }
});

test('POST /api/graphs applies default graph execution timeout', async () => {
  const ctx = await setupTestServer();

  try {
    const response = await createGraph(ctx.baseUrl, {
      nodes: [createValidInlineNode()],
    });
    assert.equal(response.status, 200);
    const graph = await response.json();
    assert.equal(graph.executionTimeoutMs, 30_000);
  } finally {
    await ctx.close();
  }
});

test('PUT /api/graphs persists graph execution timeout and allows large values', async () => {
  const ctx = await setupTestServer();

  try {
    const createResponse = await createGraph(ctx.baseUrl, {
      nodes: [createValidInlineNode()],
    });
    assert.equal(createResponse.status, 200);
    const createdGraph = await createResponse.json();
    assert.equal(createdGraph.executionTimeoutMs, 30_000);

    const updateResponse = await fetch(`${ctx.baseUrl}/api/graphs/${createdGraph.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        executionTimeoutMs: 100_000_000,
      }),
    });
    assert.equal(updateResponse.status, 200);
    const updatedGraph = await updateResponse.json();
    assert.equal(updatedGraph.executionTimeoutMs, 100_000_000);
  } finally {
    await ctx.close();
  }
});

test('POST /api/graphs applies default canvas background settings', async () => {
  const ctx = await setupTestServer();

  try {
    const response = await createGraph(ctx.baseUrl, {
      nodes: [createValidInlineNode()],
    });
    assert.equal(response.status, 200);
    const graph = await response.json();
    assert.deepEqual(graph.canvasBackground, {
      mode: 'gradient',
      baseColor: '#1d437e',
    });
  } finally {
    await ctx.close();
  }
});

test('PUT /api/graphs persists canvas background mode and base color updates', async () => {
  const ctx = await setupTestServer();

  try {
    const createResponse = await createGraph(ctx.baseUrl, {
      canvasBackground: {
        mode: 'solid',
        baseColor: '#204060',
      },
    });
    assert.equal(createResponse.status, 200);
    const createdGraph = await createResponse.json();
    assert.deepEqual(createdGraph.canvasBackground, {
      mode: 'solid',
      baseColor: '#204060',
    });

    const updateResponse = await fetch(`${ctx.baseUrl}/api/graphs/${createdGraph.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        canvasBackground: {
          mode: 'gradient',
          baseColor: '#4a7ab4',
        },
      }),
    });

    assert.equal(updateResponse.status, 200);
    const updatedGraph = await updateResponse.json();
    assert.deepEqual(updatedGraph.canvasBackground, {
      mode: 'gradient',
      baseColor: '#4a7ab4',
    });
  } finally {
    await ctx.close();
  }
});

test('POST /api/graphs initializes default projection metadata when omitted', async () => {
  const ctx = await setupTestServer();

  try {
    const response = await createGraph(ctx.baseUrl, {
      nodes: [createValidInlineNode()],
    });
    assert.equal(response.status, 200);
    const graph = await response.json();

    assert.equal(graph.activeProjectionId, 'default');
    assert.ok(Array.isArray(graph.projections));
    assert.equal(graph.projections.length, 1);
    assert.equal(graph.projections[0].id, 'default');
    assert.equal(graph.projections[0].name, 'Default');
    assert.equal(graph.projections[0].nodePositions['node-1'].x, 0);
    assert.equal(graph.projections[0].nodePositions['node-1'].y, 0);
    assert.ok(graph.projections[0].nodeCardSizes['node-1'].width > 0);
    assert.ok(graph.projections[0].nodeCardSizes['node-1'].height > 0);
    assert.deepEqual(graph.projections[0].canvasBackground, {
      mode: 'gradient',
      baseColor: '#1d437e',
    });
  } finally {
    await ctx.close();
  }
});

test('POST /api/graphs preserves oversized fallback node card dimensions', async () => {
  const ctx = await setupTestServer();

  try {
    const node = createValidInlineNode();
    node.config.config = {
      cardWidth: 20_000,
      cardHeight: 20_000,
    };

    const response = await createGraph(ctx.baseUrl, {
      nodes: [node],
    });
    assert.equal(response.status, 200);
    const graph = await response.json();

    assert.equal(graph.projections[0].nodeCardSizes['node-1'].width, 20_000);
    assert.equal(graph.projections[0].nodeCardSizes['node-1'].height, 20_000);
    assert.equal(graph.nodes[0].config.config.cardWidth, 20_000);
    assert.equal(graph.nodes[0].config.config.cardHeight, 20_000);
  } finally {
    await ctx.close();
  }
});

test('PUT /api/graphs recomputes target node after inbound connection changes without manual rename', async () => {
  const ctx = await setupTestServer();

  try {
    const sourceNode = createNumericInputNode('source-node', 5);
    sourceNode.version = 'source-v1';

    const targetNode = createValidInlineNode();
    targetNode.id = 'target-node';
    targetNode.metadata.name = 'Inline Code';
    targetNode.metadata.inputs = [{ name: 'A', schema: { type: 'number' } }];
    targetNode.metadata.outputs = [{ name: 'output', schema: { type: 'number' } }];
    targetNode.config.runtime = 'python_process';
    targetNode.config.code = 'outputs.output = inputs.A + 1';
    targetNode.version = 'target-v1';

    const createResponse = await createGraph(ctx.baseUrl, {
      nodes: [sourceNode, targetNode],
      connections: [],
    });
    assert.equal(createResponse.status, 200);
    const createdGraph = await createResponse.json();

    const computeSourceResponse = await fetch(`${ctx.baseUrl}/api/graphs/${createdGraph.id}/compute`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nodeId: 'source-node' }),
    });
    assert.equal(computeSourceResponse.status, 200);

    const computeTargetBeforeConnectionResponse = await fetch(`${ctx.baseUrl}/api/graphs/${createdGraph.id}/compute`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nodeId: 'target-node' }),
    });
    assert.equal(computeTargetBeforeConnectionResponse.status, 200);
    const beforeConnection = await computeTargetBeforeConnectionResponse.json();
    assert.match(String(beforeConnection.textOutput ?? ''), /Error: A/);

    const currentGraphResponse = await fetch(`${ctx.baseUrl}/api/graphs/${createdGraph.id}`);
    assert.equal(currentGraphResponse.status, 200);
    const currentGraph = await currentGraphResponse.json();
    const targetNodeBeforeUpdate = currentGraph.nodes.find((node: any) => node.id === 'target-node');
    assert.ok(targetNodeBeforeUpdate);

    const updateResponse = await fetch(`${ctx.baseUrl}/api/graphs/${createdGraph.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ifMatchUpdatedAt: currentGraph.updatedAt,
        connections: [
          {
            id: 'conn-source-to-target',
            sourceNodeId: 'source-node',
            sourcePort: 'value',
            targetNodeId: 'target-node',
            targetPort: 'A',
          },
        ],
      }),
    });
    assert.equal(updateResponse.status, 200);
    const updatedGraph = await updateResponse.json();
    const targetNodeAfterUpdate = updatedGraph.nodes.find((node: any) => node.id === 'target-node');
    assert.ok(targetNodeAfterUpdate);
    assert.notEqual(targetNodeAfterUpdate.version, targetNodeBeforeUpdate.version);

    const computeTargetAfterConnectionResponse = await fetch(`${ctx.baseUrl}/api/graphs/${createdGraph.id}/compute`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nodeId: 'target-node' }),
    });
    assert.equal(computeTargetAfterConnectionResponse.status, 200);
    const afterConnection = await computeTargetAfterConnectionResponse.json();
    assert.equal(afterConnection.outputs.output, 6);
    assert.ok(!String(afterConnection.textOutput ?? '').includes('Error: A'));
  } finally {
    await ctx.close();
  }
});

test('graph recompute status reports graph-level worker concurrency', async () => {
  const ctx = await setupTestServer();

  try {
    const node = createValidInlineNode();
    const createResponse = await createGraph(ctx.baseUrl, {
      nodes: [node],
      recomputeConcurrency: 3,
    });
    assert.equal(createResponse.status, 200);
    const createdGraph = await createResponse.json();
    assert.equal(createdGraph.recomputeConcurrency, 3);

    const statusResponse = await fetch(`${ctx.baseUrl}/api/graphs/${createdGraph.id}/recompute-status`);
    assert.equal(statusResponse.status, 200);
    const status = await statusResponse.json();
    assert.equal(status.workerConcurrency, 3);

    const updateResponse = await fetch(`${ctx.baseUrl}/api/graphs/${createdGraph.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        recomputeConcurrency: 2,
      }),
    });
    assert.equal(updateResponse.status, 200);
    const updatedGraph = await updateResponse.json();
    assert.equal(updatedGraph.recomputeConcurrency, 2);

    const updatedStatusResponse = await fetch(`${ctx.baseUrl}/api/graphs/${createdGraph.id}/recompute-status`);
    assert.equal(updatedStatusResponse.status, 200);
    const updatedStatus = await updatedStatusResponse.json();
    assert.equal(updatedStatus.workerConcurrency, 2);
  } finally {
    await ctx.close();
  }
});

test('PUT /api/graphs enqueues backend recompute for all impacted descendants', async () => {
  const ctx = await setupTestServer();

  try {
    const rootNode = {
      id: 'node-a',
      type: 'inline_code',
      position: { x: 0, y: 0 },
      metadata: {
        name: 'A',
        inputs: [],
        outputs: [{ name: 'output', schema: { type: 'number' } }],
      },
      config: {
        type: 'inline_code',
        runtime: 'python_process',
        code: 'import time\\ntime.sleep(0.25)\\noutputs.output = 2',
        config: { autoRecompute: true },
      },
      version: 'a-v1',
    };
    const middleNode = {
      id: 'node-b',
      type: 'inline_code',
      position: { x: 200, y: 0 },
      metadata: {
        name: 'B',
        inputs: [{ name: 'input', schema: { type: 'number' } }],
        outputs: [{ name: 'output', schema: { type: 'number' } }],
      },
      config: {
        type: 'inline_code',
        runtime: 'javascript_vm',
        code: 'outputs.output = inputs.input;',
        config: { autoRecompute: true },
      },
      version: 'b-v1',
    };
    const leafNode = {
      id: 'node-c',
      type: 'inline_code',
      position: { x: 400, y: 0 },
      metadata: {
        name: 'C',
        inputs: [{ name: 'input', schema: { type: 'number' } }],
        outputs: [{ name: 'output', schema: { type: 'number' } }],
      },
      config: {
        type: 'inline_code',
        runtime: 'javascript_vm',
        code: 'outputs.output = inputs.input;',
        config: { autoRecompute: true },
      },
      version: 'c-v1',
    };

    const createResponse = await createGraph(ctx.baseUrl, {
      nodes: [rootNode, middleNode, leafNode],
      connections: [
        {
          id: 'ab',
          sourceNodeId: 'node-a',
          sourcePort: 'output',
          targetNodeId: 'node-b',
          targetPort: 'input',
        },
        {
          id: 'bc',
          sourceNodeId: 'node-b',
          sourcePort: 'output',
          targetNodeId: 'node-c',
          targetPort: 'input',
        },
      ],
      recomputeConcurrency: 1,
    });
    assert.equal(createResponse.status, 200);
    const createdGraph = await createResponse.json();

    const updateResponse = await fetch(`${ctx.baseUrl}/api/graphs/${createdGraph.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        nodes: createdGraph.nodes.map((node: any) =>
          node.id === 'node-a'
            ? {
                ...node,
                version: 'a-v2',
                config: {
                  ...node.config,
                  code: 'import time\\ntime.sleep(0.25)\\noutputs.output = 7',
                },
              }
            : node
        ),
      }),
    });
    assert.equal(updateResponse.status, 200);

    let sawRootActive = false;
    let sawMiddlePending = false;
    let sawLeafPending = false;

    for (let attempt = 0; attempt < 40; attempt += 1) {
      const statusResponse = await fetch(`${ctx.baseUrl}/api/graphs/${createdGraph.id}/recompute-status`);
      assert.equal(statusResponse.status, 200);
      const status = await statusResponse.json();
      const nodeStates = status.nodeStates ?? {};

      const rootState = nodeStates['node-a'];
      const middleState = nodeStates['node-b'];
      const leafState = nodeStates['node-c'];

      if (rootState?.isPending || rootState?.isComputing) {
        sawRootActive = true;
      }
      if (middleState?.isPending) {
        sawMiddlePending = true;
      }
      if (leafState?.isPending) {
        sawLeafPending = true;
      }

      const queueDrained = status.queueLength === 0;
      const noNodeActive = !Object.values(nodeStates).some((state: any) => state?.isPending || state?.isComputing);
      if (queueDrained && noNodeActive) {
        break;
      }

      await delay(30);
    }

    assert.equal(sawRootActive, true);
    assert.equal(sawMiddlePending, true);
    assert.equal(sawLeafPending, true);

    const settledStatusResponse = await fetch(`${ctx.baseUrl}/api/graphs/${createdGraph.id}/recompute-status`);
    assert.equal(settledStatusResponse.status, 200);
    const settledStatus = await settledStatusResponse.json();
    const settledNodeStates = settledStatus.nodeStates ?? {};
    assert.equal(Boolean(settledNodeStates['node-b']?.isPending), false);
    assert.equal(Boolean(settledNodeStates['node-b']?.isComputing), false);
    assert.equal(Boolean(settledNodeStates['node-c']?.isPending), false);
    assert.equal(Boolean(settledNodeStates['node-c']?.isComputing), false);
  } finally {
    await ctx.close();
  }
});

test('PUT /api/graphs switches active projection and applies projected node coordinates', async () => {
  const ctx = await setupTestServer();

  try {
    const createResponse = await createGraph(ctx.baseUrl, {
      nodes: [createValidInlineNode()],
    });
    assert.equal(createResponse.status, 200);
    const createdGraph = await createResponse.json();

    const altProjectionId = 'alt-projection';
    const updateResponse = await fetch(`${ctx.baseUrl}/api/graphs/${createdGraph.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projections: [
          {
            id: 'default',
            name: 'Default',
            nodePositions: {
              'node-1': { x: 0, y: 0 },
            },
            nodeCardSizes: {
              'node-1': { width: 220, height: 80 },
            },
            canvasBackground: {
              mode: 'gradient',
              baseColor: '#1d437e',
            },
          },
          {
            id: altProjectionId,
            name: 'Projection 2',
            nodePositions: {
              'node-1': { x: 320, y: 180 },
            },
            nodeCardSizes: {
              'node-1': { width: 360, height: 200 },
            },
            canvasBackground: {
              mode: 'solid',
              baseColor: '#204060',
            },
          },
        ],
        activeProjectionId: altProjectionId,
      }),
    });

    assert.equal(updateResponse.status, 200);
    const updatedGraph = await updateResponse.json();
    assert.equal(updatedGraph.activeProjectionId, altProjectionId);
    assert.equal(updatedGraph.nodes[0].position.x, 320);
    assert.equal(updatedGraph.nodes[0].position.y, 180);
    assert.equal(updatedGraph.nodes[0].config.config.cardWidth, 360);
    assert.equal(updatedGraph.nodes[0].config.config.cardHeight, 200);
    assert.deepEqual(updatedGraph.canvasBackground, {
      mode: 'solid',
      baseColor: '#204060',
    });
    assert.equal(
      updatedGraph.projections.find((projection: any) => projection.id === altProjectionId)?.nodePositions['node-1'].x,
      320
    );
    assert.equal(
      updatedGraph.projections.find((projection: any) => projection.id === altProjectionId)?.nodePositions['node-1'].y,
      180
    );
    assert.equal(
      updatedGraph.projections.find((projection: any) => projection.id === altProjectionId)?.nodeCardSizes['node-1'].width,
      360
    );
    assert.equal(
      updatedGraph.projections.find((projection: any) => projection.id === altProjectionId)?.nodeCardSizes['node-1'].height,
      200
    );
  } finally {
    await ctx.close();
  }
});

test('PUT /api/graphs switches graph canvas background to selected projection background', async () => {
  const ctx = await setupTestServer();

  try {
    const createResponse = await createGraph(ctx.baseUrl, {
      nodes: [createValidInlineNode()],
      projections: [
        {
          id: 'default',
          name: 'Default',
          nodePositions: {
            'node-1': { x: 0, y: 0 },
          },
          nodeCardSizes: {
            'node-1': { width: 220, height: 80 },
          },
          canvasBackground: {
            mode: 'gradient',
            baseColor: '#1d437e',
          },
        },
        {
          id: 'alt',
          name: 'Alt',
          nodePositions: {
            'node-1': { x: 40, y: 60 },
          },
          nodeCardSizes: {
            'node-1': { width: 300, height: 180 },
          },
          canvasBackground: {
            mode: 'solid',
            baseColor: '#305070',
          },
        },
      ],
      activeProjectionId: 'default',
    });
    assert.equal(createResponse.status, 200);
    const createdGraph = await createResponse.json();
    assert.deepEqual(createdGraph.canvasBackground, {
      mode: 'gradient',
      baseColor: '#1d437e',
    });

    const updateResponse = await fetch(`${ctx.baseUrl}/api/graphs/${createdGraph.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        activeProjectionId: 'alt',
      }),
    });
    assert.equal(updateResponse.status, 200);
    const updatedGraph = await updateResponse.json();
    assert.equal(updatedGraph.activeProjectionId, 'alt');
    assert.deepEqual(updatedGraph.canvasBackground, {
      mode: 'solid',
      baseColor: '#305070',
    });
  } finally {
    await ctx.close();
  }
});

test('PUT /api/graphs rejects updates that remove all projections', async () => {
  const ctx = await setupTestServer();

  try {
    const createResponse = await createGraph(ctx.baseUrl, {
      nodes: [createValidInlineNode()],
    });
    assert.equal(createResponse.status, 200);
    const createdGraph = await createResponse.json();

    const updateResponse = await fetch(`${ctx.baseUrl}/api/graphs/${createdGraph.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projections: [],
      }),
    });

    assert.equal(updateResponse.status, 400);
    const payload = await updateResponse.json();
    assert.match(payload.error, /at least one projection/i);
  } finally {
    await ctx.close();
  }
});

test('PUT /api/graphs rejects stale ifMatchUpdatedAt values with conflict', async () => {
  const ctx = await setupTestServer();

  try {
    const createResponse = await createGraph(ctx.baseUrl, {
      nodes: [createValidInlineNode()],
    });
    assert.equal(createResponse.status, 200);
    const createdGraph = await createResponse.json();

    const updateResponse = await fetch(`${ctx.baseUrl}/api/graphs/${createdGraph.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: toAutotestGraphName('conflict_name'),
        ifMatchUpdatedAt: createdGraph.updatedAt - 1,
      }),
    });

    assert.equal(updateResponse.status, 409);
    const payload = await updateResponse.json();
    assert.match(payload.error, /reload and retry/i);
    assert.equal(typeof payload.currentUpdatedAt, 'number');
    assert.equal(payload.currentUpdatedAt, createdGraph.updatedAt);
  } finally {
    await ctx.close();
  }
});

test('DELETE /api/graphs/:id deletes graph and subsequent fetch returns 404', async () => {
  const ctx = await setupTestServer();

  try {
    const createResponse = await createGraph(ctx.baseUrl, {
      name: 'Delete Target Graph',
    });
    assert.equal(createResponse.status, 200);
    const createdGraph = await createResponse.json();

    const deleteResponse = await fetch(`${ctx.baseUrl}/api/graphs/${createdGraph.id}`, {
      method: 'DELETE',
    });
    assert.equal(deleteResponse.status, 204);

    const getDeletedResponse = await fetch(`${ctx.baseUrl}/api/graphs/${createdGraph.id}`);
    assert.equal(getDeletedResponse.status, 404);
  } finally {
    await ctx.close();
  }
});

test('DELETE /api/graphs/:id returns 404 for missing graph', async () => {
  const ctx = await setupTestServer();

  try {
    const deleteResponse = await fetch(`${ctx.baseUrl}/api/graphs/missing-graph-id`, {
      method: 'DELETE',
    });
    assert.equal(deleteResponse.status, 404);
    const payload = await deleteResponse.json();
    assert.match(payload.error, /graph not found/i);
  } finally {
    await ctx.close();
  }
});

test('POST /api/graphs accepts graph python env definitions and node env references', async () => {
  const ctx = await setupTestServer();

  try {
    const node = createValidInlineNode();
    node.config.runtime = 'python_process';
    node.config.pythonEnv = 'analytics';
    node.config.code = 'outputs.output = inputs.input * 2';
    node.metadata.inputs = [{ name: 'input', schema: { type: 'number' } }];

    const response = await createGraph(ctx.baseUrl, {
      nodes: [node],
      pythonEnvs: [
        {
          name: 'analytics',
          pythonPath: '/tmp/python-a',
          cwd: '/tmp/work-a',
        },
      ],
    });
    assert.equal(response.status, 200);
    const graph = await response.json();
    assert.equal(graph.pythonEnvs.length, 1);
    assert.equal(graph.nodes[0].config.pythonEnv, 'analytics');
  } finally {
    await ctx.close();
  }
});

test('POST /api/graphs rejects duplicate graph python env names', async () => {
  const ctx = await setupTestServer();

  try {
    const response = await createGraph(ctx.baseUrl, {
      pythonEnvs: [
        { name: 'dup', pythonPath: '/tmp/python-a', cwd: '/tmp/work-a' },
        { name: 'dup', pythonPath: '/tmp/python-b', cwd: '/tmp/work-b' },
      ],
    });

    assert.equal(response.status, 400);
    const payload = await response.json();
    assert.match(payload.error, /must be unique/i);
  } finally {
    await ctx.close();
  }
});

test('POST /api/graphs rejects python env references that do not exist on graph', async () => {
  const ctx = await setupTestServer();

  try {
    const node = createValidInlineNode();
    node.config.runtime = 'python_process';
    node.config.pythonEnv = 'missing';
    node.config.code = 'outputs.output = inputs.input * 2';
    node.metadata.inputs = [{ name: 'input', schema: { type: 'number' } }];

    const response = await createGraph(ctx.baseUrl, {
      nodes: [node],
      pythonEnvs: [],
    });

    assert.equal(response.status, 400);
    const payload = await response.json();
    assert.match(payload.error, /unknown pythonEnv/i);
  } finally {
    await ctx.close();
  }
});

test('POST /api/graphs rejects python env name on non-python runtime node', async () => {
  const ctx = await setupTestServer();

  try {
    const node = createValidInlineNode();
    node.config.runtime = 'javascript_vm';
    node.config.pythonEnv = 'analytics';

    const response = await createGraph(ctx.baseUrl, {
      nodes: [node],
      pythonEnvs: [
        { name: 'analytics', pythonPath: '/tmp/python-a', cwd: '/tmp/work-a' },
      ],
    });

    assert.equal(response.status, 400);
    const payload = await response.json();
    assert.match(payload.error, /runtime "javascript_vm" is not "python_process"/i);
  } finally {
    await ctx.close();
  }
});

test('POST /api/graphs accepts persisted drawings payload', async () => {
  const ctx = await setupTestServer();

  try {
    const response = await createGraph(ctx.baseUrl, {
      drawings: [createSampleDrawing('drawing-1')],
    });

    assert.equal(response.status, 200);
    const graph = await response.json();
    assert.equal(graph.drawings.length, 1);
    assert.equal(graph.drawings[0].paths.length, 1);
    assert.equal(graph.drawings[0].paths[0].points.length, 2);
  } finally {
    await ctx.close();
  }
});

test('POST /api/graphs normalizes drawing colors to hex format', async () => {
  const ctx = await setupTestServer();

  try {
    const response = await createGraph(ctx.baseUrl, {
      drawings: [
        {
          id: 'drawing-colors',
          name: 'Drawing Colors',
          position: { x: 10, y: 10 },
          paths: [
            {
              id: 'path-legacy',
              color: 'green',
              thickness: 3,
              points: [{ x: 0, y: 0 }],
            },
            {
              id: 'path-hex',
              color: '#123abc',
              thickness: 3,
              points: [{ x: 4, y: 4 }],
            },
          ],
        },
      ],
    });

    assert.equal(response.status, 200);
    const graph = await response.json();
    assert.equal(graph.drawings[0].paths[0].color, '#22c55e');
    assert.equal(graph.drawings[0].paths[1].color, '#123abc');
  } finally {
    await ctx.close();
  }
});

test('PUT /api/graphs/:id accepts updates with payload larger than 100KB', async () => {
  const ctx = await setupTestServer();

  try {
    const createResponse = await createGraph(ctx.baseUrl, {
      drawings: [createSampleDrawing('seed-drawing')],
    });
    assert.equal(createResponse.status, 200);
    const createdGraph = await createResponse.json();

    const updatePayload = {
      nodes: [...createdGraph.nodes, createPassThroughNode('node-2')],
      connections: createdGraph.connections,
      drawings: [...createdGraph.drawings, createLargeDrawing('large-drawing')],
    };

    const serializedPayload = JSON.stringify(updatePayload);
    assert.ok(
      serializedPayload.length > 102_400,
      `Expected test payload > 100KB, received ${serializedPayload.length} bytes`
    );

    const updateResponse = await fetch(`${ctx.baseUrl}/api/graphs/${createdGraph.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: serializedPayload,
    });

    assert.equal(updateResponse.status, 200);
    const updatedGraph = await updateResponse.json();
    assert.equal(updatedGraph.nodes.length, 2);
    assert.equal(updatedGraph.drawings.length, 2);
    assert.equal(updatedGraph.drawings[1].paths[0].points.length, 12_000);
  } finally {
    await ctx.close();
  }
});

test('POST /api/graphs rejects duplicate drawing ids', async () => {
  const ctx = await setupTestServer();

  try {
    const response = await createGraph(ctx.baseUrl, {
      drawings: [createSampleDrawing('dup-drawing'), createSampleDrawing('dup-drawing')],
    });

    assert.equal(response.status, 400);
    const payload = await response.json();
    assert.match(payload.error, /drawing ids must be unique/i);
  } finally {
    await ctx.close();
  }
});

test('POST /api/graphs rejects duplicate drawing path ids within a drawing', async () => {
  const ctx = await setupTestServer();

  try {
    const drawing = createSampleDrawing('drawing-with-dup-path');
    drawing.paths.push({
      id: drawing.paths[0].id,
      color: 'red',
      thickness: 1,
      points: [{ x: 1, y: 1 }],
    });

    const response = await createGraph(ctx.baseUrl, {
      drawings: [drawing],
    });

    assert.equal(response.status, 400);
    const payload = await response.json();
    assert.match(payload.error, /path ids must be unique/i);
  } finally {
    await ctx.close();
  }
});

test('POST /api/graphs rejects malformed node config', async () => {
  const ctx = await setupTestServer();

  try {
    const invalidNode = createValidInlineNode();
    invalidNode.config.runtime = '';

    const response = await createGraph(ctx.baseUrl, {
      name: 'Bad Graph',
      nodes: [invalidNode],
    });

    assert.equal(response.status, 400);
    const payload = await response.json();
    assert.equal(payload.error, 'Validation failed');
  } finally {
    await ctx.close();
  }
});

test('PUT /api/graphs/:id rejects malformed runtime updates', async () => {
  const ctx = await setupTestServer();

  try {
    const createResponse = await createGraph(ctx.baseUrl);
    assert.equal(createResponse.status, 200);
    const createdGraph = await createResponse.json();

    const invalidNode = createValidInlineNode();
    invalidNode.config.runtime = '';

    const updateResponse = await fetch(`${ctx.baseUrl}/api/graphs/${createdGraph.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        nodes: [invalidNode],
      }),
    });

    assert.equal(updateResponse.status, 400);
    const payload = await updateResponse.json();
    assert.equal(payload.error, 'Validation failed');
  } finally {
    await ctx.close();
  }
});

test('POST /api/graphs/:id/compute returns clear error for unregistered runtime', async () => {
  const ctx = await setupTestServer();

  try {
    const node = createValidInlineNode();
    node.config.runtime = 'unknown_runtime';

    const createResponse = await createGraph(ctx.baseUrl, {
      nodes: [node],
    });
    assert.equal(createResponse.status, 200);
    const createdGraph = await createResponse.json();

    const computeResponse = await fetch(`${ctx.baseUrl}/api/graphs/${createdGraph.id}/compute`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });

    assert.equal(computeResponse.status, 500);
    const payload = await computeResponse.json();
    assert.match(payload.error, /not registered/);
  } finally {
    await ctx.close();
  }
});

test('POST /api/graphs rejects cyclic graph structures', async () => {
  const ctx = await setupTestServer();

  try {
    const nodeA = createPassThroughNode('node-a');
    const nodeB = createPassThroughNode('node-b');

    const response = await createGraph(ctx.baseUrl, {
      name: 'Cyclic Graph',
      nodes: [nodeA, nodeB],
      connections: [
        {
          id: 'c1',
          sourceNodeId: 'node-a',
          sourcePort: 'output',
          targetNodeId: 'node-b',
          targetPort: 'input',
        },
        {
          id: 'c2',
          sourceNodeId: 'node-b',
          sourcePort: 'output',
          targetNodeId: 'node-a',
          targetPort: 'input',
        },
      ],
    });

    assert.equal(response.status, 400);
    const payload = await response.json();
    assert.match(payload.error, /circular dependency/i);
  } finally {
    await ctx.close();
  }
});

test('PUT /api/graphs/:id rejects updates that introduce cycles', async () => {
  const ctx = await setupTestServer();

  try {
    const nodeA = createPassThroughNode('node-a');
    const nodeB = createPassThroughNode('node-b');

    const createResponse = await createGraph(ctx.baseUrl, {
      name: 'Acyclic Graph',
      nodes: [nodeA, nodeB],
      connections: [
        {
          id: 'c1',
          sourceNodeId: 'node-a',
          sourcePort: 'output',
          targetNodeId: 'node-b',
          targetPort: 'input',
        },
      ],
    });
    assert.equal(createResponse.status, 200);
    const createdGraph = await createResponse.json();

    const updateResponse = await fetch(`${ctx.baseUrl}/api/graphs/${createdGraph.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        connections: [
          ...createdGraph.connections,
          {
            id: 'c2',
            sourceNodeId: 'node-b',
            sourcePort: 'output',
            targetNodeId: 'node-a',
            targetPort: 'input',
          },
        ],
      }),
    });

    assert.equal(updateResponse.status, 400);
    const payload = await updateResponse.json();
    assert.match(payload.error, /circular dependency/i);
  } finally {
    await ctx.close();
  }
});

test('PUT /api/graphs/:id rejects all updates on cyclic graphs (strict DAG)', async () => {
  const ctx = await setupTestServer();

  try {
    const nodeA = createPassThroughNode('node-a');
    const nodeB = createPassThroughNode('node-b');
    const legacyGraph = {
      id: 'legacy-cyclic',
      name: toAutotestGraphName('legacy_cyclic_graph'),
      nodes: [nodeA, nodeB],
      connections: [
        {
          id: 'c1',
          sourceNodeId: 'node-a',
          sourcePort: 'output',
          targetNodeId: 'node-b',
          targetPort: 'input',
        },
        {
          id: 'c2',
          sourceNodeId: 'node-b',
          sourcePort: 'output',
          targetNodeId: 'node-a',
          targetPort: 'input',
        },
      ],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await ctx.dataStore.storeGraph(legacyGraph);

    const updateResponse = await fetch(`${ctx.baseUrl}/api/graphs/${legacyGraph.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        nodes: [...legacyGraph.nodes, createPassThroughNode('node-c')],
      }),
    });

    assert.equal(updateResponse.status, 400);
    const payload = await updateResponse.json();
    assert.match(payload.error, /circular dependency/i);
  } finally {
    await ctx.close();
  }
});

test('compute responses include graphics metadata without embedding raw image payload', async () => {
  const ctx = await setupTestServer();

  try {
    const graphicsNode = createPngGraphicsNode('node-graphics');
    const createResponse = await createGraph(ctx.baseUrl, {
      nodes: [graphicsNode],
    });
    assert.equal(createResponse.status, 200);
    const graph = await createResponse.json();

    const computeResponse = await fetch(`${ctx.baseUrl}/api/graphs/${graph.id}/compute`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nodeId: graphicsNode.id }),
    });
    assert.equal(computeResponse.status, 200);
    const computed = await computeResponse.json();

    assert.equal(typeof computed.graphics?.id, 'string');
    assert.equal(computed.graphics?.mimeType, 'image/png');
    assert.ok(Array.isArray(computed.graphics?.levels));
    assert.equal(computed.graphics?.levels[0]?.width, 4);
    assert.equal(computed.graphics?.levels[0]?.height, 4);
    assert.equal(computed.graphicsOutput, undefined);

    const resultResponse = await fetch(`${ctx.baseUrl}/api/nodes/${graphicsNode.id}/result`);
    assert.equal(resultResponse.status, 200);
    const stored = await resultResponse.json();
    assert.equal(stored.graphics?.id, computed.graphics?.id);
    assert.equal(stored.graphicsOutput, undefined);
  } finally {
    await ctx.close();
  }
});

test('GET /api/graphics/:id/image selects mip level by maxPixels and returns binary', async () => {
  const ctx = await setupTestServer();

  try {
    const graphicsNode = createPngGraphicsNode('node-graphics-image');
    const createResponse = await createGraph(ctx.baseUrl, {
      nodes: [graphicsNode],
    });
    assert.equal(createResponse.status, 200);
    const graph = await createResponse.json();

    const computeResponse = await fetch(`${ctx.baseUrl}/api/graphs/${graph.id}/compute`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nodeId: graphicsNode.id }),
    });
    assert.equal(computeResponse.status, 200);
    const computed = await computeResponse.json();
    const graphicsId = computed.graphics?.id as string;
    assert.ok(graphicsId);

    const imageResponse = await fetch(
      `${ctx.baseUrl}/api/graphics/${encodeURIComponent(graphicsId)}/image?maxPixels=4`
    );
    assert.equal(imageResponse.status, 200);
    assert.equal(imageResponse.headers.get('content-type'), 'image/png');
    assert.equal(imageResponse.headers.get('x-k8v-graphics-width'), '2');
    assert.equal(imageResponse.headers.get('x-k8v-graphics-height'), '2');
    assert.equal(imageResponse.headers.get('x-k8v-graphics-pixels'), '4');
    const binary = Buffer.from(await imageResponse.arrayBuffer());
    assert.ok(binary.byteLength > 0);
  } finally {
    await ctx.close();
  }
});
