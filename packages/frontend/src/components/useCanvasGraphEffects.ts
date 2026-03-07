import { useEffect, type MutableRefObject } from 'react';
import { Point } from 'pixi.js';
import { v4 as uuidv4 } from 'uuid';
import type {
  Graph,
  GraphDrawing,
} from '../types';
import { snapToPixel } from '../utils/canvasHelpers';
import type { ProjectionTransitionState } from './useCanvasViewport';

interface UseCanvasGraphEffectsParams {
  graph: Graph | null;
  selectedNodeId: string | null;
  selectedDrawingId: string | null;
  drawingCreateRequestId: number;
  drawingEnabled: boolean;
  canvasReady: boolean;
  renderGraph: () => void;
  renderGraphRef: MutableRefObject<() => void>;
  graphRef: MutableRefObject<Graph | null>;
  lastGraphIdRef: MutableRefObject<string | null>;
  viewportInitializedRef: MutableRefObject<boolean>;
  projectionTransitionRef: MutableRefObject<ProjectionTransitionState | null>;
  selectedConnectionIdRef: MutableRefObject<string | null>;
  selectedDrawingIdRef: MutableRefObject<string | null>;
  handledDrawingCreateRequestRef: MutableRefObject<number>;
  appRef: MutableRefObject<{ screen: { width: number; height: number } } | null>;
  viewportRef: MutableRefObject<{ toLocal: (point: Point) => Point } | null>;
  panStateRef: MutableRefObject<object | null>;
  nodeDragStateRef: MutableRefObject<object | null>;
  nodeResizeStateRef: MutableRefObject<object | null>;
  hoveredNodeResizeHandleRef: MutableRefObject<object | null>;
  nodeCardDraftSizesRef: MutableRefObject<Map<string, { width: number; height: number }>>;
  nodeCardDraftPositionsRef: MutableRefObject<Map<string, { x: number; y: number }>>;
  numericSliderDragStateRef: MutableRefObject<object | null>;
  hoveredNumericSliderNodeIdRef: MutableRefObject<string | null>;
  drawingDragStateRef: MutableRefObject<object | null>;
  connectionDragStateRef: MutableRefObject<object | null>;
  addDrawing: (drawing: GraphDrawing) => void;
  selectDrawing: (drawingId: string | null) => void;
  startProjectionTransition: (previousGraph: Graph | null, nextGraph: Graph | null) => void;
  getNextDrawingName: (drawings: GraphDrawing[]) => string;
  endConnectionDrag: (commit: boolean) => void;
  drawFreehandStrokes: () => void;
  applyCanvasCursor: () => void;
}

