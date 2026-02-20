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

test('POST /api/graphs accepts runtime in node config', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'k8v-app-test-'));
  const dataStore = new DataStore(':memory:', tmpDir);
  const nodeExecutor = new NodeExecutor(dataStore);
  const graphEngine = new GraphEngine(dataStore, nodeExecutor);
  const app = createApp({ dataStore, graphEngine });
  const server = app.listen(0);
  const port = (server.address() as AddressInfo).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/graphs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Runtime Graph',
        nodes: [createValidInlineNode()],
        connections: [],
      }),
    });

    assert.equal(response.status, 200);
    const graph = await response.json();
    assert.equal(graph.nodes[0].config.runtime, 'javascript_vm');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    dataStore.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('POST /api/graphs rejects malformed node config', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'k8v-app-test-'));
  const dataStore = new DataStore(':memory:', tmpDir);
  const nodeExecutor = new NodeExecutor(dataStore);
  const graphEngine = new GraphEngine(dataStore, nodeExecutor);
  const app = createApp({ dataStore, graphEngine });
  const server = app.listen(0);
  const port = (server.address() as AddressInfo).port;

  try {
    const invalidNode = createValidInlineNode();
    invalidNode.config.runtime = '';

    const response = await fetch(`http://127.0.0.1:${port}/api/graphs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Bad Graph',
        nodes: [invalidNode],
        connections: [],
      }),
    });

    assert.equal(response.status, 400);
    const payload = await response.json();
    assert.equal(payload.error, 'Validation failed');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    dataStore.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
