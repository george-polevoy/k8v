import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { DataStore } from '../src/core/DataStore.ts';
import { GraphEngine } from '../src/core/GraphEngine.ts';
import { NodeExecutor } from '../src/core/NodeExecutor.ts';
import { Graph, NodeType } from '../src/types/index.ts';
import { ExecutionRuntime } from '../src/core/execution/types.ts';

function createGraph(initialInput: number): Graph {
  const now = Date.now();

  return {
    id: 'graph-1',
    name: 'Dependency Recompute Graph',
    revision: 0,
    createdAt: now,
    updatedAt: now,
    pythonEnvs: [],
    drawings: [],
    nodes: [
      {
        id: 'input-node',
        type: NodeType.NUMERIC_INPUT,
        position: { x: 0, y: 0 },
        metadata: {
          name: 'Numeric Input',
          inputs: [],
          outputs: [{ name: 'value', schema: { type: 'number' } }],
        },
        config: {
          value: initialInput,
          min: 0,
          max: 100,
          step: 1,
        },
        version: 'input-v1',
      },
      {
        id: 'upstream-node',
        type: NodeType.INLINE_CODE,
        position: { x: 200, y: 0 },
        metadata: {
          name: 'Upstream',
          inputs: [{ name: 'input', schema: { type: 'number' } }],
          outputs: [{ name: 'output', schema: { type: 'number' } }],
        },
        config: {
          code: 'outputs.output = (inputs.input ?? 0) + 1;',
          runtime: 'javascript_vm',
        },
        version: 'upstream-v1',
      },
      {
        id: 'downstream-node',
        type: NodeType.INLINE_CODE,
        position: { x: 400, y: 0 },
        metadata: {
          name: 'Downstream',
          inputs: [{ name: 'input', schema: { type: 'number' } }],
          outputs: [{ name: 'output', schema: { type: 'number' } }],
        },
        config: {
          code: 'outputs.output = (inputs.input ?? 0) * 10;',
          runtime: 'javascript_vm',
        },
        version: 'downstream-v1',
      },
    ],
    connections: [
      {
        id: 'c1',
        sourceNodeId: 'input-node',
        sourcePort: 'value',
        targetNodeId: 'upstream-node',
        targetPort: 'input',
      },
      {
        id: 'c2',
        sourceNodeId: 'upstream-node',
        sourcePort: 'output',
        targetNodeId: 'downstream-node',
        targetPort: 'input',
      },
    ],
  };
}