export function useCanvasGraphEffects(params: UseCanvasGraphEffectsParams): void {
  const {
    graph,
    selectedNodeId,
    selectedDrawingId,
    drawingCreateRequestId,
    drawingEnabled,
    canvasReady,
    renderGraph,
    renderGraphRef,
    graphRef,
    lastGraphIdRef,
    viewportInitializedRef,
    projectionTransitionRef,
    selectedConnectionIdRef,
    selectedDrawingIdRef,
    handledDrawingCreateRequestRef,
    appRef,
    viewportRef,
    panStateRef,
    nodeDragStateRef,
    nodeResizeStateRef,
    hoveredNodeResizeHandleRef,
    nodeCardDraftSizesRef,
    nodeCardDraftPositionsRef,
    numericSliderDragStateRef,
    hoveredNumericSliderNodeIdRef,
    drawingDragStateRef,
    connectionDragStateRef,
    addDrawing,
    selectDrawing,
    startProjectionTransition,
    getNextDrawingName,
    endConnectionDrag,
    drawFreehandStrokes,
    applyCanvasCursor,
  } = params;

  useEffect(() => {
    renderGraphRef.current = renderGraph;
  }, [renderGraph, renderGraphRef]);

  useEffect(() => {
    const previousGraph = graphRef.current;
    const shouldAnimateProjectionSwitch = Boolean(
      previousGraph &&
      graph &&
      previousGraph.id === graph.id &&
      previousGraph.activeProjectionId &&
      graph.activeProjectionId &&
      previousGraph.activeProjectionId !== graph.activeProjectionId
    );
    if (shouldAnimateProjectionSwitch) {
      startProjectionTransition(previousGraph, graph);
    }

    graphRef.current = graph;

    const nextGraphId = graph?.id ?? null;
    if (lastGraphIdRef.current !== nextGraphId) {
      lastGraphIdRef.current = nextGraphId;
      viewportInitializedRef.current = false;
      projectionTransitionRef.current = null;
    }

    if (
      selectedConnectionIdRef.current &&
      !graph?.connections.some((connection) => connection.id === selectedConnectionIdRef.current)
    ) {
      selectedConnectionIdRef.current = null;
    }

    if (
      selectedDrawingIdRef.current &&
      !graph?.drawings?.some((drawing) => drawing.id === selectedDrawingIdRef.current)
    ) {
      selectedDrawingIdRef.current = null;
      selectDrawing(null);
    }

    renderGraphRef.current();
  }, [
    graph,
    graphRef,
    lastGraphIdRef,
    projectionTransitionRef,
    renderGraphRef,
    selectDrawing,
    selectedConnectionIdRef,
    selectedDrawingIdRef,
    startProjectionTransition,
    viewportInitializedRef,
  ]);

  useEffect(() => {
    if (drawingCreateRequestId <= handledDrawingCreateRequestRef.current) {
      return;
    }

    if (!canvasReady) {
      return;
    }

    const app = appRef.current;
    const viewport = viewportRef.current;
    const currentGraph = graphRef.current;
    if (!app || !viewport || !currentGraph) {
      return;
    }

    const worldPoint = viewport.toLocal(new Point(app.screen.width / 2, app.screen.height / 2));
    const drawing: GraphDrawing = {
      id: uuidv4(),
      name: getNextDrawingName(currentGraph.drawings ?? []),
      position: {
        x: snapToPixel(worldPoint.x),
        y: snapToPixel(worldPoint.y),
      },
      paths: [],
    };

    handledDrawingCreateRequestRef.current = drawingCreateRequestId;
    addDrawing(drawing);
    selectDrawing(drawing.id);
  }, [
    addDrawing,
    appRef,
    canvasReady,
    drawingCreateRequestId,
    getNextDrawingName,
    graphRef,
    handledDrawingCreateRequestRef,
    selectDrawing,
    viewportRef,
  ]);

  useEffect(() => {
    renderGraphRef.current();
  }, [renderGraphRef, selectedDrawingId, selectedNodeId]);

  useEffect(() => {
    if (!appRef.current) {
      return;
    }

    if (drawingEnabled) {
      panStateRef.current = null;
      nodeDragStateRef.current = null;
      nodeResizeStateRef.current = null;
      hoveredNodeResizeHandleRef.current = null;
      nodeCardDraftSizesRef.current.clear();
      nodeCardDraftPositionsRef.current.clear();
      numericSliderDragStateRef.current = null;
      hoveredNumericSliderNodeIdRef.current = null;
      drawingDragStateRef.current = null;
      if (connectionDragStateRef.current) {
        endConnectionDrag(false);
      }
    }

    drawFreehandStrokes();
    renderGraphRef.current();
    applyCanvasCursor();
  }, [
    appRef,
    applyCanvasCursor,
    connectionDragStateRef,
    drawFreehandStrokes,
    drawingDragStateRef,
    drawingEnabled,
    endConnectionDrag,
    hoveredNodeResizeHandleRef,
    hoveredNumericSliderNodeIdRef,
    nodeCardDraftPositionsRef,
    nodeCardDraftSizesRef,
    nodeDragStateRef,
    nodeResizeStateRef,
    numericSliderDragStateRef,
    panStateRef,
    renderGraphRef,
  ]);
}
