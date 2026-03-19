import test from 'node:test';
import assert from 'node:assert/strict';
import axios from 'axios';
import { useGraphStore } from '../src/store/graphStore.ts';
import type { Graph } from '../src/types.ts';
import {
  MemoryLocalStorage,
  resetGraphStoreState,
} from './graphStoreTestUtils.ts';

test.beforeEach(() => {
  (globalThis as any).localStorage = new MemoryLocalStorage();
  resetGraphStoreState();
});

function buildRuntimeState(
  graph: Graph,
  params: {
    statusVersion?: number;
    results?: Record<string, any>;
    nodeStates?: Record<string, any>;
  } = {}
) {
  const nodeStates = Object.fromEntries(
    graph.nodes.map((node) => [
      node.id,
      {
        isPending: false,
        isComputing: false,
        hasError: false,
        isStale: false,
        errorMessage: null,
        lastRunAt: null,
        ...(params.nodeStates?.[node.id] ?? {}),
      },
    ])
  );

  return {
    graphId: graph.id,
    revision: graph.revision ?? 0,
    statusVersion: params.statusVersion ?? 1,
    queueLength: 0,
    workerConcurrency: graph.recomputeConcurrency ?? 1,
    nodeStates,
    results: params.results ?? {},
  };
}

function buildCommandResponse(
  graph: Graph,
  params: Parameters<typeof buildRuntimeState>[1] = {}
) {
  const persistedGraph: Graph = {
    ...graph,
    revision: graph.revision ?? 0,
  };

  return {
    data: {
      graph: persistedGraph,
      runtimeState: buildRuntimeState(persistedGraph, params),
    },
  };
}

test('computeNode sends a backend recompute request for only the selected node', async () => {
  const originalPost = axios.post;

  const computeOrder: string[] = [];
  const graph: Graph = {
    id: 'g-order',
    name: 'Order Graph',
    revision: 0,
    nodes: [
      {
        id: 'node-c',
        type: 'inline_code' as any,
        position: { x: 400, y: 0 },
        metadata: {
          name: 'C',
          inputs: [{ name: 'input', schema: { type: 'number' } }],
          outputs: [{ name: 'output', schema: { type: 'number' } }],
        },
        config: {
          type: 'inline_code' as any,
          code: 'outputs.output = inputs.input;',
          runtime: 'javascript_vm',
          config: { autoRecompute: true },
        },
        version: 'c-v1',
      },
      {
        id: 'node-b',
        type: 'inline_code' as any,
        position: { x: 200, y: 0 },
        metadata: {
          name: 'B',
          inputs: [{ name: 'input', schema: { type: 'number' } }],
          outputs: [{ name: 'output', schema: { type: 'number' } }],
        },
        config: {
          type: 'inline_code' as any,
          code: 'outputs.output = inputs.input;',
          runtime: 'javascript_vm',
          config: { autoRecompute: true },
        },
        version: 'b-v1',
      },
      {
        id: 'node-a',
        type: 'inline_code' as any,
        position: { x: 0, y: 0 },
        metadata: {
          name: 'A',
          inputs: [],
          outputs: [{ name: 'output', schema: { type: 'number' } }],
        },
        config: {
          type: 'inline_code' as any,
          code: 'outputs.output = 1;',
          runtime: 'javascript_vm',
          config: { autoRecompute: true },
        },
        version: 'a-v1',
      },
    ],
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
    createdAt: 1,
    updatedAt: 1,
  };

  (axios as any).post = async (_url: string, body: any) => {
    if (Array.isArray(body?.commands) && body.commands[0]?.kind === 'compute_node') {
      computeOrder.push(body.commands[0].nodeId);
      return buildCommandResponse(graph, {
        results: {
          [body.commands[0].nodeId]: {
            nodeId: body.commands[0].nodeId,
            outputs: { output: 1 },
            schema: { output: { type: 'number' } },
            timestamp: Date.now(),
            version: `v-${body.commands[0].nodeId}`,
          },
        },
      });
    }
    throw new Error(`Unexpected POST payload: ${JSON.stringify(body)}`);
  };

  resetGraphStoreState({
    graph,
  });

  try {
    await useGraphStore.getState().computeNode('node-a');
    const state = useGraphStore.getState();
    assert.deepEqual(computeOrder, ['node-a']);
    assert.equal(state.nodeExecutionStates['node-a']?.hasError, false);
    assert.equal(state.nodeExecutionStates['node-a']?.isPending, false);
    assert.equal(state.nodeExecutionStates['node-a']?.isComputing, false);
    assert.equal(state.nodeResults['node-a']?.outputs.output, 1);
  } finally {
    (axios as any).post = originalPost;
  }
});

