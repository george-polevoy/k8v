import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { DataStore } from '../src/core/DataStore.ts';
import { ComputationResult } from '../src/types/index.ts';

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

test('DataStore preserves versioned computation results for the same node', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'k8v-datastore-test-'));
  const dbPath = path.join(tmpDir, 'k8v.db');
  const dataDir = path.join(tmpDir, 'data');
  const store = new DataStore(dbPath, dataDir);
  const nodeId = 'node-1';

  try {
    await store.storeResult(nodeId, makeResult(nodeId, 'v1', 1000, 1));
    await store.storeResult(nodeId, makeResult(nodeId, 'v2', 2000, 2));

    const v1 = await store.getResult(nodeId, 'v1');
    const v2 = await store.getResult(nodeId, 'v2');
    const latest = await store.getResult(nodeId);

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