test('GraphEngine recomputes downstream node after upstream result changes', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'k8v-graph-engine-test-'));
  const dbPath = path.join(tmpDir, 'k8v.db');
  const dataDir = path.join(tmpDir, 'data');
  const dataStore = new DataStore(dbPath, dataDir);
  const graphEngine = new GraphEngine(dataStore, new NodeExecutor(dataStore));
  const graph = createGraph(1);

  try {
    await dataStore.storeGraph(graph);
    const initialDownstream = await graphEngine.computeNode(graph, 'downstream-node');
    assert.equal(initialDownstream.outputs.output, 20);

    await delay(5);

    const inputNode = graph.nodes.find((node) => node.id === 'input-node');
    assert.ok(inputNode, 'expected input node to exist');
    inputNode.config = {
      ...inputNode.config,
      value: 2,
    };
    inputNode.version = 'input-v2';
    graph.updatedAt = Date.now();

    const upstreamAfterInputChange = await graphEngine.computeNode(graph, 'upstream-node');
    assert.equal(upstreamAfterInputChange.outputs.output, 3);

    const downstreamAfterUpstreamRecompute = await graphEngine.computeNode(graph, 'downstream-node');
    assert.equal(downstreamAfterUpstreamRecompute.outputs.output, 30);
  } finally {
    dataStore.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('GraphEngine recomputes once per manual recompute version', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'k8v-graph-engine-manual-recompute-test-'));
  const dbPath = path.join(tmpDir, 'k8v.db');
  const dataDir = path.join(tmpDir, 'data');
  const dataStore = new DataStore(dbPath, dataDir);
  let executionCount = 0;
  const countingRuntime: ExecutionRuntime = {
    execute: async () => {
      executionCount += 1;
      return {
        outputs: {
          count: executionCount,
        },
      };
    },
  };
  const graphEngine = new GraphEngine(
    dataStore,
    new NodeExecutor(dataStore, {
      javascript_vm: countingRuntime,
    })
  );
  const now = Date.now();
  const graph: Graph = {
    id: 'graph-manual-recompute',
    name: 'Manual Recompute Graph',
    revision: 0,
    createdAt: now,
    updatedAt: now,
    pythonEnvs: [],
    drawings: [],
    nodes: [
      {
        id: 'counter-node',
        type: NodeType.INLINE_CODE,
        position: { x: 0, y: 0 },
        metadata: {
          name: 'Counter',
          inputs: [],
          outputs: [{ name: 'count', schema: { type: 'number' } }],
        },
        config: {
          code: 'outputs.count = 1;',
          runtime: 'javascript_vm',
        },
        version: 'counter-v1',
      },
    ],
    connections: [],
  };

  try {
    await dataStore.storeGraph(graph);
    const initial = await graphEngine.computeNode(graph, 'counter-node');
    assert.equal(initial.outputs.count, 1);
    assert.equal(executionCount, 1);

    const cached = await graphEngine.computeNode(graph, 'counter-node');
    assert.equal(cached.outputs.count, 1);
    assert.equal(executionCount, 1);

    const manualRunA = await graphEngine.computeNode(graph, 'counter-node', { recomputeVersion: 1 });
    assert.equal(manualRunA.outputs.count, 2);
    assert.equal(executionCount, 2);

    const manualRunARepeated = await graphEngine.computeNode(graph, 'counter-node', { recomputeVersion: 1 });
    assert.equal(manualRunARepeated.outputs.count, 2);
    assert.equal(executionCount, 2);

    const manualRunB = await graphEngine.computeNode(graph, 'counter-node', { recomputeVersion: 2 });
    assert.equal(manualRunB.outputs.count, 3);
    assert.equal(executionCount, 3);
  } finally {
    dataStore.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('GraphEngine in-flight deduplication distinguishes node ids and versions containing colons', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'k8v-graph-engine-in-flight-key-test-'));
  const dbPath = path.join(tmpDir, 'k8v.db');
  const dataDir = path.join(tmpDir, 'data');
  const dataStore = new DataStore(dbPath, dataDir);
  const executionCountByNodeId = new Map<string, number>();
  const countingRuntime: ExecutionRuntime = {
    execute: async (request) => {
      const nodeId = request.meta?.node.id ?? 'unknown';
      executionCountByNodeId.set(
        nodeId,
        (executionCountByNodeId.get(nodeId) ?? 0) + 1
      );
      await delay(30);
      return {
        outputs: {
          value: nodeId,
        },
      };
    },
  };
  const graphEngine = new GraphEngine(
    dataStore,
    new NodeExecutor(dataStore, {
      javascript_vm: countingRuntime,
    })
  );
  const now = Date.now();
  const graph: Graph = {
    id: 'graph-in-flight-key',
    name: 'In-flight Key Graph',
    revision: 0,
    createdAt: now,
    updatedAt: now,
    pythonEnvs: [],
    drawings: [],
    nodes: [
      {
        id: 'node:a',
        type: NodeType.INLINE_CODE,
        position: { x: 0, y: 0 },
        metadata: {
          name: 'Colon In Id',
          inputs: [],
          outputs: [{ name: 'value', schema: { type: 'string' } }],
        },
        config: {
          code: 'outputs.value = "node:a";',
          runtime: 'javascript_vm',
        },
        version: 'v',
      },
      {
        id: 'node',
        type: NodeType.INLINE_CODE,
        position: { x: 200, y: 0 },
        metadata: {
          name: 'Colon In Version',
          inputs: [],
          outputs: [{ name: 'value', schema: { type: 'string' } }],
        },
        config: {
          code: 'outputs.value = "node";',
          runtime: 'javascript_vm',
        },
        version: 'a:v',
      },
    ],
    connections: [],
  };

  try {
    await dataStore.storeGraph(graph);
    const [colonIdResult, colonVersionResult] = await Promise.all([
      graphEngine.computeNode(graph, 'node:a'),
      graphEngine.computeNode(graph, 'node'),
    ]);

    assert.equal(colonIdResult.outputs.value, 'node:a');
    assert.equal(colonVersionResult.outputs.value, 'node');
    assert.equal(executionCountByNodeId.get('node:a'), 1);
    assert.equal(executionCountByNodeId.get('node'), 1);
  } finally {
    await graphEngine.dispose();
    dataStore.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('GraphEngine manual recompute does not force clean recursive dependencies', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'k8v-graph-engine-manual-scope-test-'));
  const dbPath = path.join(tmpDir, 'k8v.db');
  const dataDir = path.join(tmpDir, 'data');
  const dataStore = new DataStore(dbPath, dataDir);
  const executionCountByNodeId = new Map<string, number>();
  const countingRuntime: ExecutionRuntime = {
    execute: async (request) => {
      const nodeId = request.meta?.node.id ?? 'unknown';
      const executionCount = (executionCountByNodeId.get(nodeId) ?? 0) + 1;
      executionCountByNodeId.set(nodeId, executionCount);
      return {
        outputs: {
          output: executionCount,
        },
      };
    },
  };
  const graphEngine = new GraphEngine(
    dataStore,
    new NodeExecutor(dataStore, {
      javascript_vm: countingRuntime,
    })
  );
  const now = Date.now();
  const graph: Graph = {
    id: 'graph-manual-scope',
    name: 'Manual Recompute Scope Graph',
    revision: 0,
    createdAt: now,
    updatedAt: now,
    pythonEnvs: [],
    drawings: [],
    nodes: [
      {
        id: 'shared-source',
        type: NodeType.INLINE_CODE,
        position: { x: 0, y: 0 },
        metadata: {
          name: 'Shared Source',
          inputs: [],
          outputs: [{ name: 'output', schema: { type: 'number' } }],
        },
        config: {
          code: 'outputs.output = 1;',
          runtime: 'javascript_vm',
        },
        version: 'source-v1',
      },
      {
        id: 'lane-b-target',
        type: NodeType.INLINE_CODE,
        position: { x: 200, y: 0 },
        metadata: {
          name: 'Lane B Target',
          inputs: [{ name: 'input', schema: { type: 'number' } }],
          outputs: [{ name: 'output', schema: { type: 'number' } }],
        },
        config: {
          code: 'outputs.output = inputs.input;',
          runtime: 'javascript_vm',
        },
        version: 'target-v1',
      },
    ],
    connections: [
      {
        id: 'source-to-target',
        sourceNodeId: 'shared-source',
        sourcePort: 'output',
        targetNodeId: 'lane-b-target',
        targetPort: 'input',
      },
    ],
  };

  try {
    await dataStore.storeGraph(graph);
    const initialTarget = await graphEngine.computeNode(graph, 'lane-b-target');
    const initialSource = await dataStore.getResult(graph.id, 'shared-source');
    assert.ok(initialSource);
    assert.equal(executionCountByNodeId.get('shared-source'), 1);
    assert.equal(executionCountByNodeId.get('lane-b-target'), 1);

    await delay(5);

    const manualTarget = await graphEngine.computeNode(
      graph,
      'lane-b-target',
      { recomputeVersion: 1 }
    );
    const sourceAfterManualTarget = await dataStore.getResult(graph.id, 'shared-source');
    assert.ok(sourceAfterManualTarget);
    assert.equal(executionCountByNodeId.get('shared-source'), 1);
    assert.equal(sourceAfterManualTarget.timestamp, initialSource.timestamp);
    assert.equal(executionCountByNodeId.get('lane-b-target'), 2);
    assert.ok(manualTarget.timestamp > initialTarget.timestamp);

    await delay(5);
    const sharedSource = graph.nodes.find((node) => node.id === 'shared-source');
    assert.ok(sharedSource);
    sharedSource.version = 'source-v2';

    await graphEngine.computeNode(graph, 'lane-b-target', { recomputeVersion: 2 });
    assert.equal(executionCountByNodeId.get('shared-source'), 2);
    assert.equal(executionCountByNodeId.get('lane-b-target'), 3);
  } finally {
    dataStore.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('GraphEngine ignores presentation-link cycles when computing executable nodes', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'k8v-graph-engine-presentation-cycle-test-'));
  const dbPath = path.join(tmpDir, 'k8v.db');
  const dataDir = path.join(tmpDir, 'data');
  const dataStore = new DataStore(dbPath, dataDir);
  const graphEngine = new GraphEngine(dataStore, new NodeExecutor(dataStore));
  const now = Date.now();
  const graph: Graph = {
    id: 'graph-annotation-cycle',
    name: 'Annotation Cycle Graph',
    revision: 0,
    createdAt: now,
    updatedAt: now,
    pythonEnvs: [],
    drawings: [],
    nodes: [
      {
        id: 'left-node',
        type: NodeType.INLINE_CODE,
        position: { x: 0, y: 0 },
        metadata: {
          name: 'Left',
          inputs: [{ name: 'input', schema: { type: 'number' } }],
          outputs: [{ name: 'output', schema: { type: 'number' } }],
        },
        config: {
          code: 'outputs.output = inputs.input ?? 1;',
          runtime: 'javascript_vm',
        },
        version: 'left-v1',
      },
      {
        id: 'compute-node',
        type: NodeType.INLINE_CODE,
        position: { x: 320, y: 0 },
        metadata: {
          name: 'Compute',
          inputs: [{ name: 'input', schema: { type: 'number' } }],
          outputs: [{ name: 'output', schema: { type: 'number' } }],
        },
        config: {
          code: 'outputs.output = 1;',
          runtime: 'javascript_vm',
        },
        version: 'compute-v1',
      },
    ],
    connections: [
      {
        id: 'left-to-compute',
        sourceNodeId: 'left-node',
        sourcePort: '__annotation__',
        sourceAnchor: { side: 'bottom', offset: 0.25 },
        targetNodeId: 'compute-node',
        targetPort: '__annotation__',
        targetAnchor: { side: 'top', offset: 0.75 },
      },
      {
        id: 'compute-to-left',
        sourceNodeId: 'compute-node',
        sourcePort: '__annotation__',
        sourceAnchor: { side: 'right', offset: 0.4 },
        targetNodeId: 'left-node',
        targetPort: '__annotation__',
        targetAnchor: { side: 'left', offset: 0.6 },
      },
    ],
  };

  try {
    await dataStore.storeGraph(graph);
    const result = await graphEngine.computeNode(graph, 'compute-node');
    assert.equal(result.outputs.output, 1);
  } finally {
    dataStore.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