test('computeNode stores the returned runtime result for the computed node', async () => {
  const originalPost = axios.post;
  const graph: Graph = {
    id: 'g-selected-node-refresh',
    name: 'Selected Node Refresh Graph',
    revision: 0,
    nodes: [
      {
        id: 'node-a',
        type: 'inline_code' as any,
        position: { x: 0, y: 0 },
        metadata: {
          name: 'A',
          inputs: [],
          outputs: [{ name: 'output', schema: { type: 'number' } }],
        },
        config: {
          type: 'inline_code' as any,
          code: 'outputs.output = 1;',
          runtime: 'javascript_vm',
          config: { autoRecompute: true },
        },
        version: 'a-v1',
      },
    ],
    connections: [],
    createdAt: 1,
    updatedAt: 1,
  };

  (axios as any).post = async (_url: string, body: any) => {
    if (body?.commands?.[0]?.kind !== 'compute_node' || body.commands[0].nodeId !== 'node-a') {
      throw new Error(`Unexpected POST payload: ${JSON.stringify(body)}`);
    }
    return buildCommandResponse(graph, {
      results: {
        'node-a': {
          nodeId: 'node-a',
          outputs: { output: 1 },
          schema: { output: { type: 'number' } },
          timestamp: Date.now(),
          version: 'v-node-a',
        },
      },
    });
  };

  resetGraphStoreState({
    graph,
    selectedNodeId: 'node-a',
    selectedNodeIds: ['node-a'],
  });

  try {
    await useGraphStore.getState().computeNode('node-a');
    const state = useGraphStore.getState();
    assert.equal(state.nodeResults['node-a']?.version, 'v-node-a');
    assert.equal(state.nodeResults['node-a']?.outputs.output, 1);
  } finally {
    (axios as any).post = originalPost;
  }
});

