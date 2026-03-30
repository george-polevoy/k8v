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
  GraphCommand,
  Position,
} from '../types';
import { resolveCardEdgeDropTarget } from '../utils/annotationConnections';
import {
  computeRectFromPoints,
  computeNodeResizeDraft,
  computeSelectionResizeDraft,
  computeSnappedDragPosition,
  computeSnappedPanPosition,
  hasExceededDragThreshold,
  isCanvasDeletionShortcutBlocked,
  rectIntersectsRect,
  resolveWheelInteractionPlan,
} from '../utils/canvasInteractions';
import { duplicateNodeSelectionInGraph } from '../utils/selectionDuplication';
import {
  resolveModifierWheelScrollDelta,
  resolveWheelZoomSensitivityMultiplier,
  shouldWheelPanCanvas,
} from '../utils/wheelNavigation';
import type {
  ActiveDrawingPath,
  ConnectionDragState,
  DrawingDragState,
  DrawingVisual,
  HoveredSelectionResizeHandle,
  NodeDragState,
  NodeResizeState,
  NodeVisual,
  NumericSliderDragState,
  PanState,
  SelectionDragState,
  SelectionMarqueeState,
  SelectionResizeNodeState,
  SelectionResizeState,
} from './canvasTypes';

interface UseCanvasInteractionsConfig {
  portRadius: number;
  annotationEdgeHitWidth: number;
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
  activeDrawingPathRef: MutableRefObject<ActiveDrawingPath | null>;
  drawingPositionsRef: MutableRefObject<Map<string, Position>>;
  drawingVisualsRef: MutableRefObject<Map<string, DrawingVisual>>;
  drawingDragStateRef: MutableRefObject<DrawingDragState | null>;
  nodeDragStateRef: MutableRefObject<NodeDragState | null>;
  nodeResizeStateRef: MutableRefObject<NodeResizeState | null>;
  selectionDragStateRef: MutableRefObject<SelectionDragState | null>;
  selectionResizeStateRef: MutableRefObject<SelectionResizeState | null>;
  selectionMarqueeStateRef: MutableRefObject<SelectionMarqueeState | null>;
  hoveredSelectionResizeHandleRef: MutableRefObject<HoveredSelectionResizeHandle | null>;
  spacePressedRef: MutableRefObject<boolean>;
  nodeVisualsRef: MutableRefObject<Map<string, NodeVisual>>;
  nodePositionsRef: MutableRefObject<Map<string, Position>>;
  nodeCardDraftSizesRef: MutableRefObject<Map<string, { width: number; height: number }>>;
  nodeCardDraftPositionsRef: MutableRefObject<Map<string, Position>>;
  numericSliderDragStateRef: MutableRefObject<NumericSliderDragState | null>;
  connectionDragStateRef: MutableRefObject<ConnectionDragState | null>;
  panStateRef: MutableRefObject<PanState | null>;
  inputPortPositionsRef: MutableRefObject<Map<string, Position>>;
  hoveredInputPortKeyRef: MutableRefObject<string | null>;
  hoveredOutputPortKeyRef: MutableRefObject<string | null>;
  selectedConnectionIdRef: MutableRefObject<string | null>;
  selectedDrawingIdRef: MutableRefObject<string | null>;
  selectedNodeIdRef: MutableRefObject<string | null>;
  selectedNodeIdsRef: MutableRefObject<string[]>;
  requestCanvasAnimationLoop: () => void;
  requestViewportInteractionRefresh: (options?: { scaleSensitive?: boolean }) => void;
  requestViewportDrivenGraphRefresh: () => void;
  drawConnections: () => void;
  drawFreehandStrokes: () => void;
  drawMinimap: () => void;
  drawEffects: () => void;
  updateNumericSliderFromPointer: (nodeId: string, pointerX: number, pointerY: number) => void;
  enqueueNumericSliderPropagation: (
    nodeId: string,
    nextValue: number,
    options?: { flush?: boolean }
  ) => void;
  refreshCanvasBackgroundTexture: () => void;
  syncNodePortPositions: (nodeId: string, position: Position, visual: NodeVisual) => void;
  pickConnectionAtClientPoint: (clientX: number, clientY: number) => string | null;
  endConnectionDrag: (commit: boolean) => void;
  commitNumericSliderValue: (nodeId: string, nextValue: number) => void;
  addDrawingPath: (drawingId: string, path: DrawingPath) => void;
  updateNodePosition: (nodeId: string, position: Position) => void;
  updateDrawingPosition: (drawingId: string, position: Position) => void;
  submitGraphCommands: (commands: GraphCommand[]) => void | Promise<void>;
  deleteConnection: (connectionId: string) => void;
  deleteDrawing: (drawingId: string) => void;
  selectNode: (nodeId: string | null) => void;
  setNodeSelection: (nodeIds: string[]) => void;
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
    selectionDragStateRef,
    selectionResizeStateRef,
    selectionMarqueeStateRef,
    hoveredSelectionResizeHandleRef,
    spacePressedRef,
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
    selectedNodeIdsRef,
    requestCanvasAnimationLoop,
    requestViewportInteractionRefresh,
    requestViewportDrivenGraphRefresh,
    drawConnections,
    drawFreehandStrokes,
    drawMinimap,
    drawEffects,
    updateNumericSliderFromPointer,
    enqueueNumericSliderPropagation,
    refreshCanvasBackgroundTexture,
    syncNodePortPositions,
    pickConnectionAtClientPoint,
    endConnectionDrag,
    commitNumericSliderValue,
    addDrawingPath,
    updateNodePosition,
    updateDrawingPosition,
    submitGraphCommands,
    deleteConnection,
    deleteDrawing,
    selectNode,
    setNodeSelection,
    selectDrawing,
    setInputPortHighlight,
    applyCanvasCursor,
    renderGraphRef,
    config,
  } = params;

  const persistNodeBatchUpdate = useCallback((
    nodeStates: Map<string, {
      position: Position;
      size?: {
        width: number;
        height: number;
      };
    }>
  ) => {
    const currentGraph = graphRef.current;
    if (!currentGraph || nodeStates.size === 0) {
      return;
    }

    const nextNodes = currentGraph.nodes.map((node) => {
      const nodeState = nodeStates.get(node.id);
      if (!nodeState) {
        return node;
      }

      return {
        ...node,
        position: nodeState.position,
        config: nodeState.size
          ? {
            ...node.config,
            config: {
              ...(node.config.config ?? {}),
              cardWidth: nodeState.size.width,
              cardHeight: nodeState.size.height,
            },
          }
          : node.config,
      };
    });

    void submitGraphCommands([{
      kind: 'replace_nodes',
      nodes: nextNodes,
    }]);
  }, [graphRef, submitGraphCommands]);

  const deleteSelectedNodesBatch = useCallback((nodeIds: string[]) => {
    const currentGraph = graphRef.current;
    if (!currentGraph || nodeIds.length === 0) {
      return;
    }

    const nodeIdSet = new Set(nodeIds);
    const nextNodes = currentGraph.nodes.filter((node) => !nodeIdSet.has(node.id));
    const nextConnections = currentGraph.connections.filter(
      (connection) => !nodeIdSet.has(connection.sourceNodeId) && !nodeIdSet.has(connection.targetNodeId)
    );

    selectedNodeIdsRef.current = [];
    selectedNodeIdRef.current = null;
    selectedDrawingIdRef.current = null;
    setNodeSelection([]);
    selectedConnectionIdRef.current = null;
    nodeCardDraftPositionsRef.current.clear();
    nodeCardDraftSizesRef.current.clear();
    void submitGraphCommands([
      {
        kind: 'replace_nodes',
        nodes: nextNodes,
      },
      {
        kind: 'replace_connections',
        connections: nextConnections,
      },
    ]);
  }, [
    graphRef,
    nodeCardDraftPositionsRef,
    nodeCardDraftSizesRef,
    selectedConnectionIdRef,
    selectedDrawingIdRef,
    selectedNodeIdRef,
    selectedNodeIdsRef,
    setNodeSelection,
    submitGraphCommands,
  ]);

  const resolveNodeSelectionWithinRect = useCallback((selectionRect: {
    x: number;
    y: number;
    width: number;
    height: number;
  }): string[] => {
    const currentGraph = graphRef.current;
    if (!currentGraph) {
      return [];
    }

    const nextSelectedNodeIds: string[] = [];
    for (const node of currentGraph.nodes) {
      const nodeVisual = nodeVisualsRef.current.get(node.id);
      const nodePosition = nodePositionsRef.current.get(node.id);
      if (!nodeVisual || !nodePosition) {
        continue;
      }

      const nodeRect = {
        x: nodePosition.x,
        y: nodePosition.y,
        width: nodeVisual.width,
        height: nodeVisual.height,
      };
      if (rectIntersectsRect(selectionRect, nodeRect)) {
        nextSelectedNodeIds.push(node.id);
      }
    }

    return nextSelectedNodeIds;
  }, [graphRef, nodePositionsRef, nodeVisualsRef]);

  const applyNodeSelection = useCallback((nodeIds: string[]) => {
    const normalizedNodeIds = Array.from(new Set(nodeIds));
    selectedNodeIdsRef.current = normalizedNodeIds;
    selectedNodeIdRef.current = normalizedNodeIds.length === 1 ? normalizedNodeIds[0] : null;
    selectedDrawingIdRef.current = null;
    setNodeSelection(normalizedNodeIds);
  }, [selectedDrawingIdRef, selectedNodeIdRef, selectedNodeIdsRef, setNodeSelection]);

  const startDuplicateSelectionDrag = useCallback((
    selectionDragState: SelectionDragState,
    draggedNodePositions: Map<string, Position>
  ): SelectionDragState | null => {
    const currentGraph = graphRef.current;
    if (!currentGraph || draggedNodePositions.size === 0) {
      return null;
    }

    const duplication = duplicateNodeSelectionInGraph({
      graph: currentGraph,
      selectedNodeIds: Array.from(selectionDragState.nodeStartPositions.keys()),
      duplicatedNodePositions: draggedNodePositions,
      createId: uuidv4,
    });

    if (duplication.duplicatedNodeIds.length === 0) {
      return null;
    }

    const nextNodeStartPositions = new Map<string, Position>();
    const nextCurrentNodePositions = new Map<string, Position>();
    for (const [sourceNodeId, duplicateNodeId] of duplication.sourceToDuplicateNodeId.entries()) {
      const startPosition = selectionDragState.nodeStartPositions.get(sourceNodeId);
      const currentPosition = draggedNodePositions.get(sourceNodeId);
      if (!startPosition || !currentPosition) {
        continue;
      }
      nextNodeStartPositions.set(duplicateNodeId, { ...startPosition });
      nextCurrentNodePositions.set(duplicateNodeId, { ...currentPosition });
    }

    graphRef.current = duplication.graph;
    applyNodeSelection(duplication.duplicatedNodeIds);
    nodeCardDraftPositionsRef.current.clear();
    for (const [duplicateNodeId, position] of nextCurrentNodePositions.entries()) {
      nodeCardDraftPositionsRef.current.set(duplicateNodeId, position);
    }
    void submitGraphCommands([
      {
        kind: 'replace_nodes',
        nodes: duplication.graph.nodes,
      },
      {
        kind: 'replace_connections',
        connections: duplication.graph.connections,
      },
      {
        kind: 'replace_projections',
        projections: duplication.graph.projections ?? [],
      },
    ]);

    return {
      pointerX: selectionDragState.pointerX,
      pointerY: selectionDragState.pointerY,
      nodeStartPositions: nextNodeStartPositions,
      currentNodePositions: nextCurrentNodePositions,
      moved: true,
      duplicateOnDrag: false,
    };
  }, [
    applyNodeSelection,
    graphRef,
    nodeCardDraftPositionsRef,
    submitGraphCommands,
  ]);

  const finishInteraction = useCallback(() => {
    if (connectionDragStateRef.current) {
      endConnectionDrag(true);
    }

    const numericSliderDragState = numericSliderDragStateRef.current;
    if (numericSliderDragState) {
      if (Math.abs(numericSliderDragState.currentValue - numericSliderDragState.initialValue) > 1e-9) {
        if (numericSliderDragState.propagateWhileDragging) {
          enqueueNumericSliderPropagation(
            numericSliderDragState.nodeId,
            numericSliderDragState.currentValue,
            { flush: true }
          );
        } else {
          commitNumericSliderValue(numericSliderDragState.nodeId, numericSliderDragState.currentValue);
        }
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

    const selectionDragState = selectionDragStateRef.current;
    if (selectionDragState) {
      if (selectionDragState.moved) {
        const nextNodeStates = new Map<string, { position: Position }>();
        for (const [nodeId, position] of selectionDragState.currentNodePositions.entries()) {
          nextNodeStates.set(nodeId, { position });
        }
        persistNodeBatchUpdate(nextNodeStates);
      }
      nodeCardDraftPositionsRef.current.clear();
      selectionDragStateRef.current = null;
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

    const selectionResizeState = selectionResizeStateRef.current;
    if (selectionResizeState) {
      if (
        Math.abs(selectionResizeState.currentBounds.x - selectionResizeState.bounds.x) > 0.5 ||
        Math.abs(selectionResizeState.currentBounds.y - selectionResizeState.bounds.y) > 0.5 ||
        Math.abs(selectionResizeState.currentBounds.width - selectionResizeState.bounds.width) > 0.5 ||
        Math.abs(selectionResizeState.currentBounds.height - selectionResizeState.bounds.height) > 0.5
      ) {
        const nextNodeStates = new Map<string, {
          position: Position;
          size: {
            width: number;
            height: number;
          };
        }>();
        for (const [nodeId, nodeState] of selectionResizeState.currentNodeStates.entries()) {
          nextNodeStates.set(nodeId, {
            position: {
              x: nodeState.x,
              y: nodeState.y,
            },
            size: {
              width: nodeState.width,
              height: nodeState.height,
            },
          });
        }
        persistNodeBatchUpdate(nextNodeStates);
      }
      nodeCardDraftSizesRef.current.clear();
      nodeCardDraftPositionsRef.current.clear();
      selectionResizeStateRef.current = null;
      hoveredSelectionResizeHandleRef.current = null;
    }

    const resizeState = nodeResizeStateRef.current;
    if (resizeState) {
      const positionChanged =
        Math.abs(resizeState.currentX - resizeState.x) > 0.5 ||
        Math.abs(resizeState.currentY - resizeState.y) > 0.5;
      const sizeChanged =
        Math.abs(resizeState.currentWidth - resizeState.width) > 0.5 ||
        Math.abs(resizeState.currentHeight - resizeState.height) > 0.5;
      if (positionChanged || sizeChanged) {
        persistNodeBatchUpdate(new Map([
          [
            resizeState.nodeId,
            {
              position: {
                x: resizeState.currentX,
                y: resizeState.currentY,
              },
              size: {
                width: resizeState.currentWidth,
                height: resizeState.currentHeight,
              },
            },
          ],
        ]));
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

    const selectionMarqueeState = selectionMarqueeStateRef.current;
    if (selectionMarqueeState) {
      if (selectionMarqueeState.moved) {
        const selectionRect = computeRectFromPoints(
          selectionMarqueeState.startWorldX,
          selectionMarqueeState.startWorldY,
          selectionMarqueeState.currentWorldX,
          selectionMarqueeState.currentWorldY
        );
        const nextSelectedNodeIds = resolveNodeSelectionWithinRect(selectionRect);
        if (selectionMarqueeState.additive) {
          applyNodeSelection([...selectedNodeIdsRef.current, ...nextSelectedNodeIds]);
        } else {
          applyNodeSelection(nextSelectedNodeIds);
        }
      } else if (!selectionMarqueeState.additive) {
        if (selectedDrawingIdRef.current) {
          selectedDrawingIdRef.current = null;
          selectDrawing(null);
        } else {
          applyNodeSelection([]);
        }
      }
      selectionMarqueeStateRef.current = null;
      renderGraphRef.current();
    }

    panStateRef.current = null;
    hoveredInputPortKeyRef.current = null;
    hoveredOutputPortKeyRef.current = null;
    applyCanvasCursor();
  }, [
    activeDrawingPathRef,
    addDrawingPath,
    applyNodeSelection,
    applyCanvasCursor,
    commitNumericSliderValue,
    connectionDragStateRef,
    drawFreehandStrokes,
    drawingDragStateRef,
    endConnectionDrag,
    enqueueNumericSliderPropagation,
    hoveredSelectionResizeHandleRef,
    hoveredInputPortKeyRef,
    hoveredOutputPortKeyRef,
    nodeCardDraftPositionsRef,
    nodeCardDraftSizesRef,
    nodeDragStateRef,
    nodeResizeStateRef,
    numericSliderDragStateRef,
    panStateRef,
    persistNodeBatchUpdate,
    renderGraphRef,
    resolveNodeSelectionWithinRect,
    selectedDrawingIdRef,
    selectedNodeIdsRef,
    selectionDragStateRef,
    selectionMarqueeStateRef,
    selectionResizeStateRef,
    selectDrawing,
    updateDrawingPosition,
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
      selectedNodeIdsRef.current = [];
      selectedDrawingIdRef.current = null;
      selectNode(null);
      drawConnections();
      return;
    }

    if (spacePressedRef.current) {
      panStateRef.current = {
        pointerX: event.global.x,
        pointerY: event.global.y,
        viewportX: viewport.position.x,
        viewportY: viewport.position.y,
      };
      applyCanvasCursor();
      return;
    }

    if (selectedConnectionIdRef.current) {
      selectedConnectionIdRef.current = null;
      drawConnections();
    }

    const worldPoint = viewport.toLocal(new Point(event.global.x, event.global.y));
    selectionMarqueeStateRef.current = {
      startWorldX: worldPoint.x,
      startWorldY: worldPoint.y,
      currentWorldX: worldPoint.x,
      currentWorldY: worldPoint.y,
      additive: Boolean(event.ctrlKey || event.metaKey),
      moved: false,
    };
    applyCanvasCursor();
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
    selectedConnectionIdRef,
    selectedDrawingIdRef,
    selectedNodeIdRef,
    selectedNodeIdsRef,
    selectionMarqueeStateRef,
    selectNode,
    spacePressedRef,
    viewportRef,
  ]);

  const updateSelectionResizeFromPointer = useCallback((pointerX: number, pointerY: number): boolean => {
    const viewport = viewportRef.current;
    const selectionResizeState = selectionResizeStateRef.current;
    if (!viewport || !selectionResizeState) {
      return false;
    }

    let minScaleX = 0;
    let minScaleY = 0;
    for (const nodeState of selectionResizeState.nodeStates.values()) {
      minScaleX = Math.max(minScaleX, nodeState.minWidth / Math.max(nodeState.width, 1));
      minScaleY = Math.max(minScaleY, nodeState.minHeight / Math.max(nodeState.height, 1));
    }

    const resizedBounds = computeSelectionResizeDraft({
      bounds: selectionResizeState.bounds,
      handle: selectionResizeState.handle,
      pointerX,
      pointerY,
      startPointerX: selectionResizeState.pointerX,
      startPointerY: selectionResizeState.pointerY,
      scale: viewport.scale.x || 1,
      minWidth: selectionResizeState.bounds.width * minScaleX,
      minHeight: selectionResizeState.bounds.height * minScaleY,
    });
    const scaleX = resizedBounds.width / Math.max(selectionResizeState.bounds.width, 1);
    const scaleY = resizedBounds.height / Math.max(selectionResizeState.bounds.height, 1);
    const nextNodeStates = new Map<string, SelectionResizeNodeState>();

    for (const [nodeId, nodeState] of selectionResizeState.nodeStates.entries()) {
      const relativeLeft = nodeState.x - selectionResizeState.bounds.x;
      const relativeTop = nodeState.y - selectionResizeState.bounds.y;
      const relativeRight = relativeLeft + nodeState.width;
      const relativeBottom = relativeTop + nodeState.height;
      const nextX = resizedBounds.x + (relativeLeft * scaleX);
      const nextY = resizedBounds.y + (relativeTop * scaleY);
      const nextRight = resizedBounds.x + (relativeRight * scaleX);
      const nextBottom = resizedBounds.y + (relativeBottom * scaleY);
      nextNodeStates.set(nodeId, {
        x: nextX,
        y: nextY,
        width: Math.max(nodeState.minWidth, nextRight - nextX),
        height: Math.max(nodeState.minHeight, nextBottom - nextY),
        minWidth: nodeState.minWidth,
        minHeight: nodeState.minHeight,
      });
    }

    selectionResizeState.currentBounds = resizedBounds;
    selectionResizeState.currentNodeStates = nextNodeStates;
    nodeCardDraftSizesRef.current.clear();
    nodeCardDraftPositionsRef.current.clear();
    for (const [nodeId, nodeState] of nextNodeStates.entries()) {
      nodeCardDraftPositionsRef.current.set(nodeId, {
        x: nodeState.x,
        y: nodeState.y,
      });
      nodeCardDraftSizesRef.current.set(nodeId, {
        width: nodeState.width,
        height: nodeState.height,
      });
    }
    renderGraphRef.current();
    applyCanvasCursor();
    return true;
  }, [
    applyCanvasCursor,
    nodeCardDraftPositionsRef,
    nodeCardDraftSizesRef,
    renderGraphRef,
    selectionResizeStateRef,
    viewportRef,
  ]);

  const updateSelectionDragFromPointer = useCallback((pointerX: number, pointerY: number): boolean => {
    const viewport = viewportRef.current;
    const selectionDragState = selectionDragStateRef.current;
    if (!viewport || !selectionDragState) {
      return false;
    }

    const deltaX = pointerX - selectionDragState.pointerX;
    const deltaY = pointerY - selectionDragState.pointerY;
    if (
      !selectionDragState.moved &&
      !hasExceededDragThreshold(deltaX, deltaY, config.nodeDragStartThreshold)
    ) {
      return true;
    }

    const draggedNodePositions = new Map<string, Position>();
    for (const [nodeId, startPosition] of selectionDragState.nodeStartPositions.entries()) {
      const nextPosition = computeSnappedDragPosition({
        originX: startPosition.x,
        originY: startPosition.y,
        pointerX,
        pointerY,
        startPointerX: selectionDragState.pointerX,
        startPointerY: selectionDragState.pointerY,
        scale: viewport.scale.x || 1,
      });
      draggedNodePositions.set(nodeId, nextPosition);
    }

    if (selectionDragState.duplicateOnDrag) {
      const duplicatedSelectionDragState = startDuplicateSelectionDrag(
        selectionDragState,
        draggedNodePositions
      );
      if (duplicatedSelectionDragState) {
        selectionDragStateRef.current = duplicatedSelectionDragState;
        renderGraphRef.current();
        drawMinimap();
        return true;
      }
    }

    nodeCardDraftPositionsRef.current.clear();
    for (const [nodeId, nextPosition] of draggedNodePositions.entries()) {
      selectionDragState.currentNodePositions.set(nodeId, nextPosition);
      nodeCardDraftPositionsRef.current.set(nodeId, nextPosition);
    }
    selectionDragState.moved = true;
    renderGraphRef.current();
    drawMinimap();
    return true;
  }, [
    config.nodeDragStartThreshold,
    drawMinimap,
    nodeCardDraftPositionsRef,
    renderGraphRef,
    startDuplicateSelectionDrag,
    selectionDragStateRef,
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

    if (updateSelectionResizeFromPointer(event.global.x, event.global.y)) {
      return;
    }

    const connectionDrag = connectionDragStateRef.current;
    if (connectionDrag) {
      connectionDrag.pointerX = event.global.x;
      connectionDrag.pointerY = event.global.y;

      if (viewport) {
        const worldPoint = viewport.toLocal(new Point(event.global.x, event.global.y));
        const hoverRadius = Math.max(
          config.portRadius + 8,
          config.annotationEdgeHitWidth
        ) / Math.max(viewport.scale.x, 0.1);
        let nextHoveredTarget: ConnectionDragState['hoveredTarget'] = null;

        for (const [portKey, portPosition] of inputPortPositionsRef.current.entries()) {
          const dx = worldPoint.x - portPosition.x;
          const dy = worldPoint.y - portPosition.y;
          if ((dx * dx) + (dy * dy) <= hoverRadius * hoverRadius) {
            nextHoveredTarget = {
              type: 'input-port',
              portKey,
            };
            break;
          }
        }

        if (!nextHoveredTarget) {
          for (const [nodeId, nodeVisual] of nodeVisualsRef.current.entries()) {
            const nodePosition = nodePositionsRef.current.get(nodeId);
            if (!nodePosition) {
              continue;
            }

            const dropTarget = resolveCardEdgeDropTarget(
              nodePosition,
              nodeVisual.width,
              nodeVisual.height,
              worldPoint,
              config.annotationEdgeHitWidth / Math.max(viewport.scale.x, 0.1)
            );
            if (!dropTarget) {
              continue;
            }

            nextHoveredTarget = {
              type: 'card-edge',
              nodeId,
              anchor: dropTarget.anchor,
              point: dropTarget.point,
            };
            break;
          }
        }

        const previousHoveredInput = connectionDrag.hoveredTarget?.type === 'input-port'
          ? connectionDrag.hoveredTarget.portKey
          : null;
        const nextHoveredInput = nextHoveredTarget?.type === 'input-port'
          ? nextHoveredTarget.portKey
          : null;

        if (previousHoveredInput !== nextHoveredInput) {
          if (previousHoveredInput) {
            setInputPortHighlight(previousHoveredInput, false);
          }
          if (nextHoveredInput) {
            setInputPortHighlight(nextHoveredInput, true);
          }
          connectionDrag.hoveredTarget = nextHoveredTarget;
        } else {
          connectionDrag.hoveredTarget = nextHoveredTarget;
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

    if (updateSelectionDragFromPointer(event.global.x, event.global.y)) {
      return;
    }

    const selectionMarqueeState = selectionMarqueeStateRef.current;
    if (selectionMarqueeState) {
      if (!viewport) {
        return;
      }

      const worldPoint = viewport.toLocal(new Point(event.global.x, event.global.y));
      selectionMarqueeState.currentWorldX = worldPoint.x;
      selectionMarqueeState.currentWorldY = worldPoint.y;
      if (!selectionMarqueeState.moved) {
        selectionMarqueeState.moved = hasExceededDragThreshold(
          worldPoint.x - selectionMarqueeState.startWorldX,
          worldPoint.y - selectionMarqueeState.startWorldY,
          config.nodeDragStartThreshold
        );
      }
      renderGraphRef.current();
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
    config.annotationEdgeHitWidth,
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
    selectionMarqueeStateRef,
    setInputPortHighlight,
    syncNodePortPositions,
    updateSelectionDragFromPointer,
    updateSelectionResizeFromPointer,
    updateNumericSliderFromPointer,
    viewportRef,
  ]);

  const handleWindowPointerMove = useCallback((event: PointerEvent) => {
    if (!selectionDragStateRef.current && !selectionResizeStateRef.current) {
      return;
    }

    const app = appRef.current;
    if (!app) {
      return;
    }

    const canvasRect = (app.view as HTMLCanvasElement).getBoundingClientRect();
    const pointerX = event.clientX - canvasRect.left;
    const pointerY = event.clientY - canvasRect.top;

    if (updateSelectionResizeFromPointer(pointerX, pointerY)) {
      return;
    }
    void updateSelectionDragFromPointer(pointerX, pointerY);
  }, [
    appRef,
    selectionDragStateRef,
    selectionResizeStateRef,
    updateSelectionDragFromPointer,
    updateSelectionResizeFromPointer,
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
    const canvasElement = appRef.current?.view as HTMLCanvasElement | undefined;
    const activeElement = document.activeElement as HTMLElement | null;
    if (!canvasElement) {
      return;
    }

    if (event.code === 'Space') {
      if (isCanvasDeletionShortcutBlocked(activeElement, canvasElement)) {
        return;
      }
      spacePressedRef.current = true;
      event.preventDefault();
      applyCanvasCursor();
      return;
    }

    if (event.key !== 'Delete' && event.key !== 'Backspace') {
      return;
    }

    if (isCanvasDeletionShortcutBlocked(activeElement, canvasElement)) {
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

    const selectedNodeIds = selectedNodeIdsRef.current;
    if (selectedNodeIds.length === 0) {
      return;
    }

    event.preventDefault();
    deleteSelectedNodesBatch(selectedNodeIds);
    drawConnections();
  }, [
    appRef,
    applyCanvasCursor,
    deleteConnection,
    deleteSelectedNodesBatch,
    deleteDrawing,
    drawConnections,
    drawFreehandStrokes,
    drawMinimap,
    selectedConnectionIdRef,
    selectedDrawingIdRef,
    selectedNodeIdsRef,
    spacePressedRef,
  ]);

  const handleKeyUp = useCallback((event: KeyboardEvent) => {
    if (event.code !== 'Space') {
      return;
    }
    if (!spacePressedRef.current) {
      return;
    }
    spacePressedRef.current = false;
    applyCanvasCursor();
  }, [applyCanvasCursor, spacePressedRef]);

  return {
    finishInteraction,
    handleStagePointerDown,
    handleStagePointerMove,
    handleWindowPointerMove,
    handleStagePointerUp,
    handleWheel,
    handleResize,
    handleKeyDown,
    handleKeyUp,
  };
}
