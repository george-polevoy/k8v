import test from 'node:test';
import assert from 'node:assert/strict';
import axios from 'axios';
import { setTimeout as delay } from 'node:timers/promises';
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

function buildRuntimeState(graph: Graph) {
  return {
    graphId: graph.id,
    revision: graph.revision,
    statusVersion: 0,
    cursor: `cursor-${graph.id}-0`,
    queueLength: 0,
    workerConcurrency: graph.recomputeConcurrency ?? 1,
    nodeStates: {},
    results: {},
  };
}

function buildCommandResponse(graph: Graph) {
  const persistedGraph: Graph = {
    ...graph,
    revision: graph.revision ?? 1,
  };

  return {
    data: {
      graph: persistedGraph,
      runtimeState: buildRuntimeState(persistedGraph),
    },
  };
}

function extractCommandUpdatePayload(body: any): any {
  const payload: Record<string, unknown> = {
    baseRevision: body?.baseRevision,
  };

  for (const command of body?.commands ?? []) {
    switch (command.kind) {
      case 'set_graph_name':
        payload.name = command.name;
        break;
      case 'set_recompute_concurrency':
        payload.recomputeConcurrency = command.recomputeConcurrency;
        break;
      case 'set_execution_timeout':
        payload.executionTimeoutMs = command.executionTimeoutMs;
        break;
      case 'set_connection_stroke':
        payload.connectionStroke = command.connectionStroke;
        break;
      case 'set_canvas_background':
        payload.canvasBackground = command.canvasBackground;
        break;
      case 'set_active_projection':
        payload.activeProjectionId = command.activeProjectionId;
        break;
      case 'replace_python_envs':
        payload.pythonEnvs = command.pythonEnvs;
        break;
      case 'replace_cameras':
        payload.cameras = command.cameras;
        break;
      case 'replace_drawings':
        payload.drawings = command.drawings;
        break;
      case 'replace_nodes':
        payload.nodes = command.nodes;
        break;
      case 'replace_connections':
        payload.connections = command.connections;
        break;
      case 'replace_projections':
        payload.projections = command.projections;
        break;
      default:
        break;
    }
  }

  return payload;
}

