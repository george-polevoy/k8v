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

test('loadGraph normalizes missing graph execution timeout to 30 seconds', async () => {
  const localStorage = new MemoryLocalStorage();
  (globalThis as any).localStorage = localStorage;

  const originalGet = axios.get;
  const graphWithoutTimeout = makeGraph('g-timeout-default');

  (axios as any).get = async (url: string) => {
    if (url === '/api/graphs/g-timeout-default') {
      return { data: graphWithoutTimeout };
    }
    throw new Error(`Unexpected GET: ${url}`);
  };

  useGraphStore.setState({
    graph: null,
    selectedNodeId: null,
    isLoading: false,
    error: null,
  });

  try {
    await useGraphStore.getState().loadGraph('g-timeout-default');

    const state = useGraphStore.getState();
    assert.equal(state.graph?.id, 'g-timeout-default');
    assert.equal(state.graph?.executionTimeoutMs, 30_000);
  } finally {
    (axios as any).get = originalGet;
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

test('updateGraph reloads latest graph when backend reports conflict', async () => {
  const originalGet = axios.get;
  const originalPut = axios.put;

  const initialGraph: Graph = {
    id: 'g-conflict',
    name: 'Graph conflict local',
    nodes: [],
    connections: [],
    createdAt: 1,
    updatedAt: 100,
  };
  const latestGraph: Graph = {
    id: 'g-conflict',
    name: 'Graph conflict remote',
    nodes: [],
    connections: [],
    createdAt: 1,
    updatedAt: 200,
  };

  let putPayload: any = null;
  (axios as any).put = async (_url: string, body: unknown) => {
    putPayload = body;
    const error: any = new Error('Graph has changed since it was loaded. Reload and retry your update.');
    error.response = { status: 409 };
    throw error;
  };
  (axios as any).get = async (url: string) => {
    if (url === '/api/graphs/g-conflict') {
      return { data: latestGraph };
    }
    throw new Error(`Unexpected GET: ${url}`);
  };

  useGraphStore.setState({
    graph: initialGraph,
    selectedNodeId: null,
    selectedDrawingId: null,
    isLoading: false,
    error: null,
    nodeExecutionStates: {},
    nodeGraphicsOutputs: {},
  });

  try {
    await useGraphStore.getState().updateGraph({ name: 'Graph conflict attempted update' });

    const state = useGraphStore.getState();
    assert.ok(putPayload, 'expected PUT payload to be sent');
    assert.equal(putPayload.ifMatchUpdatedAt, 100);
    assert.equal(state.graph?.name, 'Graph conflict remote');
    assert.equal(state.graph?.updatedAt, 200);
    assert.match(state.error ?? '', /changed remotely/i);
  } finally {
    (axios as any).get = originalGet;
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
        nodeCardSizes: {
          n1: { width: 220, height: 80 },
        },
        canvasBackground: {
          mode: 'gradient',
          baseColor: '#1d437e',
        },
      },
      {
        id: 'alt',
        name: 'Alt',
        nodePositions: {
          n1: { x: 40, y: 50 },
        },
        nodeCardSizes: {
          n1: { width: 240, height: 140 },
        },
        canvasBackground: {
          mode: 'solid',
          baseColor: '#204060',
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

test('updateNodeCardSize persists dimensions to active projection nodeCardSizes', async () => {
  const originalPut = axios.put;
  let capturedPayload: any = null;

  const initialGraph: Graph = {
    id: 'g-size-proj',
    name: 'Graph size projections',
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
          config: {
            cardWidth: 220,
            cardHeight: 80,
          },
        },
        version: 'node-size-version-1',
      },
    ],
    connections: [],
    projections: [
      {
        id: 'default',
        name: 'Default',
        nodePositions: { 'n-size': { x: 10, y: 20 } },
        nodeCardSizes: { 'n-size': { width: 220, height: 80 } },
        canvasBackground: { mode: 'gradient', baseColor: '#1d437e' },
      },
      {
        id: 'alt',
        name: 'Alt',
        nodePositions: { 'n-size': { x: 10, y: 20 } },
        nodeCardSizes: { 'n-size': { width: 320, height: 160 } },
        canvasBackground: { mode: 'solid', baseColor: '#204060' },
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
    useGraphStore.getState().updateNodeCardSize('n-size', 360, 200);
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.ok(capturedPayload, 'expected updateGraph payload');
    const defaultProjection = capturedPayload.projections.find((projection: any) => projection.id === 'default');
    const altProjection = capturedPayload.projections.find((projection: any) => projection.id === 'alt');
    assert.ok(defaultProjection);
    assert.ok(altProjection);
    assert.equal(defaultProjection.nodeCardSizes['n-size'].width, 220);
    assert.equal(defaultProjection.nodeCardSizes['n-size'].height, 80);
    assert.equal(altProjection.nodeCardSizes['n-size'].width, 360);
    assert.equal(altProjection.nodeCardSizes['n-size'].height, 200);
  } finally {
    (axios as any).put = originalPut;
  }
});

test('graph updates do not trigger frontend auto recompute requests', async () => {
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
    computeCalls += 1;
    throw new Error(`Unexpected compute request: ${JSON.stringify(body)}`);
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
    await delay(0);
    assert.equal(computeCalls, 0);
  } finally {
    (axios as any).put = originalPut;
    (axios as any).post = originalPost;
  }
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

  useGraphStore.setState({
    graph,
    selectedNodeId: null,
    isLoading: false,
    error: null,
    resultRefreshKey: 0,
    nodeExecutionStates: {},
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

  useGraphStore.setState({
    graph,
    selectedNodeId: 'node-a',
    isLoading: false,
    error: null,
    resultRefreshKey: baselineRefreshKey,
    nodeExecutionStates: {},
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

  useGraphStore.setState({
    graph,
    selectedNodeId: null,
    isLoading: false,
    error: null,
    resultRefreshKey: 0,
    nodeExecutionStates: {},
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

  useGraphStore.setState({
    graph,
    selectedNodeId: 'node-b',
    isLoading: false,
    error: null,
    resultRefreshKey: baselineRefreshKey,
    nodeExecutionStates: {},
  });

  try {
    await useGraphStore.getState().computeGraph();
    const state = useGraphStore.getState();
    assert.notEqual(state.resultRefreshKey, baselineRefreshKey);
  } finally {
    (axios as any).post = originalPost;
  }
});

test('selectDrawing clears selected node and tracks drawing selection', () => {
  useGraphStore.setState({
    selectedNodeId: 'node-1',
    selectedDrawingId: null,
    selectedNodeGraphicsDebug: {
      nodeId: 'node-1',
      nodeType: 'python_process',
      hasGraphicsOutput: true,
      isRenderableGraphics: true,
      graphicsId: 'gfx-1',
      mimeType: 'image/png',
      levelCount: 1,
      levelPixels: [4096],
      viewportScale: 1,
      projectionWidth: 220,
      projectedWidthOnScreen: 220,
      devicePixelRatio: 1,
      estimatedMaxPixels: 4096,
      stableMaxPixels: 4096,
      selectedLevel: 0,
      selectedLevelPixels: 4096,
      shouldLoadProjectedGraphicsByViewport: true,
      canReloadProjectedGraphics: true,
      shouldLoadProjectedGraphics: true,
      requestUrl: '/api/graphics/gfx-1/image?maxPixels=4096',
    },
  } as any);

  useGraphStore.getState().selectDrawing('drawing-1');
  let state = useGraphStore.getState();
  assert.equal(state.selectedNodeId, null);
  assert.equal(state.selectedDrawingId, 'drawing-1');
  assert.equal(state.selectedNodeGraphicsDebug, null);

  useGraphStore.getState().setSelectedNodeGraphicsDebug({
    nodeId: 'node-2',
    nodeType: 'python_process',
    hasGraphicsOutput: true,
    isRenderableGraphics: true,
    graphicsId: 'gfx-2',
    mimeType: 'image/png',
    levelCount: 1,
    levelPixels: [1024],
    viewportScale: 1,
    projectionWidth: 220,
    projectedWidthOnScreen: 220,
    devicePixelRatio: 1,
    estimatedMaxPixels: 1024,
    stableMaxPixels: 1024,
    selectedLevel: 0,
    selectedLevelPixels: 1024,
    shouldLoadProjectedGraphicsByViewport: true,
    canReloadProjectedGraphics: true,
    shouldLoadProjectedGraphics: true,
    requestUrl: '/api/graphics/gfx-2/image?maxPixels=1024',
  });

  useGraphStore.getState().selectNode('node-2');
  state = useGraphStore.getState();
  assert.equal(state.selectedNodeId, 'node-2');
  assert.equal(state.selectedDrawingId, null);
  assert.equal(state.selectedNodeGraphicsDebug, null);
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