test('computeGraph sends a single backend recompute request', async () => {
  const originalPost = axios.post;

  const computeBodies: any[] = [];

  const graph: Graph = {
    id: 'g-stale',
    name: 'Stale Graph',
    revision: 0,
    nodes: [
      {
        id: 'node-a',
        type: 'inline_code' as any,
        position: { x: 0, y: 0 },
        metadata: {
          name: 'A',
          inputs: [],
          outputs: [{ name: 'output', schema: { type: 'number' } }],
        },
        config: {
          type: 'inline_code' as any,
          code: 'outputs.output = 1;',
          runtime: 'javascript_vm',
          config: { autoRecompute: true },
        },
        version: 'a-v1',
      },
      {
        id: 'node-b',
        type: 'inline_code' as any,
        position: { x: 200, y: 0 },
        metadata: {
          name: 'B',
          inputs: [{ name: 'input', schema: { type: 'number' } }],
          outputs: [{ name: 'output', schema: { type: 'number' } }],
        },
        config: {
          type: 'inline_code' as any,
          code: 'outputs.output = inputs.input;',
          runtime: 'javascript_vm',
          config: { autoRecompute: true },
        },
        version: 'b-v1',
      },
      {
        id: 'node-c',
        type: 'inline_code' as any,
        position: { x: 400, y: 0 },
        metadata: {
          name: 'C',
          inputs: [{ name: 'input', schema: { type: 'number' } }],
          outputs: [{ name: 'output', schema: { type: 'number' } }],
        },
        config: {
          type: 'inline_code' as any,
          code: 'outputs.output = inputs.input;',
          runtime: 'javascript_vm',
          config: { autoRecompute: true },
        },
        version: 'c-v1',
      },
    ],
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
    createdAt: 1,
    updatedAt: 1,
  };

  (axios as any).post = async (_url: string, body: any) => {
    computeBodies.push(body);
    if (body?.commands?.[0]?.kind !== 'compute_graph') {
      throw new Error(`Unexpected POST payload: ${JSON.stringify(body)}`);
    }

    return buildCommandResponse(graph, {
      results: Object.fromEntries(
        ['node-a', 'node-b', 'node-c'].map((nodeId) => [
          nodeId,
          {
            nodeId,
            outputs: { output: 1 },
            schema: { output: { type: 'number' } },
            timestamp: Date.now(),
            version: `v-${nodeId}-${Date.now()}`,
          },
        ])
      ),
    });
  };

  resetGraphStoreState({
    graph,
  });

  try {
    await useGraphStore.getState().computeGraph();
    const state = useGraphStore.getState();
    assert.deepEqual(computeBodies, [{ baseRevision: 0, commands: [{ kind: 'compute_graph' }] }]);
    assert.equal(state.nodeExecutionStates['node-a']?.isPending, false);
    assert.equal(state.nodeExecutionStates['node-b']?.isPending, false);
    assert.equal(state.nodeExecutionStates['node-c']?.isPending, false);
    assert.equal(state.nodeResults['node-a']?.outputs.output, 1);
    assert.equal(state.nodeResults['node-b']?.outputs.output, 1);
    assert.equal(state.nodeResults['node-c']?.outputs.output, 1);
  } finally {
    (axios as any).post = originalPost;
  }
});

test('computeGraph stores runtime results for returned nodes', async () => {
  const originalPost = axios.post;

  const graph: Graph = {
    id: 'g-selected-graph-refresh',
    name: 'Selected Graph Refresh Graph',
    revision: 0,
    nodes: [
      {
        id: 'node-a',
        type: 'inline_code' as any,
        position: { x: 0, y: 0 },
        metadata: {
          name: 'A',
          inputs: [],
          outputs: [{ name: 'output', schema: { type: 'number' } }],
        },
        config: {
          type: 'inline_code' as any,
          code: 'outputs.output = 1;',
          runtime: 'javascript_vm',
          config: { autoRecompute: true },
        },
        version: 'a-v1',
      },
      {
        id: 'node-b',
        type: 'inline_code' as any,
        position: { x: 200, y: 0 },
        metadata: {
          name: 'B',
          inputs: [{ name: 'input', schema: { type: 'number' } }],
          outputs: [{ name: 'output', schema: { type: 'number' } }],
        },
        config: {
          type: 'inline_code' as any,
          code: 'outputs.output = inputs.input;',
          runtime: 'javascript_vm',
          config: { autoRecompute: true },
        },
        version: 'b-v1',
      },
    ],
    connections: [
      {
        id: 'ab',
        sourceNodeId: 'node-a',
        sourcePort: 'output',
        targetNodeId: 'node-b',
        targetPort: 'input',
      },
    ],
    createdAt: 1,
    updatedAt: 1,
  };

  (axios as any).post = async (_url: string, body: any) => {
    if (body?.commands?.[0]?.kind !== 'compute_graph') {
      throw new Error(`Unexpected POST payload: ${JSON.stringify(body)}`);
    }
    return buildCommandResponse(graph, {
      results: {
        'node-a': {
          nodeId: 'node-a',
          outputs: { output: 1 },
          schema: { output: { type: 'number' } },
          timestamp: Date.now(),
          version: 'v-node-a',
        },
        'node-b': {
          nodeId: 'node-b',
          outputs: { output: 1 },
          schema: { output: { type: 'number' } },
          timestamp: Date.now(),
          version: 'v-node-b',
        },
      },
    });
  };

  resetGraphStoreState({
    graph,
    selectedNodeId: 'node-b',
    selectedNodeIds: ['node-b'],
  });

  try {
    await useGraphStore.getState().computeGraph();
    const state = useGraphStore.getState();
    assert.equal(state.nodeResults['node-a']?.version, 'v-node-a');
    assert.equal(state.nodeResults['node-b']?.version, 'v-node-b');
  } finally {
    (axios as any).post = originalPost;
  }
});

