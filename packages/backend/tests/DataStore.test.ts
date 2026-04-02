import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { DataStore } from '../src/core/DataStore.ts';
import {
  STORAGE_ARTIFACTS_DIR_NAME,
  STORAGE_DB_FILE_NAME,
  STORAGE_SCHEMA_VERSION,
} from '../src/core/storage/DatabaseBootstrap.ts';
import { ComputationResult, type Graph } from '../src/types/index.ts';

const PNG_4X4_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAIUlEQVR4AVXBMQ0AIAADsJJM1mTjD+61h/uKoogaUSNqfK+QAylVq4ulAAAAAElFTkSuQmCC';

const makeResult = (
  nodeId: string,
  version: string,
  timestamp: number,
  outputValue: number
): ComputationResult => ({
  nodeId,
  outputs: { output: outputValue },
  schema: { output: { type: 'number' } },
  timestamp,
  version,
});

const makeGraph = (graphId: string): Graph => ({
  id: graphId,
  name: `Graph ${graphId}`,
  revision: 0,
  nodes: [],
  connections: [],
  createdAt: Date.now(),
  updatedAt: Date.now(),
});

test('DataStore preserves versioned computation results for the same node', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'k8v-datastore-test-'));
  const dbPath = path.join(tmpDir, 'k8v.db');
  const dataDir = path.join(tmpDir, 'data');
  const store = new DataStore(dbPath, dataDir);
  const graphId = 'graph-1';
  const nodeId = 'node-1';

  try {
    await store.storeGraph(makeGraph(graphId));
    await store.storeResult(graphId, nodeId, makeResult(nodeId, 'v1', 1000, 1));
    await store.storeResult(graphId, nodeId, makeResult(nodeId, 'v2', 2000, 2));

    const v1 = await store.getResult(graphId, nodeId, 'v1');
    const v2 = await store.getResult(graphId, nodeId, 'v2');
    const latest = await store.getResult(graphId, nodeId);

    assert.ok(v1, 'expected version v1 to exist');
    assert.ok(v2, 'expected version v2 to exist');
    assert.ok(latest, 'expected a latest result');
    assert.equal(v1.version, 'v1');
    assert.equal(v2.version, 'v2');
    assert.equal(latest.version, 'v2');
    assert.equal(v1.outputs.output, 1);
    assert.equal(v2.outputs.output, 2);
  } finally {
    store.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('DataStore lists only the latest result per requested node id', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'k8v-datastore-test-'));
  const dbPath = path.join(tmpDir, 'k8v.db');
  const dataDir = path.join(tmpDir, 'data');
  const store = new DataStore(dbPath, dataDir);
  const graphId = 'graph-latest-results';

  try {
    await store.storeGraph(makeGraph(graphId));
    await store.storeResult(graphId, 'node-a', makeResult('node-a', 'a-v1', 1000, 1));
    await store.storeResult(graphId, 'node-a', makeResult('node-a', 'a-v2', 2000, 2));
    await store.storeResult(graphId, 'node-b', makeResult('node-b', 'b-v1', 1500, 3));

    const allResults = await store.listLatestResultsForGraph(graphId);
    assert.deepEqual(Object.keys(allResults).sort(), ['node-a', 'node-b']);
    assert.equal(allResults['node-a']?.version, 'a-v2');
    assert.equal(allResults['node-b']?.version, 'b-v1');

    const scopedResults = await store.listLatestResultsForGraph(graphId, ['node-b']);
    assert.deepEqual(Object.keys(scopedResults), ['node-b']);
    assert.equal(scopedResults['node-b']?.version, 'b-v1');
  } finally {
    store.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('DataStore stores PNG graphics as mip levels and serves selected level by maxPixels', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'k8v-datastore-test-'));
  const dbPath = path.join(tmpDir, 'k8v.db');
  const dataDir = path.join(tmpDir, 'data');
  const store = new DataStore(dbPath, dataDir);
  const graphId = 'graph-graphics';
  const nodeId = 'node-graphics';

  try {
    const result: ComputationResult = {
      nodeId,
      outputs: {},
      schema: {},
      timestamp: 1234,
      version: 'v1',
      graphicsOutput: `data:image/png;base64,${PNG_4X4_BASE64}`,
    };

    await store.storeGraph(makeGraph(graphId));
    await store.storeResult(graphId, nodeId, result);
    const stored = await store.getResult(graphId, nodeId);
    assert.ok(stored?.graphics);
    assert.equal(stored?.graphics?.mimeType, 'image/png');
    assert.equal(stored?.graphics?.levels[0]?.width, 4);
    assert.equal(stored?.graphics?.levels[0]?.height, 4);

    const binary = await store.getGraphicsBinary(stored!.graphics!.id, 4);
    assert.ok(binary);
    assert.equal(binary?.selectedLevel.width, 2);
    assert.equal(binary?.selectedLevel.height, 2);
    assert.equal(binary?.selectedLevel.pixelCount, 4);
    assert.ok(binary?.buffer.byteLength);
  } finally {
    store.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('DataStore preserves graphics-backed results when updating an existing graph row', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'k8v-datastore-test-'));
  const dbPath = path.join(tmpDir, 'k8v.db');
  const dataDir = path.join(tmpDir, 'data');
  const store = new DataStore(dbPath, dataDir);
  const graphId = 'graph-update-preserves-results';
  const nodeId = 'node-graphics';
  const initialGraph = makeGraph(graphId);

  try {
    await store.storeGraph(initialGraph);
    await store.storeResult(graphId, nodeId, {
      nodeId,
      outputs: {},
      schema: {},
      timestamp: 4321,
      version: 'v1',
      graphicsOutput: `data:image/png;base64,${PNG_4X4_BASE64}`,
    });

    await store.storeGraph({
      ...initialGraph,
      name: 'Updated Graph Name',
      revision: initialGraph.revision + 1,
      updatedAt: initialGraph.updatedAt + 1,
    });

    const stored = await store.getResult(graphId, nodeId);
    assert.ok(stored, 'expected stored result to survive graph update');
    assert.ok(stored.graphics, 'expected graphics metadata to survive graph update');

    const binary = await store.getGraphicsBinary(stored.graphics.id, 16);
    assert.ok(binary, 'expected graphics binary to remain available after graph update');
    assert.equal(binary?.mimeType, 'image/png');
  } finally {
    store.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('DataStore uses K8V_STORAGE_DIR for persistent storage when explicit paths are omitted', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'k8v-datastore-env-test-'));
  const storageBaseDir = path.join(tmpDir, 'isolated-storage');
  const store = new DataStore(undefined, undefined, { K8V_STORAGE_DIR: storageBaseDir });

  try {
    await store.storeGraph(makeGraph('graph-env-storage'));

    const storageRoot = path.join(path.resolve(storageBaseDir), `v${STORAGE_SCHEMA_VERSION}`);
    const dbPath = path.join(storageRoot, STORAGE_DB_FILE_NAME);
    const artifactsDir = path.join(storageRoot, STORAGE_ARTIFACTS_DIR_NAME);

    assert.ok(await store.getGraph('graph-env-storage'));
    assert.equal((await fs.stat(dbPath)).isFile(), true);
    assert.equal((await fs.stat(artifactsDir)).isDirectory(), true);
  } finally {
    store.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
