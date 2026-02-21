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

interface AppTestContext {
  baseUrl: string;
  dataStore: DataStore;
  close: () => Promise<void>;
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
  return fetch(`${baseUrl}/api/graphs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Runtime Graph',
      nodes: [createValidInlineNode()],
      connections: [],
      ...payload,
    }),
  });
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
      name: 'Legacy Cyclic Graph',
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