test('runtime-state refresh preserves prior node results when results payload omits that node', async () => {
  const originalGet = axios.get;
  const graph: Graph = {
    id: 'g-sparse-runtime-results',
    name: 'Sparse Runtime Results Graph',
    revision: 0,
    nodes: [
      {
        id: 'node-a',
        type: 'inline_code' as any,
        position: { x: 0, y: 0 },
        metadata: {
          name: 'A',
          inputs: [],
          outputs: [{ name: 'output', schema: { type: 'number' } }],
        },
        config: {
          type: 'inline_code' as any,
          code: 'outputs.output = 1;',
          runtime: 'python_process',
        },
        version: 'a-v1',
      },
    ],
    connections: [],
    createdAt: 1,
    updatedAt: 1,
  };

  const existingResult = {
    nodeId: 'node-a',
    outputs: { output: 1 },
    schema: { output: { type: 'number' } },
    timestamp: Date.now(),
    version: 'v-node-a',
    graphics: {
      id: 'gfx-existing',
      mimeType: 'image/png',
      levels: [
        { level: 0, width: 64, height: 64, pixelCount: 4096 },
      ],
    },
  };

  (axios as any).get = async (url: string) => {
    if (url === '/api/graphs/g-sparse-runtime-results') {
      return { data: graph };
    }
    if (url === '/api/graphs/g-sparse-runtime-results/runtime-state') {
      return {
        data: buildRuntimeState(graph, {
          statusVersion: 2,
          results: {},
          nodeStates: {
            'node-a': {
              isPending: false,
              isComputing: false,
              hasError: false,
              isStale: false,
              errorMessage: null,
              lastRunAt: existingResult.timestamp,
            },
          },
        }),
      };
    }
    throw new Error(`Unexpected GET: ${url}`);
  };

  resetGraphStoreState({
    graph,
    nodeResults: { 'node-a': existingResult as any },
    nodeGraphicsOutputs: { 'node-a': existingResult.graphics as any },
  });

  try {
    await useGraphStore.getState().loadGraph(graph.id);
    const state = useGraphStore.getState();
    assert.equal(state.nodeResults['node-a']?.version, 'v-node-a');
    assert.equal(state.nodeResults['node-a']?.graphics?.id, 'gfx-existing');
    assert.equal(state.nodeGraphicsOutputs['node-a']?.id, 'gfx-existing');
  } finally {
    (axios as any).get = originalGet;
  }
});

test('loadGraph hydrates node graphics outputs from persisted node results', async () => {
  (globalThis as any).localStorage = new MemoryLocalStorage();
  const originalGet = axios.get;

  const graph: Graph = {
    id: 'g-graphics-hydrate',
    name: 'Graphics Hydrate',
    revision: 0,
    nodes: [
      {
        id: 'node-python',
        type: 'inline_code' as any,
        position: { x: 0, y: 0 },
        metadata: {
          name: 'Python Node',
          inputs: [],
          outputs: [],
        },
        config: {
          type: 'inline_code' as any,
          runtime: 'python_process',
          code: 'outputPng("abc")',
        },
        version: 'v1',
      },
    ],
    connections: [],
    createdAt: 1,
    updatedAt: 1,
  };

  (axios as any).get = async (url: string) => {
    if (url === '/api/graphs/g-graphics-hydrate') {
      return { data: graph };
    }
    if (url === '/api/graphs/g-graphics-hydrate/runtime-state') {
      return {
        data: buildRuntimeState(graph, {
          results: {
            'node-python': {
              nodeId: 'node-python',
              outputs: {},
              schema: {},
              timestamp: Date.now(),
              version: 'r1',
              graphics: {
                id: 'gfx-hydrated',
                mimeType: 'image/png',
                levels: [
                  {
                    level: 0,
                    width: 64,
                    height: 32,
                    pixelCount: 2048,
                  },
                ],
              },
            },
          },
        }),
      };
    }
    throw new Error(`Unexpected GET: ${url}`);
  };

  try {
    await useGraphStore.getState().loadGraph('g-graphics-hydrate');
    const state = useGraphStore.getState();
    assert.equal(state.nodeGraphicsOutputs['node-python']?.id, 'gfx-hydrated');
    assert.equal(state.nodeGraphicsOutputs['node-python']?.levels[0]?.pixelCount, 2048);
  } finally {
    (axios as any).get = originalGet;
  }
});

