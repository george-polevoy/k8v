import { useCallback, type MutableRefObject } from 'react';
import {
  Application,
  Container,
  FederatedPointerEvent,
  Point,
  Rectangle,
} from 'pixi.js';
import { v4 as uuidv4 } from 'uuid';
import type {
  DrawingPath,
  Graph,
  GraphNode,
  Position,
} from '../types';
import {
  DEFAULT_GRAPH_PROJECTION_ID,
  withNodeCardSizeInProjection,
  withNodePositionInProjection,
} from '../utils/projections';
import {
  computeNodeResizeDraft,
  computeSnappedDragPosition,
  computeSnappedPanPosition,
  hasExceededDragThreshold,
  isCanvasDeletionShortcutBlocked,
  resolveWheelInteractionPlan,
} from '../utils/canvasInteractions';
import {
  resolveModifierWheelScrollDelta,
  resolveWheelZoomSensitivityMultiplier,
  shouldWheelPanCanvas,
} from '../utils/wheelNavigation';

interface PanStateLike {
  pointerX: number;
  pointerY: number;
  viewportX: number;
  viewportY: number;
}

type ResizeHandleDirection = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

interface NodeDragStateLike {
  nodeId: string;
  pointerX: number;
  pointerY: number;
  nodeX: number;
  nodeY: number;
  currentX: number;
  currentY: number;
  moved: boolean;
}

interface NodeResizeStateLike {
  nodeId: string;
  pointerX: number;
  pointerY: number;
  x: number;
  y: number;
  width: number;
  height: number;
  handle: ResizeHandleDirection;
  minWidth: number;
  minHeight: number;
  currentX: number;
  currentY: number;
  currentWidth: number;
  currentHeight: number;
}

interface ConnectionDragStateLike {
  sourceNodeId: string;
  sourcePort: string;
  sourcePortKey: string;
  startX: number;
  startY: number;
  pointerX: number;
  pointerY: number;
  hoveredInputKey: string | null;
}

interface ActiveDrawingPathLike {
  drawingId: string;
  path: DrawingPath;
}

interface DrawingDragStateLike {
  drawingId: string;
  pointerX: number;
  pointerY: number;
  drawingX: number;
  drawingY: number;
  currentX: number;
  currentY: number;
  moved: boolean;
}

interface NumericSliderDragStateLike {
  nodeId: string;
  initialValue: number;
  currentValue: number;
}

interface NodeVisualLike {
  node: GraphNode;
  container: Container;
  width: number;
  height: number;
  projectedGraphicsHeight: number;
  inputPortOffsets: Map<string, number>;
  outputPortOffsets: Map<string, number>;
}

interface DrawingVisualLike {
  container: Container;
}

interface UseCanvasInteractionsConfig {
  portRadius: number;
  nodeDragStartThreshold: number;
  drawSmoothingStep: number;
  zoomSensitivity: number;
  minZoom: number;
  maxZoom: number;
}

