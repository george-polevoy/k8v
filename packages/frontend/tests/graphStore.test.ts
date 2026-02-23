import test from 'node:test';
import assert from 'node:assert/strict';
import axios from 'axios';
import { setTimeout as delay } from 'node:timers/promises';
import { useGraphStore } from '../src/store/graphStore.ts';
import { Graph } from '../src/types.ts';

class MemoryLocalStorage {
  private values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.has(key) ? this.values.get(key)! : null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

const makeGraph = (id: string): Graph => ({
  id,
  name: `Graph ${id}`,
  nodes: [],
  connections: [],
  createdAt: Date.now(),
  updatedAt: Date.now(),
});

test('initializeGraph recovers from stale saved graph id by loading latest graph', async () => {
  const localStorage = new MemoryLocalStorage();
  localStorage.setItem('k8v-current-graph-id', 'stale-id');
  (globalThis as any).localStorage = localStorage;

  const originalGet = axios.get;
  const originalPost = axios.post;

  (axios as any).get = async (url: string) => {
    if (url === '/api/graphs/stale-id') {
      const error: any = new Error('Graph not found');
      error.response = { status: 404 };
      throw error;
    }

    if (url === '/api/graphs/latest') {
      return { data: makeGraph('latest-id') };
    }

    throw new Error(`Unexpected GET: ${url}`);
  };

  (axios as any).post = async (_url: string, _body: unknown) => {
    throw new Error('createGraph should not be called in this test');
  };

  useGraphStore.setState({
    graph: null,
    selectedNodeId: null,
    isLoading: false,
    error: null,
  });

  try {
    await useGraphStore.getState().initializeGraph();

    const state = useGraphStore.getState();
    assert.ok(state.graph, 'expected a graph to be loaded');
    assert.equal(state.graph?.id, 'latest-id');
    assert.equal(localStorage.getItem('k8v-current-graph-id'), 'latest-id');
  } finally {
    (axios as any).get = originalGet;
    (axios as any).post = originalPost;
  }
});

test('deleteGraph replaces current graph with latest remaining graph', async () => {
  const localStorage = new MemoryLocalStorage();
  localStorage.setItem('k8v-current-graph-id', 'g-delete-current');
  (globalThis as any).localStorage = localStorage;

  const originalGet = axios.get;
  const originalDelete = (axios as any).delete;
  const currentGraph = makeGraph('g-delete-current');
  const fallbackGraph = makeGraph('g-fallback');

  (axios as any).delete = async (url: string) => {
    assert.equal(url, '/api/graphs/g-delete-current');
    return { status: 204 };
  };

  (axios as any).get = async (url: string) => {
    if (url === '/api/graphs/latest') {
      return { data: fallbackGraph };
    }
    if (url === '/api/graphs') {
      return {
        data: {
          graphs: [{ id: fallbackGraph.id, name: fallbackGraph.name, updatedAt: fallbackGraph.updatedAt }],
        },
      };
    }
    throw new Error(`Unexpected GET: ${url}`);
  };

  useGraphStore.setState({
    graph: currentGraph,
    graphSummaries: [
      { id: currentGraph.id, name: currentGraph.name, updatedAt: currentGraph.updatedAt },
      { id: fallbackGraph.id, name: fallbackGraph.name, updatedAt: fallbackGraph.updatedAt },
    ],
    selectedNodeId: null,
    selectedDrawingId: null,
    isLoading: false,
    error: null,
    resultRefreshKey: 0,
    nodeExecutionStates: {},
    nodeGraphicsOutputs: {},
  });

  try {
    await useGraphStore.getState().deleteGraph(currentGraph.id);

    const state = useGraphStore.getState();
    assert.equal(state.graph?.id, fallbackGraph.id);
    assert.equal(localStorage.getItem('k8v-current-graph-id'), fallbackGraph.id);
    assert.deepEqual(
      state.graphSummaries.map((summary) => summary.id),
      [fallbackGraph.id]
    );
  } finally {
    (axios as any).get = originalGet;
    (axios as any).delete = originalDelete;
  }
});

test('deleteGraph removes non-selected graph without switching current graph', async () => {
  const localStorage = new MemoryLocalStorage();
  localStorage.setItem('k8v-current-graph-id', 'g-keep');
  (globalThis as any).localStorage = localStorage;

  const originalGet = axios.get;
  const originalDelete = (axios as any).delete;
  const currentGraph = makeGraph('g-keep');
  const deletedGraph = makeGraph('g-drop');

  (axios as any).delete = async (url: string) => {
    assert.equal(url, '/api/graphs/g-drop');
    return { status: 204 };
  };

  (axios as any).get = async (url: string) => {
    if (url === '/api/graphs') {
      return {
        data: {
          graphs: [{ id: currentGraph.id, name: currentGraph.name, updatedAt: currentGraph.updatedAt }],
        },
      };
    }
    throw new Error(`Unexpected GET: ${url}`);
  };

  useGraphStore.setState({
    graph: currentGraph,
    graphSummaries: [
      { id: currentGraph.id, name: currentGraph.name, updatedAt: currentGraph.updatedAt },
      { id: deletedGraph.id, name: deletedGraph.name, updatedAt: deletedGraph.updatedAt },
    ],
    selectedNodeId: null,
    selectedDrawingId: null,
    isLoading: false,
    error: null,
    resultRefreshKey: 0,
    nodeExecutionStates: {},
    nodeGraphicsOutputs: {},
  });

  try {
    await useGraphStore.getState().deleteGraph(deletedGraph.id);

    const state = useGraphStore.getState();
    assert.equal(state.graph?.id, currentGraph.id);
    assert.equal(localStorage.getItem('k8v-current-graph-id'), currentGraph.id);
    assert.deepEqual(
      state.graphSummaries.map((summary) => summary.id),
      [currentGraph.id]
    );
  } finally {
    (axios as any).get = originalGet;
    (axios as any).delete = originalDelete;
  }
});

test('updateNodePosition persists position without changing node version', async () => {
  const originalPut = axios.put;
  let capturedPayload: any = null;

  const initialGraph: Graph = {
    id: 'g1',
    name: 'Graph g1',
    nodes: [
      {
        id: 'n1',
        type: 'inline_code' as any,
        position: { x: 10, y: 20 },
        metadata: {
          name: 'Node',
          inputs: [],
          outputs: [],
        },
        config: {
          type: 'inline_code' as any,
          code: 'outputs.output = 1;',
          runtime: 'javascript_vm',
        },
        version: 'node-version-1',
      },
    ],
    connections: [],
    createdAt: 1,
    updatedAt: 1,
  };

  (axios as any).put = async (_url: string, body: unknown) => {
    capturedPayload = body;
    return { data: body };
  };

  useGraphStore.setState({
    graph: initialGraph,
    selectedNodeId: null,
    isLoading: false,
    error: null,
  });

  try {
    useGraphStore.getState().updateNodePosition('n1', { x: 111, y: 222 });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const state = useGraphStore.getState();
    assert.ok(capturedPayload, 'expected updateGraph payload');
    assert.equal(capturedPayload.nodes[0].position.x, 111);
    assert.equal(capturedPayload.nodes[0].position.y, 222);
    assert.equal(capturedPayload.nodes[0].version, 'node-version-1');
    assert.equal(state.graph?.nodes[0].version, 'node-version-1');
  } finally {
    (axios as any).put = originalPut;
  }
});

test('updateNodePosition persists position to active projection nodePositions', async () => {
  const originalPut = axios.put;
  let capturedPayload: any = null;

  const initialGraph: Graph = {
    id: 'g-projections',
    name: 'Graph projections',
    nodes: [
      {
        id: 'n1',
        type: 'inline_code' as any,
        position: { x: 10, y: 20 },
        metadata: {
          name: 'Node',
          inputs: [],
          outputs: [],
        },
        config: {
          type: 'inline_code' as any,
          code: 'outputs.output = 1;',
          runtime: 'javascript_vm',
        },
        version: 'node-version-1',
      },
    ],
    connections: [],
    projections: [
      {
        id: 'default',
        name: 'Default',
        nodePositions: {
          n1: { x: 10, y: 20 },
        },
      },
      {
        id: 'alt',
        name: 'Alt',
        nodePositions: {
          n1: { x: 40, y: 50 },
        },
      },
    ],
    activeProjectionId: 'alt',
    createdAt: 1,
    updatedAt: 1,
  };

  (axios as any).put = async (_url: string, body: unknown) => {
    capturedPayload = body;
    return { data: body };
  };

  useGraphStore.setState({
    graph: initialGraph,
    selectedNodeId: null,
    isLoading: false,
    error: null,
  });

  try {
    useGraphStore.getState().updateNodePosition('n1', { x: 111, y: 222 });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const state = useGraphStore.getState();
    assert.ok(capturedPayload, 'expected updateGraph payload');
    assert.equal(capturedPayload.nodes[0].position.x, 111);
    assert.equal(capturedPayload.nodes[0].position.y, 222);

    const defaultProjection = capturedPayload.projections.find((projection: any) => projection.id === 'default');
    const altProjection = capturedPayload.projections.find((projection: any) => projection.id === 'alt');
    assert.ok(defaultProjection);
    assert.ok(altProjection);
    assert.equal(defaultProjection.nodePositions.n1.x, 10);
    assert.equal(defaultProjection.nodePositions.n1.y, 20);
    assert.equal(altProjection.nodePositions.n1.x, 111);
    assert.equal(altProjection.nodePositions.n1.y, 222);

    assert.equal(state.graph?.activeProjectionId, 'alt');
    assert.equal(state.graph?.projections?.find((projection) => projection.id === 'alt')?.nodePositions.n1.x, 111);
    assert.equal(state.graph?.projections?.find((projection) => projection.id === 'alt')?.nodePositions.n1.y, 222);
  } finally {
    (axios as any).put = originalPut;
  }
});

test('updateNodeCardSize persists dimensions without changing node version', async () => {
  const originalPut = axios.put;
  let capturedPayload: any = null;

  const initialGraph: Graph = {
    id: 'g-size',
    name: 'Graph size',
    nodes: [
      {
        id: 'n-size',
        type: 'inline_code' as any,
        position: { x: 10, y: 20 },
        metadata: {
          name: 'Node size',
          inputs: [],
          outputs: [],
        },
        config: {
          type: 'inline_code' as any,
          code: 'outputs.output = 1;',
          runtime: 'javascript_vm',
        },
        version: 'node-size-version-1',
      },
    ],
    connections: [],
    createdAt: 1,
    updatedAt: 1,
  };

  (axios as any).put = async (_url: string, body: unknown) => {
    capturedPayload = body;
    return { data: body };
  };

  useGraphStore.setState({
    graph: initialGraph,
    selectedNodeId: null,
    isLoading: false,
    error: null,
  });

  try {
    useGraphStore.getState().updateNodeCardSize('n-size', 360, 200);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const state = useGraphStore.getState();
    assert.ok(capturedPayload, 'expected updateGraph payload');
    assert.equal(capturedPayload.nodes[0].config.config.cardWidth, 360);
    assert.equal(capturedPayload.nodes[0].config.config.cardHeight, 200);
    assert.equal(capturedPayload.nodes[0].version, 'node-size-version-1');
    assert.equal(state.graph?.nodes[0].version, 'node-size-version-1');
  } finally {
    (axios as any).put = originalPut;
  }
});

test('auto recompute keeps only latest pending batch while compute is in flight', async () => {
  const originalPut = axios.put;
  const originalPost = axios.post;

  let computeCalls = 0;
  const initialGraph: Graph = {
    id: 'g-auto',
    name: 'Auto Graph',
    nodes: [
      {
        id: 'upstream',
        type: 'inline_code' as any,
        position: { x: 0, y: 0 },
        metadata: {
          name: 'Upstream',
          inputs: [],
          outputs: [{ name: 'output', schema: { type: 'number' } }],
        },
        config: {
          type: 'inline_code' as any,
          code: 'outputs.output = 1;',
          runtime: 'javascript_vm',
        },
        version: 'u-v1',
      },
      {
        id: 'downstream',
        type: 'inline_code' as any,
        position: { x: 200, y: 0 },
        metadata: {
          name: 'Downstream',
          inputs: [{ name: 'input', schema: { type: 'number' } }],
          outputs: [{ name: 'output', schema: { type: 'number' } }],
        },
        config: {
          type: 'inline_code' as any,
          code: 'outputs.output = inputs.input;',
          runtime: 'javascript_vm',
          config: { autoRecompute: true },
        },
        version: 'd-v1',
      },
    ],
    connections: [
      {
        id: 'c1',
        sourceNodeId: 'upstream',
        sourcePort: 'output',
        targetNodeId: 'downstream',
        targetPort: 'input',
      },
    ],
    createdAt: 1,
    updatedAt: 1,
  };

  (axios as any).put = async (_url: string, body: unknown) => ({ data: body });
  (axios as any).post = async (_url: string, body: any) => {
    if (body?.nodeId === 'downstream') {
      computeCalls += 1;
      await delay(120);
      return {
        data: {
          nodeId: 'downstream',
          outputs: { output: computeCalls },
          schema: { output: { type: 'number' } },
          timestamp: Date.now(),
          version: `result-${computeCalls}`,
        },
      };
    }

    throw new Error(`Unexpected POST payload: ${JSON.stringify(body)}`);
  };

  const patchUpstreamVersion = (version: string): Graph => ({
    ...initialGraph,
    nodes: initialGraph.nodes.map((node) =>
      node.id === 'upstream'
        ? { ...node, version }
        : node
    ),
    updatedAt: Date.now(),
  });

  useGraphStore.setState({
    graph: initialGraph,
    selectedNodeId: null,
    isLoading: false,
    error: null,
    resultRefreshKey: 0,
    nodeExecutionStates: {},
  });

  try {
    await useGraphStore.getState().updateGraph(patchUpstreamVersion('u-v2'));
    await useGraphStore.getState().updateGraph(patchUpstreamVersion('u-v3'));
    await useGraphStore.getState().updateGraph(patchUpstreamVersion('u-v4'));
    await useGraphStore.getState().updateGraph(patchUpstreamVersion('u-v5'));

    await delay(450);
    assert.equal(
      computeCalls,
      2,
      'expected one in-flight recompute and one latest replacement batch'
    );
  } finally {
    (axios as any).put = originalPut;
    (axios as any).post = originalPost;
  }
});

test('auto recompute runs impacted nodes in upstream-to-downstream order', async () => {
  const originalPut = axios.put;
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

  (axios as any).put = async (_url: string, body: unknown) => ({ data: body });
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

  useGraphStore.setState({
    graph,
    selectedNodeId: null,
    isLoading: false,
    error: null,
    resultRefreshKey: 0,
    nodeExecutionStates: {},
  });

  try {
    await useGraphStore.getState().updateGraph({
      ...graph,
      nodes: graph.nodes.map((node) =>
        node.id === 'node-a' ? { ...node, version: 'a-v2' } : node
      ),
      updatedAt: Date.now(),
    });

    await delay(120);
    assert.deepEqual(computeOrder, ['node-a', 'node-b', 'node-c']);
  } finally {
    (axios as any).put = originalPut;
    (axios as any).post = originalPost;
  }
});

test('auto recompute marks downstream nodes stale when an upstream node errors', async () => {
  const originalPut = axios.put;
  const originalPost = axios.post;

  let failUpstream = true;
  const computeOrder: string[] = [];

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

  (axios as any).put = async (_url: string, body: unknown) => ({ data: body });
  (axios as any).post = async (_url: string, body: any) => {
    if (typeof body?.nodeId !== 'string') {
      throw new Error(`Unexpected POST payload: ${JSON.stringify(body)}`);
    }

    computeOrder.push(body.nodeId);
    if (body.nodeId === 'node-a' && failUpstream) {
      throw new Error('Upstream failure');
    }

    return {
      data: {
        nodeId: body.nodeId,
        outputs: { output: 1 },
        schema: { output: { type: 'number' } },
        timestamp: Date.now(),
        version: `v-${body.nodeId}-${Date.now()}`,
      },
    };
  };

  useGraphStore.setState({
    graph,
    selectedNodeId: null,
    isLoading: false,
    error: null,
    resultRefreshKey: 0,
    nodeExecutionStates: {},
  });

  try {
    await useGraphStore.getState().updateGraph({
      ...graph,
      nodes: graph.nodes.map((node) =>
        node.id === 'node-a' ? { ...node, version: 'a-v2' } : node
      ),
      updatedAt: Date.now(),
    });

    await delay(120);

    let state = useGraphStore.getState();
    assert.equal(state.nodeExecutionStates['node-a']?.hasError, true);
    assert.equal(state.nodeExecutionStates['node-b']?.isStale, true);
    assert.equal(state.nodeExecutionStates['node-c']?.isStale, true);
    assert.deepEqual(computeOrder, ['node-a']);

    failUpstream = false;
    await useGraphStore.getState().updateGraph({
      ...state.graph!,
      nodes: state.graph!.nodes.map((node) =>
        node.id === 'node-a' ? { ...node, version: 'a-v3' } : node
      ),
      updatedAt: Date.now(),
    });

    await delay(120);

    state = useGraphStore.getState();
    assert.equal(state.nodeExecutionStates['node-a']?.hasError, false);
    assert.equal(state.nodeExecutionStates['node-a']?.isStale, false);
    assert.equal(state.nodeExecutionStates['node-b']?.hasError, false);
    assert.equal(state.nodeExecutionStates['node-b']?.isStale, false);
    assert.equal(state.nodeExecutionStates['node-c']?.hasError, false);
    assert.equal(state.nodeExecutionStates['node-c']?.isStale, false);
    assert.deepEqual(computeOrder, ['node-a', 'node-a', 'node-b', 'node-c']);
  } finally {
    (axios as any).put = originalPut;
    (axios as any).post = originalPost;
  }
});

test('selectDrawing clears selected node and tracks drawing selection', () => {
  useGraphStore.setState({
    selectedNodeId: 'node-1',
    selectedDrawingId: null,
  } as any);

  useGraphStore.getState().selectDrawing('drawing-1');
  let state = useGraphStore.getState();
  assert.equal(state.selectedNodeId, null);
  assert.equal(state.selectedDrawingId, 'drawing-1');

  useGraphStore.getState().selectNode('node-2');
  state = useGraphStore.getState();
  assert.equal(state.selectedNodeId, 'node-2');
  assert.equal(state.selectedDrawingId, null);
});

test('addDrawing persists drawing objects in graph payload', async () => {
  const originalPut = axios.put;
  let capturedPayload: any = null;

  const graph: Graph = {
    id: 'g-drawings',
    name: 'Drawing Graph',
    nodes: [],
    connections: [],
    drawings: [],
    createdAt: 1,
    updatedAt: 1,
  };

  (axios as any).put = async (_url: string, body: unknown) => {
    capturedPayload = body;
    return { data: body };
  };

  useGraphStore.setState({
    graph,
    selectedNodeId: null,
    selectedDrawingId: null,
    isLoading: false,
    error: null,
    nodeExecutionStates: {},
  } as any);

  try {
    useGraphStore.getState().addDrawing({
      id: 'drawing-1',
      name: 'Sketch',
      position: { x: 10, y: 20 },
      paths: [
        {
          id: 'path-1',
          color: 'green',
          thickness: 3,
          points: [{ x: 0, y: 0 }, { x: 5, y: 5 }],
        },
      ],
    });

    await delay(0);
    assert.ok(capturedPayload, 'expected graph update payload');
    assert.equal(capturedPayload.drawings.length, 1);
    assert.equal(capturedPayload.drawings[0].name, 'Sketch');
    assert.equal(capturedPayload.drawings[0].paths.length, 1);
  } finally {
    (axios as any).put = originalPut;
  }
});

test('loadGraph hydrates node graphics outputs from persisted node results', async () => {
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

  useGraphStore.setState({
    graph: null,
    selectedNodeId: null,
    selectedDrawingId: null,
    isLoading: false,
    error: null,
    resultRefreshKey: 0,
    nodeExecutionStates: {},
    nodeGraphicsOutputs: {},
  } as any);

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

  useGraphStore.setState({
    graph,
    selectedNodeId: null,
    selectedDrawingId: null,
    isLoading: false,
    error: null,
    resultRefreshKey: 0,
    nodeExecutionStates: {},
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

  useGraphStore.setState({
    graph,
    selectedNodeId: null,
    selectedDrawingId: null,
    isLoading: false,
    error: null,
    resultRefreshKey: 0,
    nodeExecutionStates: {},
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
