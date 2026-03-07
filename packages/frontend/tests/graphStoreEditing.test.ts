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

  resetGraphStoreState({ graph: initialGraph });

  try {
    useGraphStore.getState().updateNodePosition('n1', { x: 111, y: 222 });
    await delay(0);

    const state = useGraphStore.getState();
    const defaultProjection = capturedPayload.projections.find((projection: any) => projection.id === 'default');
    const altProjection = capturedPayload.projections.find((projection: any) => projection.id === 'alt');

    assert.ok(capturedPayload, 'expected updateGraph payload');
    assert.ok(defaultProjection);
    assert.ok(altProjection);
    assert.equal(defaultProjection.nodePositions.n1.x, 10);
    assert.equal(defaultProjection.nodePositions.n1.y, 20);
    assert.equal(altProjection.nodePositions.n1.x, 111);
    assert.equal(altProjection.nodePositions.n1.y, 222);
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

  resetGraphStoreState({ graph: initialGraph });

  try {
    useGraphStore.getState().updateNodeCardSize('n-size', 360, 200);
    await delay(0);

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

  resetGraphStoreState({ graph: initialGraph });

  try {
    useGraphStore.getState().updateNodeCardSize('n-size', 360, 200);
    await delay(0);

    const defaultProjection = capturedPayload.projections.find((projection: any) => projection.id === 'default');
    const altProjection = capturedPayload.projections.find((projection: any) => projection.id === 'alt');
    assert.ok(capturedPayload, 'expected updateGraph payload');
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

test('selectDrawing clears selected node and tracks drawing selection', () => {
  resetGraphStoreState({
    selectedNodeId: 'node-1',
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
    (axios as any).put = originalPut;
  }
});

test('deleteDrawing clears selected drawing before persisting removal', async () => {
  const originalPut = axios.put;
  let capturedPayload: any = null;

  const graph: Graph = {
    id: 'g-drawings-delete',
    name: 'Drawing Graph Delete',
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

  (axios as any).put = async (_url: string, body: unknown) => {
    capturedPayload = body;
    return { data: body };
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
    (axios as any).put = originalPut;
  }
});