interface UseCanvasInteractionsParams {
  appRef: MutableRefObject<Application | null>;
  viewportRef: MutableRefObject<Container | null>;
  graphRef: MutableRefObject<Graph | null>;
  drawingEnabledRef: MutableRefObject<boolean>;
  drawingColorRef: MutableRefObject<string>;
  drawingThicknessRef: MutableRefObject<number>;
  activeDrawingPathRef: MutableRefObject<ActiveDrawingPathLike | null>;
  drawingPositionsRef: MutableRefObject<Map<string, Position>>;
  drawingVisualsRef: MutableRefObject<Map<string, DrawingVisualLike>>;
  drawingDragStateRef: MutableRefObject<DrawingDragStateLike | null>;
  nodeDragStateRef: MutableRefObject<NodeDragStateLike | null>;
  nodeResizeStateRef: MutableRefObject<NodeResizeStateLike | null>;
  nodeVisualsRef: MutableRefObject<Map<string, NodeVisualLike>>;
  nodePositionsRef: MutableRefObject<Map<string, Position>>;
  nodeCardDraftSizesRef: MutableRefObject<Map<string, { width: number; height: number }>>;
  nodeCardDraftPositionsRef: MutableRefObject<Map<string, Position>>;
  numericSliderDragStateRef: MutableRefObject<NumericSliderDragStateLike | null>;
  connectionDragStateRef: MutableRefObject<ConnectionDragStateLike | null>;
  panStateRef: MutableRefObject<PanStateLike | null>;
  inputPortPositionsRef: MutableRefObject<Map<string, Position>>;
  hoveredInputPortKeyRef: MutableRefObject<string | null>;
  hoveredOutputPortKeyRef: MutableRefObject<string | null>;
  selectedConnectionIdRef: MutableRefObject<string | null>;
  selectedDrawingIdRef: MutableRefObject<string | null>;
  selectedNodeIdRef: MutableRefObject<string | null>;
  requestCanvasAnimationLoop: () => void;
  requestViewportInteractionRefresh: (options?: { scaleSensitive?: boolean }) => void;
  requestViewportDrivenGraphRefresh: () => void;
  drawConnections: () => void;
  drawFreehandStrokes: () => void;
  drawMinimap: () => void;
  drawEffects: () => void;
  updateNumericSliderFromPointer: (nodeId: string, pointerX: number, pointerY: number) => void;
  refreshCanvasBackgroundTexture: () => void;
  syncNodePortPositions: (nodeId: string, position: Position, visual: NodeVisualLike) => void;
  pickConnectionAtClientPoint: (clientX: number, clientY: number) => string | null;
  endConnectionDrag: (commit: boolean) => void;
  commitNumericSliderValue: (nodeId: string, nextValue: number) => void;
  addDrawingPath: (drawingId: string, path: DrawingPath) => void;
  updateNodePosition: (nodeId: string, position: Position) => void;
  updateDrawingPosition: (drawingId: string, position: Position) => void;
  updateGraph: (graph: Graph) => void | Promise<void>;
  deleteConnection: (connectionId: string) => void;
  deleteDrawing: (drawingId: string) => void;
  deleteNode: (nodeId: string) => void;
  selectNode: (nodeId: string | null) => void;
  selectDrawing: (drawingId: string | null) => void;
  setInputPortHighlight: (portKey: string, highlighted: boolean) => void;
  applyCanvasCursor: () => void;
  renderGraphRef: MutableRefObject<() => void>;
  config: UseCanvasInteractionsConfig;
}

