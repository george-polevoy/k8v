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
          type: NodeType.NUMERIC_INPUT,
          config: {
            value: initialInput,
            min: 0,
            max: 100,
            step: 1,
          },
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
          type: NodeType.INLINE_CODE,
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
          type: NodeType.INLINE_CODE,
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
    const initialDownstream = await graphEngine.computeNode(graph, 'downstream-node');
    assert.equal(initialDownstream.outputs.output, 20);

    await delay(5);

    const inputNode = graph.nodes.find((node) => node.id === 'input-node');
    assert.ok(inputNode, 'expected input node to exist');
    inputNode.config = {
      ...inputNode.config,
      config: {
        ...inputNode.config.config,
        value: 2,
      },
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
          type: NodeType.INLINE_CODE,
          code: 'outputs.count = 1;',
          runtime: 'javascript_vm',
        },
        version: 'counter-v1',
      },
    ],
    connections: [],
  };

  try {
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

test('GraphEngine ignores annotation-linked cycles when computing executable nodes', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'k8v-graph-engine-annotation-cycle-test-'));
  const dbPath = path.join(tmpDir, 'k8v.db');
  const dataDir = path.join(tmpDir, 'data');
  const dataStore = new DataStore(dbPath, dataDir);
  const graphEngine = new GraphEngine(dataStore, new NodeExecutor(dataStore));
  const now = Date.now();
  const graph: Graph = {
    id: 'graph-annotation-cycle',
    name: 'Annotation Cycle Graph',
    createdAt: now,
    updatedAt: now,
    pythonEnvs: [],
    drawings: [],
    nodes: [
      {
        id: 'annotation-node',
        type: NodeType.ANNOTATION,
        position: { x: 0, y: 0 },
        metadata: {
          name: 'Annotation',
          inputs: [],
          outputs: [],
        },
        config: {
          type: NodeType.ANNOTATION,
          config: {
            text: 'Visual note',
            backgroundColor: '#fef3c7',
            borderColor: '#334155',
            fontColor: '#1f2937',
          },
        },
        version: 'annotation-v1',
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
          type: NodeType.INLINE_CODE,
          code: 'outputs.output = 1;',
          runtime: 'javascript_vm',
        },
        version: 'compute-v1',
      },
    ],
    connections: [
      {
        id: 'annotation-to-compute',
        sourceNodeId: 'annotation-node',
        sourcePort: '__annotation__',
        sourceAnchor: { side: 'bottom', offset: 0.25 },
        targetNodeId: 'compute-node',
        targetPort: 'input',
      },
      {
        id: 'compute-to-annotation',
        sourceNodeId: 'compute-node',
        sourcePort: 'output',
        targetNodeId: 'annotation-node',
        targetPort: '__annotation__',
        targetAnchor: { side: 'top', offset: 0.75 },
      },
    ],
  };

  try {
    const result = await graphEngine.computeNode(graph, 'compute-node');
    assert.equal(result.outputs.output, 1);
  } finally {
    dataStore.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