test('computeNode updates graphics output cache for the computed node', async () => {
  const originalPost = axios.post;

  const graph: Graph = {
    id: 'g-node-compute',
    name: 'Node Compute',
    revision: 0,
    nodes: [
      {
        id: 'node-python',
        type: 'inline_code' as any,
        position: { x: 0, y: 0 },
        metadata: {
          name: 'Python Node',
          inputs: [],
          outputs: [],
        },
        config: {
          type: 'inline_code' as any,
          runtime: 'python_process',
          code: 'outputPng("abc")',
        },
        version: 'v1',
      },
    ],
    connections: [],
    createdAt: 1,
    updatedAt: 1,
  };

  (axios as any).post = async (url: string, body: any) => {
    assert.equal(url, '/api/graphs/g-node-compute/commands');
    assert.deepEqual(body, {
      baseRevision: 0,
      commands: [{ kind: 'compute_node', nodeId: 'node-python' }],
    });
    return buildCommandResponse(graph, {
      results: {
        'node-python': {
          nodeId: 'node-python',
          outputs: {},
          schema: {},
          timestamp: Date.now(),
          version: 'r1',
          graphics: {
            id: 'gfx-compute-node',
            mimeType: 'image/png',
            levels: [
              {
                level: 0,
                width: 80,
                height: 40,
                pixelCount: 3200,
              },
            ],
          },
        },
      },
    });
  };

  resetGraphStoreState({
    graph,
    nodeGraphicsOutputs: {
      'node-python': null,
    },
  } as any);

  try {
    await useGraphStore.getState().computeNode('node-python');
    const state = useGraphStore.getState();
    assert.equal(state.nodeGraphicsOutputs['node-python']?.id, 'gfx-compute-node');
  } finally {
    (axios as any).post = originalPost;
  }
});

test('computeGraph clears cached graphics output when latest result has no graphics payload', async () => {
  const originalPost = axios.post;

  const graph: Graph = {
    id: 'g-graph-compute',
    name: 'Graph Compute',
    revision: 0,
    nodes: [
      {
        id: 'node-python',
        type: 'inline_code' as any,
        position: { x: 0, y: 0 },
        metadata: {
          name: 'Python Node',
          inputs: [],
          outputs: [],
        },
        config: {
          type: 'inline_code' as any,
          runtime: 'python_process',
          code: 'print("hi")',
        },
        version: 'v1',
      },
    ],
    connections: [],
    createdAt: 1,
    updatedAt: 1,
  };

  (axios as any).post = async (url: string, body: any) => {
    assert.equal(url, '/api/graphs/g-graph-compute/commands');
    assert.deepEqual(body, {
      baseRevision: 0,
      commands: [{ kind: 'compute_graph' }],
    });
    return buildCommandResponse(graph, {
      results: {
        'node-python': {
          nodeId: 'node-python',
          outputs: {},
          schema: {},
          timestamp: Date.now(),
          version: 'r2',
        },
      },
    });
  };

  resetGraphStoreState({
    graph,
    nodeGraphicsOutputs: {
      'node-python': {
        id: 'gfx-old',
        mimeType: 'image/png',
        levels: [
          {
            level: 0,
            width: 64,
            height: 32,
            pixelCount: 2048,
          },
        ],
      },
    },
  } as any);

  try {
    await useGraphStore.getState().computeGraph();
    const state = useGraphStore.getState();
    assert.equal(state.nodeGraphicsOutputs['node-python'], null);
  } finally {
    (axios as any).post = originalPost;
  }
});