export function useCanvasInteractions(params: UseCanvasInteractionsParams) {
  const {
    appRef,
    viewportRef,
    graphRef,
    drawingEnabledRef,
    drawingColorRef,
    drawingThicknessRef,
    activeDrawingPathRef,
    drawingPositionsRef,
    drawingVisualsRef,
    drawingDragStateRef,
    nodeDragStateRef,
    nodeResizeStateRef,
    nodeVisualsRef,
    nodePositionsRef,
    nodeCardDraftSizesRef,
    nodeCardDraftPositionsRef,
    numericSliderDragStateRef,
    connectionDragStateRef,
    panStateRef,
    inputPortPositionsRef,
    hoveredInputPortKeyRef,
    hoveredOutputPortKeyRef,
    selectedConnectionIdRef,
    selectedDrawingIdRef,
    selectedNodeIdRef,
    requestCanvasAnimationLoop,
    requestViewportInteractionRefresh,
    requestViewportDrivenGraphRefresh,
    drawConnections,
    drawFreehandStrokes,
    drawMinimap,
    drawEffects,
    updateNumericSliderFromPointer,
    refreshCanvasBackgroundTexture,
    syncNodePortPositions,
    pickConnectionAtClientPoint,
    endConnectionDrag,
    commitNumericSliderValue,
    addDrawingPath,
    updateNodePosition,
    updateDrawingPosition,
    updateGraph,
    deleteConnection,
    deleteDrawing,
    deleteNode,
    selectNode,
    selectDrawing,
    setInputPortHighlight,
    applyCanvasCursor,
    renderGraphRef,
    config,
  } = params;

  const finishInteraction = useCallback(() => {
    if (connectionDragStateRef.current) {
      endConnectionDrag(true);
    }

    const numericSliderDragState = numericSliderDragStateRef.current;
    if (numericSliderDragState) {
      if (Math.abs(numericSliderDragState.currentValue - numericSliderDragState.initialValue) > 1e-9) {
        commitNumericSliderValue(numericSliderDragState.nodeId, numericSliderDragState.currentValue);
      }
      numericSliderDragStateRef.current = null;
    }

    const activeDrawingPath = activeDrawingPathRef.current;
    if (activeDrawingPath) {
      const normalizedPoints = activeDrawingPath.path.points.filter((point, index, points) =>
        index === 0 || Math.hypot(point.x - points[index - 1].x, point.y - points[index - 1].y) >= 0.2
      );
      if (normalizedPoints.length > 0) {
        addDrawingPath(activeDrawingPath.drawingId, {
          ...activeDrawingPath.path,
          points: normalizedPoints,
        });
      }
      activeDrawingPathRef.current = null;
      drawFreehandStrokes();
    }

    const dragState = nodeDragStateRef.current;
    if (dragState) {
      if (dragState.moved) {
        updateNodePosition(dragState.nodeId, {
          x: dragState.currentX,
          y: dragState.currentY,
        });
      }
      nodeDragStateRef.current = null;
    }

    const resizeState = nodeResizeStateRef.current;
    if (resizeState) {
      const positionChanged =
        Math.abs(resizeState.currentX - resizeState.x) > 0.5 ||
        Math.abs(resizeState.currentY - resizeState.y) > 0.5;
      const sizeChanged =
        Math.abs(resizeState.currentWidth - resizeState.width) > 0.5 ||
        Math.abs(resizeState.currentHeight - resizeState.height) > 0.5;
      const currentGraph = graphRef.current;
      if ((positionChanged || sizeChanged) && currentGraph) {
        const activeProjectionId = currentGraph.activeProjectionId ?? DEFAULT_GRAPH_PROJECTION_ID;
        const nextPosition = {
          x: resizeState.currentX,
          y: resizeState.currentY,
        };
        const nextCardSize = {
          width: resizeState.currentWidth,
          height: resizeState.currentHeight,
        };
        const nextNodes = currentGraph.nodes.map((node) => {
          if (node.id !== resizeState.nodeId) {
            return node;
          }
          return {
            ...node,
            position: nextPosition,
            config: {
              ...node.config,
              config: {
                ...(node.config.config ?? {}),
                cardWidth: nextCardSize.width,
                cardHeight: nextCardSize.height,
              },
            },
          };
        });
        const nextProjections = (currentGraph.projections ?? []).map((projection) =>
          projection.id === activeProjectionId
            ? withNodeCardSizeInProjection(
              withNodePositionInProjection(projection, resizeState.nodeId, nextPosition),
              resizeState.nodeId,
              nextCardSize
            )
            : projection
        );

        void updateGraph({
          ...currentGraph,
          nodes: nextNodes,
          projections: nextProjections,
          updatedAt: Date.now(),
        });
      }
      nodeCardDraftSizesRef.current.delete(resizeState.nodeId);
      nodeCardDraftPositionsRef.current.delete(resizeState.nodeId);
      nodeResizeStateRef.current = null;
    }

    const drawingDragState = drawingDragStateRef.current;
    if (drawingDragState) {
      if (drawingDragState.moved) {
        updateDrawingPosition(drawingDragState.drawingId, {
          x: drawingDragState.currentX,
          y: drawingDragState.currentY,
        });
      }
      drawingDragStateRef.current = null;
    }

    panStateRef.current = null;
    hoveredInputPortKeyRef.current = null;
    hoveredOutputPortKeyRef.current = null;
    applyCanvasCursor();
  }, [
    activeDrawingPathRef,
    addDrawingPath,
    applyCanvasCursor,
    commitNumericSliderValue,
    connectionDragStateRef,
    drawFreehandStrokes,
    drawingDragStateRef,
    endConnectionDrag,
    graphRef,
    hoveredInputPortKeyRef,
    hoveredOutputPortKeyRef,
    nodeCardDraftPositionsRef,
    nodeCardDraftSizesRef,
    nodeDragStateRef,
    nodeResizeStateRef,
    numericSliderDragStateRef,
    panStateRef,
    updateDrawingPosition,
    updateGraph,
    updateNodePosition,
  ]);

  const handleStagePointerDown = useCallback((event: FederatedPointerEvent) => {
    const app = appRef.current;
    const viewport = viewportRef.current;
    if (!app || !viewport) {
      return;
    }

    if (event.button !== 0) {
      return;
    }
    (app.view as HTMLCanvasElement).focus({ preventScroll: true });

    if (drawingEnabledRef.current) {
      const drawingId = selectedDrawingIdRef.current;
      if (!drawingId) {
        return;
      }
      const worldPoint = viewport.toLocal(new Point(event.global.x, event.global.y));
      const drawingPosition =
        drawingPositionsRef.current.get(drawingId) ??
        graphRef.current?.drawings?.find((drawing) => drawing.id === drawingId)?.position;

      if (!drawingPosition) {
        return;
      }

      activeDrawingPathRef.current = {
        drawingId,
        path: {
          id: uuidv4(),
          color: drawingColorRef.current,
          thickness: drawingThicknessRef.current,
          points: [
            {
              x: worldPoint.x - drawingPosition.x,
              y: worldPoint.y - drawingPosition.y,
            },
          ],
        },
      };
      drawFreehandStrokes();
      return;
    }

    if (event.target !== app.stage) {
      return;
    }

    const pickedConnectionId = pickConnectionAtClientPoint(event.clientX, event.clientY);
    if (pickedConnectionId) {
      selectedConnectionIdRef.current = pickedConnectionId;
      selectedNodeIdRef.current = null;
      selectNode(null);
      drawConnections();
      return;
    }

    panStateRef.current = {
      pointerX: event.global.x,
      pointerY: event.global.y,
      viewportX: viewport.position.x,
      viewportY: viewport.position.y,
    };
    applyCanvasCursor();
    if (selectedConnectionIdRef.current) {
      selectedConnectionIdRef.current = null;
      drawConnections();
    }
    if (selectedDrawingIdRef.current) {
      selectedDrawingIdRef.current = null;
      selectDrawing(null);
    }
    selectedNodeIdRef.current = null;
    selectNode(null);
  }, [
    activeDrawingPathRef,
    appRef,
    applyCanvasCursor,
    drawConnections,
    drawFreehandStrokes,
    drawingColorRef,
    drawingEnabledRef,
    drawingPositionsRef,
    drawingThicknessRef,
    graphRef,
    panStateRef,
    pickConnectionAtClientPoint,
    selectDrawing,
    selectedConnectionIdRef,
    selectedDrawingIdRef,
    selectedNodeIdRef,
    selectNode,
    viewportRef,
  ]);

  const handleStagePointerMove = useCallback((event: FederatedPointerEvent) => {
    const viewport = viewportRef.current;

    const numericSliderDragState = numericSliderDragStateRef.current;
    if (numericSliderDragState) {
      applyCanvasCursor();
      requestCanvasAnimationLoop();
      updateNumericSliderFromPointer(numericSliderDragState.nodeId, event.global.x, event.global.y);
      return;
    }

    const nodeResizeState = nodeResizeStateRef.current;
    if (nodeResizeState) {
      if (!viewport) {
        return;
      }
      const resizeDraft = computeNodeResizeDraft({
        x: nodeResizeState.x,
        y: nodeResizeState.y,
        width: nodeResizeState.width,
        height: nodeResizeState.height,
        minWidth: nodeResizeState.minWidth,
        minHeight: nodeResizeState.minHeight,
        handle: nodeResizeState.handle,
        pointerX: event.global.x,
        pointerY: event.global.y,
        startPointerX: nodeResizeState.pointerX,
        startPointerY: nodeResizeState.pointerY,
        scale: viewport.scale.x || 1,
      });

      if (
        resizeDraft.x !== nodeResizeState.currentX ||
        resizeDraft.y !== nodeResizeState.currentY ||
        resizeDraft.width !== nodeResizeState.currentWidth ||
        resizeDraft.height !== nodeResizeState.currentHeight
      ) {
        nodeResizeState.currentX = resizeDraft.x;
        nodeResizeState.currentY = resizeDraft.y;
        nodeResizeState.currentWidth = resizeDraft.width;
        nodeResizeState.currentHeight = resizeDraft.height;
        nodeCardDraftSizesRef.current.set(nodeResizeState.nodeId, {
          width: resizeDraft.width,
          height: resizeDraft.height,
        });
        nodeCardDraftPositionsRef.current.set(nodeResizeState.nodeId, {
          x: resizeDraft.x,
          y: resizeDraft.y,
        });
        renderGraphRef.current();
      }
      applyCanvasCursor();
      return;
    }

    const connectionDrag = connectionDragStateRef.current;
    if (connectionDrag) {
      connectionDrag.pointerX = event.global.x;
      connectionDrag.pointerY = event.global.y;

      if (viewport) {
        const worldPoint = viewport.toLocal(new Point(event.global.x, event.global.y));
        const hoverRadius = (config.portRadius + 8) / Math.max(viewport.scale.x, 0.1);
        let nextHoveredKey: string | null = null;

        for (const [portKey, portPosition] of inputPortPositionsRef.current.entries()) {
          const dx = worldPoint.x - portPosition.x;
          const dy = worldPoint.y - portPosition.y;
          if ((dx * dx) + (dy * dy) <= hoverRadius * hoverRadius) {
            nextHoveredKey = portKey;
            break;
          }
        }

        if (connectionDrag.hoveredInputKey !== nextHoveredKey) {
          if (connectionDrag.hoveredInputKey) {
            setInputPortHighlight(connectionDrag.hoveredInputKey, false);
          }
          if (nextHoveredKey) {
            setInputPortHighlight(nextHoveredKey, true);
          }
          connectionDrag.hoveredInputKey = nextHoveredKey;
        }
      }

      drawConnections();
      return;
    }

    const activeDrawingPath = activeDrawingPathRef.current;
    if (activeDrawingPath) {
      if (!viewport) {
        return;
      }
      const worldPoint = viewport.toLocal(new Point(event.global.x, event.global.y));
      const drawingPosition =
        drawingPositionsRef.current.get(activeDrawingPath.drawingId) ??
        graphRef.current?.drawings?.find((drawing) => drawing.id === activeDrawingPath.drawingId)?.position;
      if (!drawingPosition) {
        activeDrawingPathRef.current = null;
        return;
      }

      const localPoint = {
        x: worldPoint.x - drawingPosition.x,
        y: worldPoint.y - drawingPosition.y,
      };
      const previousPoint = activeDrawingPath.path.points[activeDrawingPath.path.points.length - 1];
      if (
        !previousPoint ||
        Math.hypot(localPoint.x - previousPoint.x, localPoint.y - previousPoint.y) >= config.drawSmoothingStep
      ) {
        activeDrawingPath.path.points.push(localPoint);
        drawFreehandStrokes();
      }
      return;
    }

    const activeDrawingDragState = drawingDragStateRef.current;
    if (activeDrawingDragState) {
      const deltaX = event.global.x - activeDrawingDragState.pointerX;
      const deltaY = event.global.y - activeDrawingDragState.pointerY;
      if (
        !activeDrawingDragState.moved &&
        !hasExceededDragThreshold(deltaX, deltaY, config.nodeDragStartThreshold)
      ) {
        return;
      }

      if (!viewport) {
        return;
      }
      const drawingVisual = drawingVisualsRef.current.get(activeDrawingDragState.drawingId);
      if (!drawingVisual) {
        return;
      }

      const nextPosition = computeSnappedDragPosition({
        originX: activeDrawingDragState.drawingX,
        originY: activeDrawingDragState.drawingY,
        pointerX: event.global.x,
        pointerY: event.global.y,
        startPointerX: activeDrawingDragState.pointerX,
        startPointerY: activeDrawingDragState.pointerY,
        scale: viewport.scale.x || 1,
      });
      activeDrawingDragState.currentX = nextPosition.x;
      activeDrawingDragState.currentY = nextPosition.y;
      drawingPositionsRef.current.set(activeDrawingDragState.drawingId, nextPosition);
      drawingVisual.container.position.set(nextPosition.x, nextPosition.y);
      activeDrawingDragState.moved = true;
      drawFreehandStrokes();
      drawMinimap();
      return;
    }

    const dragState = nodeDragStateRef.current;
    if (dragState) {
      if (!viewport) {
        return;
      }
      const nodeVisual = nodeVisualsRef.current.get(dragState.nodeId);
      if (!nodeVisual) {
        return;
      }

      const deltaX = event.global.x - dragState.pointerX;
      const deltaY = event.global.y - dragState.pointerY;
      if (
        !dragState.moved &&
        !hasExceededDragThreshold(deltaX, deltaY, config.nodeDragStartThreshold)
      ) {
        return;
      }

      const nextPosition = computeSnappedDragPosition({
        originX: dragState.nodeX,
        originY: dragState.nodeY,
        pointerX: event.global.x,
        pointerY: event.global.y,
        startPointerX: dragState.pointerX,
        startPointerY: dragState.pointerY,
        scale: viewport.scale.x || 1,
      });
      dragState.currentX = nextPosition.x;
      dragState.currentY = nextPosition.y;
      nodePositionsRef.current.set(dragState.nodeId, nextPosition);
      nodeVisual.container.position.set(nextPosition.x, nextPosition.y);
      syncNodePortPositions(dragState.nodeId, nextPosition, nodeVisual);
      dragState.moved = true;
      drawConnections();
      drawMinimap();
      return;
    }

    const panState = panStateRef.current;
    if (!panState || !viewport) {
      return;
    }

    requestCanvasAnimationLoop();
    const nextPanPosition = computeSnappedPanPosition({
      viewportX: panState.viewportX,
      viewportY: panState.viewportY,
      pointerX: event.global.x,
      pointerY: event.global.y,
      startPointerX: panState.pointerX,
      startPointerY: panState.pointerY,
    });
    viewport.position.set(nextPanPosition.x, nextPanPosition.y);
    drawMinimap();
    requestViewportInteractionRefresh();
  }, [
    activeDrawingPathRef,
    applyCanvasCursor,
    config.drawSmoothingStep,
    config.nodeDragStartThreshold,
    config.portRadius,
    connectionDragStateRef,
    drawConnections,
    drawFreehandStrokes,
    drawMinimap,
    drawingDragStateRef,
    drawingPositionsRef,
    drawingVisualsRef,
    graphRef,
    inputPortPositionsRef,
    nodeCardDraftPositionsRef,
    nodeCardDraftSizesRef,
    nodeDragStateRef,
    nodePositionsRef,
    nodeResizeStateRef,
    nodeVisualsRef,
    numericSliderDragStateRef,
    panStateRef,
    renderGraphRef,
    requestCanvasAnimationLoop,
    requestViewportInteractionRefresh,
    setInputPortHighlight,
    syncNodePortPositions,
    updateNumericSliderFromPointer,
    viewportRef,
  ]);

  const handleStagePointerUp = useCallback((event: FederatedPointerEvent) => {
    if (event.button !== 0) {
      return;
    }
    finishInteraction();
  }, [finishInteraction]);

  const handleWheel = useCallback((event: WheelEvent) => {
    const viewport = viewportRef.current;
    const app = appRef.current;
    if (!viewport || !app) {
      return;
    }

    event.preventDefault();

    const modifierScrollDelta = resolveModifierWheelScrollDelta(event);
    const shouldPan = shouldWheelPanCanvas(event);
    let pointerX = 0;
    let pointerY = 0;
    let worldBeforeX = 0;
    let worldBeforeY = 0;
    if (!modifierScrollDelta && !shouldPan) {
      const rect = (app.view as HTMLCanvasElement).getBoundingClientRect();
      const pointer = new Point(event.clientX - rect.left, event.clientY - rect.top);
      const worldPointBefore = viewport.toLocal(pointer);
      pointerX = pointer.x;
      pointerY = pointer.y;
      worldBeforeX = worldPointBefore.x;
      worldBeforeY = worldPointBefore.y;
    }

    const wheelPlan = resolveWheelInteractionPlan({
      currentX: viewport.position.x,
      currentY: viewport.position.y,
      currentScale: viewport.scale.x,
      deltaX: event.deltaX,
      deltaY: event.deltaY,
      modifierScrollDelta,
      shouldPan,
      pointerX,
      pointerY,
      worldBeforeX,
      worldBeforeY,
      zoomSensitivity: config.zoomSensitivity * resolveWheelZoomSensitivityMultiplier(event),
      minZoom: config.minZoom,
      maxZoom: config.maxZoom,
    });

    if (wheelPlan.kind === 'zoom') {
      viewport.scale.set(wheelPlan.scale);
    }

    viewport.position.set(wheelPlan.x, wheelPlan.y);
    requestViewportInteractionRefresh({
      scaleSensitive: wheelPlan.kind === 'zoom',
    });
  }, [
    appRef,
    config.maxZoom,
    config.minZoom,
    config.zoomSensitivity,
    requestViewportInteractionRefresh,
    viewportRef,
  ]);

  const handleResize = useCallback(() => {
    const app = appRef.current;
    if (!app) {
      return;
    }

    app.stage.hitArea = new Rectangle(0, 0, app.screen.width, app.screen.height);
    refreshCanvasBackgroundTexture();
    drawMinimap();
    drawEffects();
    drawFreehandStrokes();
    requestViewportDrivenGraphRefresh();
  }, [
    appRef,
    drawEffects,
    drawFreehandStrokes,
    drawMinimap,
    refreshCanvasBackgroundTexture,
    requestViewportDrivenGraphRefresh,
  ]);

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (event.key !== 'Delete' && event.key !== 'Backspace') {
      return;
    }

    const canvasElement = appRef.current?.view as HTMLCanvasElement | undefined;
    const activeElement = document.activeElement as HTMLElement | null;
    if (!canvasElement || isCanvasDeletionShortcutBlocked(activeElement, canvasElement)) {
      return;
    }

    const selectedConnectionId = selectedConnectionIdRef.current;
    if (selectedConnectionId) {
      event.preventDefault();
      deleteConnection(selectedConnectionId);
      selectedConnectionIdRef.current = null;
      drawConnections();
      return;
    }

    const drawingId = selectedDrawingIdRef.current;
    if (drawingId) {
      event.preventDefault();
      deleteDrawing(drawingId);
      selectedDrawingIdRef.current = null;
      drawFreehandStrokes();
      drawMinimap();
      return;
    }

    const selectedNode = selectedNodeIdRef.current;
    if (!selectedNode) {
      return;
    }

    event.preventDefault();
    deleteNode(selectedNode);
    selectedConnectionIdRef.current = null;
    selectedNodeIdRef.current = null;
    selectNode(null);
    drawConnections();
  }, [
    appRef,
    deleteConnection,
    deleteDrawing,
    deleteNode,
    drawConnections,
    drawFreehandStrokes,
    drawMinimap,
    selectNode,
    selectedConnectionIdRef,
    selectedDrawingIdRef,
    selectedNodeIdRef,
  ]);

  return {
    finishInteraction,
    handleStagePointerDown,
    handleStagePointerMove,
    handleStagePointerUp,
    handleWheel,
    handleResize,
    handleKeyDown,
  };
}
