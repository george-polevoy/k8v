import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { DataStore } from '../src/core/DataStore.ts';
import { GraphEngine } from '../src/core/GraphEngine.ts';
import { NodeExecutor } from '../src/core/NodeExecutor.ts';
import { RecomputeManager } from '../src/core/RecomputeManager.ts';
import { RecomputeStateStore } from '../src/core/recompute/RecomputeStateStore.ts';
import type { ExecutionRuntime } from '../src/core/execution/types.ts';
import { Graph, NodeType } from '../src/types/index.ts';

function createInlineNode(
  id: string,
  options: {
    input?: boolean;
    inputNames?: string[];
    autoRecompute?: boolean;
    version?: string;
  } = {}
) {
  const inputNames = options.inputNames ?? (options.input ? ['input'] : []);
  return {
    id,
    type: NodeType.INLINE_CODE,
    position: { x: 0, y: 0 },
    metadata: {
      name: id,
      inputs: inputNames.map((name) => ({
        name,
        schema: { type: 'number' as const },
      })),
      outputs: [{ name: 'output', schema: { type: 'number' as const } }],
    },
    config: {
      code: options.input
        ? 'outputs.output = inputs.input;'
        : 'outputs.output = 1;',
      runtime: 'javascript_vm',
      autoRecompute: options.autoRecompute ?? false,
    },
    version: options.version ?? `${id}-v1`,
  };
}

async function waitForManagerIdle(
  manager: RecomputeManager,
  graphId: string,
  attempts = 100
): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const status = await manager.getGraphStatus(graphId);
    const hasActiveNode = Object.values(status.nodeStates).some(
      (nodeState) => nodeState.isPending || nodeState.isComputing
    );
    if (status.queueLength === 0 && !hasActiveNode) {
      return;
    }
    await delay(10);
  }

  throw new Error(`Timed out waiting for recompute manager to become idle for graph ${graphId}`);
}