test('updateNodePosition persists position without changing node version', async () => {
  const originalPost = axios.post;
  let capturedPayload: any = null;

  const initialGraph: Graph = {
    id: 'g1',
    name: 'Graph g1',
    revision: 0,
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

  (axios as any).post = async (_url: string, body: unknown) => {
    capturedPayload = extractCommandUpdatePayload(body);
    return buildCommandResponse({
      ...initialGraph,
      revision: 1,
      nodes: [
        {
          ...initialGraph.nodes[0],
          position: { x: 111, y: 222 },
        },
      ],
      updatedAt: 2,
    });
  };

  resetGraphStoreState({ graph: initialGraph });

  try {
    useGraphStore.getState().updateNodePosition('n1', { x: 111, y: 222 });
    await delay(0);

    const state = useGraphStore.getState();
    assert.ok(capturedPayload, 'expected updateGraph payload');
    assert.equal(capturedPayload.nodes[0].position.x, 111);
    assert.equal(capturedPayload.nodes[0].position.y, 222);
    assert.equal(capturedPayload.nodes[0].version, 'node-version-1');
    assert.equal(state.graph?.nodes[0].version, 'node-version-1');
  } finally {
    (axios as any).post = originalPost;
  }
});

test('updateNodePosition persists position to active projection nodePositions', async () => {
  const originalPost = axios.post;
  let capturedPayload: any = null;

  const initialGraph: Graph = {
    id: 'g-projections',
    name: 'Graph projections',
    revision: 0,
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

  (axios as any).post = async (_url: string, body: unknown) => {
    capturedPayload = extractCommandUpdatePayload(body);
    return buildCommandResponse({
      ...initialGraph,
      revision: 1,
      nodes: [
        {
          ...initialGraph.nodes[0],
          position: { x: 111, y: 222 },
        },
      ],
      projections: [
        initialGraph.projections![0],
        {
          ...initialGraph.projections![1],
          nodePositions: {
            n1: { x: 111, y: 222 },
          },
        },
      ],
      updatedAt: 2,
    });
  };

  resetGraphStoreState({ graph: initialGraph });

  try {
    useGraphStore.getState().updateNodePosition('n1', { x: 111, y: 222 });
    await delay(0);

    const state = useGraphStore.getState();
    assert.ok(capturedPayload, 'expected updateGraph payload');
    assert.equal(capturedPayload.nodes?.[0]?.position?.x, 111);
    assert.equal(capturedPayload.nodes?.[0]?.position?.y, 222);
    assert.equal(state.graph?.projections?.find((projection) => projection.id === 'alt')?.nodePositions.n1.x, 111);
    assert.equal(state.graph?.projections?.find((projection) => projection.id === 'alt')?.nodePositions.n1.y, 222);
    assert.equal(state.graph?.projections?.find((projection) => projection.id === 'default')?.nodePositions.n1.x, 10);
    assert.equal(state.graph?.projections?.find((projection) => projection.id === 'default')?.nodePositions.n1.y, 20);
  } finally {
    (axios as any).post = originalPost;
  }
});

test('updateNodeCardSize persists dimensions without changing node version', async () => {
  const originalPost = axios.post;
  let capturedPayload: any = null;

  const initialGraph: Graph = {
    id: 'g-size',
    name: 'Graph size',
    revision: 0,
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

  (axios as any).post = async (_url: string, body: unknown) => {
    capturedPayload = extractCommandUpdatePayload(body);
    return buildCommandResponse({
      ...initialGraph,
      revision: 1,
      nodes: [
        {
          ...initialGraph.nodes[0],
          config: {
            ...initialGraph.nodes[0].config,
            cardWidth: 360,
            cardHeight: 200,
          },
        },
      ],
      updatedAt: 2,
    });
  };

  resetGraphStoreState({ graph: initialGraph });

  try {
    useGraphStore.getState().updateNodeCardSize('n-size', 360, 200);
    await delay(0);

    const state = useGraphStore.getState();
    assert.ok(capturedPayload, 'expected updateGraph payload');
    assert.equal(capturedPayload.nodes[0].config.cardWidth, 360);
    assert.equal(capturedPayload.nodes[0].config.cardHeight, 200);
    assert.equal(capturedPayload.nodes[0].version, 'node-size-version-1');
    assert.equal(state.graph?.nodes[0].version, 'node-size-version-1');
  } finally {
    (axios as any).post = originalPost;
  }
});

test('updateNodeCardSize persists dimensions to active projection nodeCardSizes', async () => {
  const originalPost = axios.post;
  let capturedPayload: any = null;

  const initialGraph: Graph = {
    id: 'g-size-proj',
    name: 'Graph size projections',
    revision: 0,
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
          code: 'outputs.output = 1;',
          runtime: 'javascript_vm',
          cardWidth: 220,
          cardHeight: 80,
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

  (axios as any).post = async (_url: string, body: unknown) => {
    capturedPayload = extractCommandUpdatePayload(body);
    return buildCommandResponse({
      ...initialGraph,
      revision: 1,
      nodes: [
        {
          ...initialGraph.nodes[0],
          config: {
            ...initialGraph.nodes[0].config,
            cardWidth: 360,
            cardHeight: 200,
          },
        },
      ],
      projections: [
        initialGraph.projections![0],
        {
          ...initialGraph.projections![1],
          nodeCardSizes: {
            'n-size': { width: 360, height: 200 },
          },
        },
      ],
      updatedAt: 2,
    });
  };

  resetGraphStoreState({ graph: initialGraph });

  try {
    useGraphStore.getState().updateNodeCardSize('n-size', 360, 200);
    await delay(0);

    const state = useGraphStore.getState();
    assert.ok(capturedPayload, 'expected updateGraph payload');
    assert.equal(capturedPayload.nodes?.[0]?.config?.cardWidth, 360);
    assert.equal(capturedPayload.nodes?.[0]?.config?.cardHeight, 200);
    assert.equal(
      state.graph?.projections?.find((projection) => projection.id === 'default')?.nodeCardSizes['n-size'].width,
      220
    );
    assert.equal(
      state.graph?.projections?.find((projection) => projection.id === 'default')?.nodeCardSizes['n-size'].height,
      80
    );
    assert.equal(
      state.graph?.projections?.find((projection) => projection.id === 'alt')?.nodeCardSizes['n-size'].width,
      360
    );
    assert.equal(
      state.graph?.projections?.find((projection) => projection.id === 'alt')?.nodeCardSizes['n-size'].height,
      200
    );
  } finally {
    (axios as any).post = originalPost;
  }
});

test('addConnection rewires an occupied input instead of appending duplicate inbound edges', async () => {
  const originalPost = axios.post;
  let capturedPayload: any = null;

  const graph: Graph = {
    id: 'g-single-inbound',
    name: 'Single Inbound Graph',
    revision: 0,
    nodes: [
      {
        id: 'source-a',
        type: 'numeric_input' as any,
        position: { x: 0, y: 0 },
        metadata: {
          name: 'Source A',
          inputs: [],
          outputs: [{ name: 'value', schema: { type: 'number' } }],
        },
        config: {
          value: 1,
          min: 0,
          max: 10,
          step: 1,
        },
        version: 'source-a-v1',
      },
      {
        id: 'source-b',
        type: 'numeric_input' as any,
        position: { x: 0, y: 120 },
        metadata: {
          name: 'Source B',
          inputs: [],
          outputs: [{ name: 'value', schema: { type: 'number' } }],
        },
        config: {
          value: 2,
          min: 0,
          max: 10,
          step: 1,
        },
        version: 'source-b-v1',
      },
      {
        id: 'target',
        type: 'inline_code' as any,
        position: { x: 240, y: 40 },
        metadata: {
          name: 'Target',
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
        id: 'conn-a',
        sourceNodeId: 'source-a',
        sourcePort: 'value',
        targetNodeId: 'target',
        targetPort: 'input',
      },
    ],
    createdAt: 1,
    updatedAt: 1,
  };

  (axios as any).post = async (_url: string, body: unknown) => {
    capturedPayload = extractCommandUpdatePayload(body);
    return buildCommandResponse({
      ...graph,
      revision: 1,
      connections: [
        {
          id: 'conn-b',
          sourceNodeId: 'source-b',
          sourcePort: 'value',
          targetNodeId: 'target',
          targetPort: 'input',
        },
      ],
      updatedAt: 2,
    });
  };

  resetGraphStoreState({ graph });

  try {
    useGraphStore.getState().addConnection({
      id: 'conn-b',
      sourceNodeId: 'source-b',
      sourcePort: 'value',
      targetNodeId: 'target',
      targetPort: 'input',
    });
    await delay(0);

    const state = useGraphStore.getState();
    assert.ok(capturedPayload, 'expected graph update payload');
    assert.equal(capturedPayload.connections.length, 1);
    assert.deepEqual(capturedPayload.connections[0], {
      id: 'conn-b',
      sourceNodeId: 'source-b',
      sourcePort: 'value',
      targetNodeId: 'target',
      targetPort: 'input',
    });
    assert.equal(state.graph?.connections.length, 1);
    assert.equal(state.graph?.connections[0]?.sourceNodeId, 'source-b');
  } finally {
    (axios as any).post = originalPost;
  }
});

test('selectDrawing clears selected node and tracks drawing selection', () => {
  resetGraphStoreState({
    selectedNodeId: 'node-1',
    selectedNodeIds: ['node-1'],
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
  assert.deepEqual(state.selectedNodeIds, []);
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
  assert.deepEqual(state.selectedNodeIds, ['node-2']);
  assert.equal(state.selectedDrawingId, null);
  assert.equal(state.selectedNodeGraphicsDebug, null);
});

test('setNodeSelection and toggleNodeSelection track multi-select state', () => {
  resetGraphStoreState();

  useGraphStore.getState().setNodeSelection(['node-1', 'node-2']);
  let state = useGraphStore.getState();
  assert.equal(state.selectedNodeId, null);
  assert.deepEqual(state.selectedNodeIds, ['node-1', 'node-2']);
  assert.equal(state.selectedDrawingId, null);

  useGraphStore.getState().toggleNodeSelection('node-2');
  state = useGraphStore.getState();
  assert.equal(state.selectedNodeId, 'node-1');
  assert.deepEqual(state.selectedNodeIds, ['node-1']);

  useGraphStore.getState().toggleNodeSelection('node-3');
  state = useGraphStore.getState();
  assert.equal(state.selectedNodeId, null);
  assert.deepEqual(state.selectedNodeIds, ['node-1', 'node-3']);
});

test('drawing UI actions update local drawing state', () => {
  const before = useGraphStore.getState().drawingCreateRequestId;

  useGraphStore.getState().requestCreateDrawing();
  useGraphStore.getState().setDrawingEnabled(true);
  useGraphStore.getState().setDrawingColor('#123abc');
  useGraphStore.getState().setDrawingThickness(9);

  const state = useGraphStore.getState();
  assert.equal(state.drawingCreateRequestId, before + 1);
  assert.equal(state.drawingEnabled, true);
  assert.equal(state.drawingColor, '#123abc');
  assert.equal(state.drawingThickness, 9);
});

test('addDrawing persists drawing objects in graph payload', async () => {
  const originalPost = axios.post;
  let capturedPayload: any = null;

  const graph: Graph = {
    id: 'g-drawings',
    name: 'Drawing Graph',
    revision: 0,
    nodes: [],
    connections: [],
    drawings: [],
    createdAt: 1,
    updatedAt: 1,
  };

  (axios as any).post = async (_url: string, body: unknown) => {
    capturedPayload = extractCommandUpdatePayload(body);
    return buildCommandResponse({
      ...graph,
      revision: 1,
      drawings: capturedPayload.drawings as Graph['drawings'],
      updatedAt: 2,
    });
  };

  resetGraphStoreState({ graph } as any);

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
    (axios as any).post = originalPost;
  }
});

test('deleteDrawing clears selected drawing before persisting removal', async () => {
  const originalPost = axios.post;
  let capturedPayload: any = null;

  const graph: Graph = {
    id: 'g-drawings-delete',
    name: 'Drawing Graph Delete',
    revision: 0,
    nodes: [],
    connections: [],
    drawings: [
      {
        id: 'drawing-1',
        name: 'Sketch',
        position: { x: 10, y: 20 },
        paths: [],
      },
    ],
    createdAt: 1,
    updatedAt: 1,
  };

  (axios as any).post = async (_url: string, body: unknown) => {
    capturedPayload = extractCommandUpdatePayload(body);
    return buildCommandResponse({
      ...graph,
      revision: 1,
      drawings: [],
      updatedAt: 2,
    });
  };

  resetGraphStoreState({
    graph,
    selectedDrawingId: 'drawing-1',
  } as any);

  try {
    useGraphStore.getState().deleteDrawing('drawing-1');
    await delay(0);

    const state = useGraphStore.getState();
    assert.equal(state.selectedDrawingId, null);
    assert.ok(capturedPayload, 'expected graph update payload');
    assert.equal(capturedPayload.drawings.length, 0);
  } finally {
    (axios as any).post = originalPost;
  }
});

test('deleteNode reconciles multi-select state when a selected node is removed', async () => {
  const originalPost = axios.post;
  let capturedPayload: any = null;

  const graph: Graph = {
    id: 'g-delete-node-selection',
    name: 'Node Delete Selection',
    revision: 0,
    nodes: [
      {
        id: 'node-1',
        type: 'inline_code' as any,
        position: { x: 10, y: 20 },
        metadata: {
          name: 'Node 1',
          inputs: [],
          outputs: [],
        },
        config: {
          code: 'outputs.output = 1;',
          runtime: 'javascript_vm',
        },
        version: 'node-1-version',
      },
      {
        id: 'node-2',
        type: 'inline_code' as any,
        position: { x: 40, y: 60 },
        metadata: {
          name: 'Node 2',
          inputs: [],
          outputs: [],
        },
        config: {
          code: 'outputs.output = 2;',
          runtime: 'javascript_vm',
        },
        version: 'node-2-version',
      },
    ],
    connections: [],
    createdAt: 1,
    updatedAt: 1,
  };

  (axios as any).post = async (_url: string, body: unknown) => {
    capturedPayload = extractCommandUpdatePayload(body);
    return buildCommandResponse({
      ...graph,
      revision: 1,
      nodes: graph.nodes.filter((node) => node.id !== 'node-2'),
      updatedAt: 2,
    });
  };

  resetGraphStoreState({
    graph,
    selectedNodeId: null,
    selectedNodeIds: ['node-1', 'node-2'],
  } as any);

  try {
    useGraphStore.getState().deleteNode('node-2');
    await delay(0);

    const state = useGraphStore.getState();
    assert.ok(capturedPayload, 'expected graph update payload');
    assert.equal(state.selectedNodeId, 'node-1');
    assert.deepEqual(state.selectedNodeIds, ['node-1']);
  } finally {
    (axios as any).post = originalPost;
  }
});
