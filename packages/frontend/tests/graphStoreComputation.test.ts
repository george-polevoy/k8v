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

test('computeNode sends a backend recompute request for only the selected node', async () => {
  const originalPost = axios.post;

  const computeOrder: string[] = [];
  const graph: Graph = {
    id: 'g-order',
    name: 'Order Graph',
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
    if (typeof body?.nodeId === 'string') {
      computeOrder.push(body.nodeId);
      return {
        data: {
          nodeId: body.nodeId,
          outputs: { output: 1 },
          schema: { output: { type: 'number' } },
          timestamp: Date.now(),
          version: `v-${body.nodeId}`,
        },
      };
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
    assert.equal(state.resultRefreshKey, 0);
  } finally {
    (axios as any).post = originalPost;
  }
});

test('computeNode refresh key updates only when the computed node is selected', async () => {
  const originalPost = axios.post;
  const baselineRefreshKey = 111;
  const graph: Graph = {
    id: 'g-selected-node-refresh',
    name: 'Selected Node Refresh Graph',
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
    if (body?.nodeId !== 'node-a') {
      throw new Error(`Unexpected POST payload: ${JSON.stringify(body)}`);
    }
    return {
      data: {
        nodeId: 'node-a',
        outputs: { output: 1 },
        schema: { output: { type: 'number' } },
        timestamp: Date.now(),
        version: 'v-node-a',
      },
    };
  };

  resetGraphStoreState({
    graph,
    selectedNodeId: 'node-a',
    resultRefreshKey: baselineRefreshKey,
  });

  try {
    await useGraphStore.getState().computeNode('node-a');
    const state = useGraphStore.getState();
    assert.notEqual(state.resultRefreshKey, baselineRefreshKey);
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
    if (typeof body?.nodeId !== 'undefined') {
      throw new Error(`Unexpected POST payload: ${JSON.stringify(body)}`);
    }

    return {
      data: ['node-a', 'node-b', 'node-c'].map((nodeId) => ({
        nodeId,
        outputs: { output: 1 },
        schema: { output: { type: 'number' } },
        timestamp: Date.now(),
        version: `v-${nodeId}-${Date.now()}`,
      })),
    };
  };

  resetGraphStoreState({
    graph,
  });

  try {
    await useGraphStore.getState().computeGraph();
    const state = useGraphStore.getState();
    assert.deepEqual(computeBodies, [{}]);
    assert.equal(state.nodeExecutionStates['node-a']?.isPending, false);
    assert.equal(state.nodeExecutionStates['node-b']?.isPending, false);
    assert.equal(state.nodeExecutionStates['node-c']?.isPending, false);
    assert.equal(state.resultRefreshKey, 0);
  } finally {
    (axios as any).post = originalPost;
  }
});

test('computeGraph refresh key updates only when selected node is in returned results', async () => {
  const originalPost = axios.post;
  const baselineRefreshKey = 222;

  const graph: Graph = {
    id: 'g-selected-graph-refresh',
    name: 'Selected Graph Refresh Graph',
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
    if (Object.keys(body ?? {}).length > 0) {
      throw new Error(`Unexpected POST payload: ${JSON.stringify(body)}`);
    }
    return {
      data: [
        {
          nodeId: 'node-a',
          outputs: { output: 1 },
          schema: { output: { type: 'number' } },
          timestamp: Date.now(),
          version: 'v-node-a',
        },
        {
          nodeId: 'node-b',
          outputs: { output: 1 },
          schema: { output: { type: 'number' } },
          timestamp: Date.now(),
          version: 'v-node-b',
        },
      ],
    };
  };

  resetGraphStoreState({
    graph,
    selectedNodeId: 'node-b',
    resultRefreshKey: baselineRefreshKey,
  });

  try {
    await useGraphStore.getState().computeGraph();
    const state = useGraphStore.getState();
    assert.notEqual(state.resultRefreshKey, baselineRefreshKey);
  } finally {
    (axios as any).post = originalPost;
  }
});

test('loadGraph hydrates node graphics outputs from persisted node results', async () => {
  (globalThis as any).localStorage = new MemoryLocalStorage();
  const originalGet = axios.get;

  const graph: Graph = {
    id: 'g-graphics-hydrate',
    name: 'Graphics Hydrate',
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
    if (url === '/api/nodes/node-python/result') {
      return {
        data: {
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
    assert.equal(url, '/api/graphs/g-node-compute/compute');
    assert.equal(body.nodeId, 'node-python');
    return {
      data: {
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
    };
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
    assert.equal(url, '/api/graphs/g-graph-compute/compute');
    assert.deepEqual(body, {});
    return {
      data: [
        {
          nodeId: 'node-python',
          outputs: {},
          schema: {},
          timestamp: Date.now(),
          version: 'r2',
        },
      ],
    };
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