test('RecomputeManager orders scheduled descendants across unscheduled intermediates', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'k8v-recompute-order-test-'));
  const dataStore = new DataStore(':memory:', tmpDir);
  const executionCountByNodeId = new Map<string, number>();
  const countingRuntime: ExecutionRuntime = {
    execute: async (request) => {
      const nodeId = request.meta?.node.id ?? 'unknown';
      const executionCount = (executionCountByNodeId.get(nodeId) ?? 0) + 1;
      executionCountByNodeId.set(nodeId, executionCount);
      if (nodeId === 'manual-root') {
        await delay(60);
      }
      return {
        outputs: {
          output: nodeId === 'manual-root'
            ? executionCount
            : request.inputs.input,
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
  const manager = new RecomputeManager(dataStore, graphEngine);
  const now = Date.now();
  const graph: Graph = {
    id: 'transitive-order-graph',
    name: 'Transitive Order Graph',
    revision: 0,
    createdAt: now,
    updatedAt: now,
    pythonEnvs: [],
    drawings: [],
    recomputeConcurrency: 2,
    nodes: [
      createInlineNode('manual-root'),
      createInlineNode('manual-bridge', { input: true }),
      createInlineNode('auto-final', { input: true, autoRecompute: true }),
    ],
    connections: [
      {
        id: 'root-to-bridge',
        sourceNodeId: 'manual-root',
        sourcePort: 'output',
        targetNodeId: 'manual-bridge',
        targetPort: 'input',
      },
      {
        id: 'bridge-to-final',
        sourceNodeId: 'manual-bridge',
        sourcePort: 'output',
        targetNodeId: 'auto-final',
        targetPort: 'input',
      },
    ],
  };

  try {
    await dataStore.storeGraph(graph);
    const initialFinal = await graphEngine.computeNode(graph, 'auto-final');
    assert.equal(initialFinal.outputs.output, 1);
    assert.equal(executionCountByNodeId.get('manual-root'), 1);

    await manager.requestNodeRecompute(graph.id, 'manual-root');

    assert.equal(
      executionCountByNodeId.get('manual-root'),
      2,
      'manual root should execute exactly once for the recompute task'
    );
    assert.equal(executionCountByNodeId.get('manual-bridge'), 2);
    assert.equal(executionCountByNodeId.get('auto-final'), 2);
    const finalResult = await dataStore.getResult(graph.id, 'auto-final');
    assert.equal(finalResult?.outputs.output, 2);
  } finally {
    await graphEngine.dispose();
    dataStore.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('RecomputeManager ignores obsolete delayed pending planners after task replacement', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'k8v-recompute-generation-test-'));
  const dataStore = new DataStore(':memory:', tmpDir);
  const graphEngine = new GraphEngine(dataStore, new NodeExecutor(dataStore));
  const manager = new RecomputeManager(dataStore, graphEngine);
  const now = Date.now();
  const previousGraph: Graph = {
    id: 'planner-generation-graph',
    name: 'Planner Generation Graph',
    revision: 0,
    createdAt: now,
    updatedAt: now,
    pythonEnvs: [],
    drawings: [],
    nodes: [
      createInlineNode('node-a', { autoRecompute: true }),
      createInlineNode('node-b', { autoRecompute: true }),
    ],
    connections: [],
  };
  const nextGraphA: Graph = {
    ...structuredClone(previousGraph),
    revision: 1,
    updatedAt: now + 1,
    nodes: previousGraph.nodes.map((node) =>
      node.id === 'node-a'
        ? { ...node, version: 'node-a-v2' }
        : node
    ),
  };
  const nextGraphB: Graph = {
    ...structuredClone(nextGraphA),
    revision: 2,
    updatedAt: now + 2,
    nodes: nextGraphA.nodes.map((node) =>
      node.id === 'node-b'
        ? { ...node, version: 'node-b-v2' }
        : node
    ),
  };

  let releaseFirstPlanner!: () => void;
  const firstPlannerGate = new Promise<void>((resolve) => {
    releaseFirstPlanner = resolve;
  });
  let markFirstPlannerStarted!: () => void;
  const firstPlannerStarted = new Promise<void>((resolve) => {
    markFirstPlannerStarted = resolve;
  });
  const originalListLatestResultsForGraph =
    dataStore.listLatestResultsForGraph.bind(dataStore);
  let listCallCount = 0;
  dataStore.listLatestResultsForGraph = async (graphId, nodeIds) => {
    listCallCount += 1;
    if (listCallCount === 1) {
      markFirstPlannerStarted();
      await firstPlannerGate;
    }
    return await originalListLatestResultsForGraph(graphId, nodeIds);
  };

  try {
    await dataStore.storeGraph(previousGraph);
    await graphEngine.computeGraph(previousGraph);

    await dataStore.storeGraph(nextGraphA);
    manager.queueGraphUpdateRecompute(previousGraph, nextGraphA);
    await firstPlannerStarted;

    await dataStore.storeGraph(nextGraphB);
    manager.queueGraphUpdateRecompute(nextGraphA, nextGraphB);
    await waitForManagerIdle(manager, nextGraphB.id);

    const resultA = await dataStore.getResult(nextGraphB.id, 'node-a');
    const resultB = await dataStore.getResult(nextGraphB.id, 'node-b');
    assert.equal(resultA?.version, 'node-a-v2');
    assert.equal(resultB?.version, 'node-b-v2');

    releaseFirstPlanner();
    await delay(20);

    const status = await manager.getGraphStatus(nextGraphB.id);
    assert.equal(status.queueLength, 0);
    assert.equal(status.nodeStates['node-a']?.isPending, false);
    assert.equal(status.nodeStates['node-b']?.isPending, false);
  } finally {
    releaseFirstPlanner();
    await graphEngine.dispose();
    dataStore.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('RecomputeManager deduplicates a shared stale prerequisite across parallel descendants', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'k8v-recompute-shared-dependency-test-'));
  const dataStore = new DataStore(':memory:', tmpDir);
  const executionCountByNodeId = new Map<string, number>();
  const countingRuntime: ExecutionRuntime = {
    execute: async (request) => {
      const nodeId = request.meta?.node.id ?? 'unknown';
      const executionCount = (executionCountByNodeId.get(nodeId) ?? 0) + 1;
      executionCountByNodeId.set(nodeId, executionCount);
      if (nodeId === 'shared-prerequisite') {
        await delay(60);
      }
      return {
        outputs: {
          output: nodeId === 'final-a' || nodeId === 'final-b'
            ? Number(request.inputs.root) + Number(request.inputs.shared)
            : executionCount,
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
  const manager = new RecomputeManager(dataStore, graphEngine);
  const now = Date.now();
  const graph: Graph = {
    id: 'shared-prerequisite-graph',
    name: 'Shared Prerequisite Graph',
    revision: 0,
    createdAt: now,
    updatedAt: now,
    pythonEnvs: [],
    drawings: [],
    recomputeConcurrency: 2,
    nodes: [
      createInlineNode('manual-root'),
      createInlineNode('shared-prerequisite'),
      createInlineNode('final-a', {
        inputNames: ['root', 'shared'],
        autoRecompute: true,
      }),
      createInlineNode('final-b', {
        inputNames: ['root', 'shared'],
        autoRecompute: true,
      }),
    ],
    connections: [
      {
        id: 'root-to-a',
        sourceNodeId: 'manual-root',
        sourcePort: 'output',
        targetNodeId: 'final-a',
        targetPort: 'root',
      },
      {
        id: 'shared-to-a',
        sourceNodeId: 'shared-prerequisite',
        sourcePort: 'output',
        targetNodeId: 'final-a',
        targetPort: 'shared',
      },
      {
        id: 'root-to-b',
        sourceNodeId: 'manual-root',
        sourcePort: 'output',
        targetNodeId: 'final-b',
        targetPort: 'root',
      },
      {
        id: 'shared-to-b',
        sourceNodeId: 'shared-prerequisite',
        sourcePort: 'output',
        targetNodeId: 'final-b',
        targetPort: 'shared',
      },
    ],
  };

  try {
    await dataStore.storeGraph(graph);
    await graphEngine.computeNode(graph, 'final-a');
    await graphEngine.computeNode(graph, 'final-b');
    assert.equal(executionCountByNodeId.get('shared-prerequisite'), 1);

    const sharedPrerequisite = graph.nodes.find(
      (node) => node.id === 'shared-prerequisite'
    );
    assert.ok(sharedPrerequisite);
    sharedPrerequisite.version = 'shared-prerequisite-v2';
    graph.revision = 1;
    graph.updatedAt = now + 1;
    await dataStore.storeGraph(graph);

    await manager.requestNodeRecompute(graph.id, 'manual-root');

    assert.equal(executionCountByNodeId.get('manual-root'), 2);
    assert.equal(
      executionCountByNodeId.get('shared-prerequisite'),
      2,
      'parallel descendants should share one in-flight prerequisite computation'
    );
    assert.equal(executionCountByNodeId.get('final-a'), 2);
    assert.equal(executionCountByNodeId.get('final-b'), 2);
    const finalAResult = await dataStore.getResult(graph.id, 'final-a');
    const finalBResult = await dataStore.getResult(graph.id, 'final-b');
    assert.equal(finalAResult?.outputs.output, 4);
    assert.equal(finalBResult?.outputs.output, 4);
  } finally {
    await graphEngine.dispose();
    dataStore.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('RecomputeStateStore keeps an active computing state when a rerun becomes pending', () => {
  const stateStore = new RecomputeStateStore();
  const state = stateStore.getOrCreateGraphState('pending-rerun-graph');
  stateStore.patchNodeState(state, 'node-a', {
    isComputing: true,
  });

  stateStore.markNodesPending(state, ['node-a']);

  assert.equal(state.nodeStates['node-a']?.isComputing, true);
  assert.equal(state.nodeStates['node-a']?.isPending, true);
});
