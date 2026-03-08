import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Application,
  Circle,
  Container,
  FederatedPointerEvent,
  Graphics,
  Rectangle,
  Sprite,
  Text,
  Texture,
} from 'pixi.js';
import { useGraphStore } from '../store/graphStore';
import type {
  NodeExecutionState,
  NodeGraphicsComputationDebug,
} from '../store/graphStore';
import {
  CanvasBackgroundSettings,
  NodeType,
  Position,
} from '../types';
import { resolveGraphCanvasBackground } from '../utils/canvasBackground';
import {
  interpolateCanvasBackground,
  makePortKey,
  snapToPixel,
} from '../utils/canvasHelpers';
import {
  type GraphicsTextureCacheEntry,
} from '../utils/canvasTextureCache';
import {
  type ConnectionGeometry,
  type LightningPulse,
  type NodeShock,
  type SmokePuff,
} from '../utils/canvasEffects';
import {
  clearRenderLayerChildren,
  pruneNodeDraftMaps,
  resolveProjectionTransitionFrame,
} from '../utils/canvasRenderLifecycle';
import {
  resolveGraphicsProjectionPlan,
  resolveNodeRenderFrame,
  resolveNodeRenderTargetPosition,
} from '../utils/canvasNodeRender';
import { colorStringToPixi } from '../utils/color';
import { buildGraphicsImageUrl } from '../utils/graphics';
import { truncateTextToWidth } from '../utils/textLayout';
import {
  formatNumericInputValue,
  normalizeNumericInputConfig,
  snapNumericInputValue,
} from '../utils/numericInput';
import {
  HEADER_HEIGHT,
  NODE_BODY_PADDING,
} from '../../../shared/src/nodeCardGeometry.js';
import { CanvasChrome } from './CanvasChrome';
import { CanvasStatusOverlay } from './CanvasStatusOverlay';
import {
  useCanvasViewport,
  type MinimapTransform,
  type ProjectionTransitionState,
} from './useCanvasViewport';
import {
  type ActiveDrawingPath,
  type AnnotationOverlayEntry,
  type AnnotationOverlayTransform,
  type ConnectionDragState,
  type DrawingDragState,
  type DrawingVisual,
  type HoveredResizeHandle,
  type NodeDragState,
  type NodeResizeState,
  type NodeVisual,
  type NumericSliderDragState,
  type NumericSliderVisual,
  type PanState,
  areAnnotationOverlaysEqual,
  areNodeGraphicsDebugValuesEqual,
  drawInputPortMarker,
  drawNodeCardFrame,
  drawNumericSliderVisual,
  drawOutputPortMarker,
  getNextDrawingName,
  getTextureDimensions,
  getViewportWorldBounds,
  isRenderablePythonGraphicsOutput,
  resolveNodeCardDimensions,
  type ResizeHandleDirection,
  resolveResizeCursor,
} from './canvasShared';
import { useCanvasGraphEffects } from './useCanvasGraphEffects';
import { useCanvasInteractions } from './useCanvasInteractions';
import { useMcpScreenshotBridge } from './useMcpScreenshotBridge';
import { useCanvasRuntime } from './useCanvasRuntime';
import { usePixiCanvasLifecycle } from './usePixiCanvasLifecycle';
import { useCanvasExecutionEffects } from './useCanvasExecutionEffects';
import { normalizeAnnotationConfig } from '../utils/annotation';

const ANNOTATION_TEXT_INSET_X = 8;
const ANNOTATION_TEXT_INSET_Y = 8;
const ANNOTATION_TEXT_INSET_BOTTOM = 8;
const PORT_RADIUS = 4;
const NODE_GRAPHICS_FALLBACK_ASPECT_RATIO = 0.6;
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 4;
const ZOOM_SENSITIVITY = 0.0014;
const VIEWPORT_MARGIN = 100;
const EDGE_HIT_WIDTH = 16;
const CONNECTION_WIRE_SCREEN_WIDTH = 1;
const CONNECTION_WIRE_FOREGROUND_ALPHA = 0.92;
const CONNECTION_WIRE_BACKGROUND_ALPHA = 0.64;
const CONNECTION_WIRE_SELECTED_FOREGROUND_ALPHA = 1;
const CONNECTION_WIRE_SELECTED_BACKGROUND_ALPHA = 0.9;
const MINIMAP_WIDTH = 220;
const MINIMAP_HEIGHT = 140;
const MINIMAP_PADDING = 8;
const NODE_DRAG_START_THRESHOLD = 2;
const LIGHTNING_DURATION_MS = 900;
const NODE_SHOCK_DURATION_MS = 1200;
const DRAW_SMOOTHING_STEP = 1;
const NUMERIC_SLIDER_LEFT_PADDING = 12;
const NUMERIC_SLIDER_RIGHT_PADDING = 34;
const NUMERIC_SLIDER_Y_OFFSET = 15;
const NODE_RESIZE_HANDLE_SIZE = 10;
const NODE_RESIZE_HANDLE_MARGIN = 4;
const SMOKE_EMIT_INTERVAL_MS = 140;
const SMOKE_MIN_DURATION_MS = 720;
const SMOKE_MAX_DURATION_MS = 1320;
const SMOKE_MAX_PARTICLES = 96;
const PROJECTION_TRANSITION_DURATION_MS = 260;
const PIXEL_RATIO = typeof window !== 'undefined' ? Math.max(window.devicePixelRatio || 1, 1) : 1;
const MAX_TEXT_RESOLUTION = PIXEL_RATIO * 4;
const NODE_TITLE_CHAR_WIDTH_ESTIMATE = 8;
const NODE_TITLE_TEXT_STYLE = { fontFamily: 'Arial', fontSize: 14, fontWeight: 'bold' as const, fill: 0x0f172a };
const VIEWPORT_INTERACTION_SETTLE_MS = 180;

interface CanvasProps {
  enableMcpScreenshotBridge?: boolean;
}

interface CanvasDebugCounters {
  fullRenderCount?: number;
  viewportSyncCount?: number;
  viewportDeferredRenderCount?: number;
}

function incrementCanvasDebugCounter(counter: keyof CanvasDebugCounters): void {
  if (typeof window === 'undefined') {
    return;
  }

  const debugCounters = (window as Window & {
    __k8vCanvasDebug?: CanvasDebugCounters;
  }).__k8vCanvasDebug;
  if (!debugCounters) {
    return;
  }

  debugCounters[counter] = (debugCounters[counter] ?? 0) + 1;
}

function resolveAnnotationOverlayTransform(viewport: Container | null): AnnotationOverlayTransform {
  if (!viewport) {
    return { x: 0, y: 0, scale: 1 };
  }

  return {
    x: snapToPixel(viewport.position.x),
    y: snapToPixel(viewport.position.y),
    scale: Math.max(Math.abs(viewport.scale.x || 1), 0.0001),
  };
}

function buildAnnotationOverlayTransformCss(transform: AnnotationOverlayTransform): string {
  return `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`;
}

function Canvas({ enableMcpScreenshotBridge = false }: CanvasProps) {
  const graph = useGraphStore((state) => state.graph);
  const selectedNodeId = useGraphStore((state) => state.selectedNodeId);
  const selectedDrawingId = useGraphStore((state) => state.selectedDrawingId);
  const nodeExecutionStates = useGraphStore((state) => state.nodeExecutionStates);
  const nodeGraphicsOutputs = useGraphStore((state) => state.nodeGraphicsOutputs);
  const selectNode = useGraphStore((state) => state.selectNode);
  const updateNode = useGraphStore((state) => state.updateNode);
  const updateGraph = useGraphStore((state) => state.updateGraph);
  const selectDrawing = useGraphStore((state) => state.selectDrawing);
  const updateNodePosition = useGraphStore((state) => state.updateNodePosition);
  const updateDrawingPosition = useGraphStore((state) => state.updateDrawingPosition);
  const addDrawing = useGraphStore((state) => state.addDrawing);
  const addDrawingPath = useGraphStore((state) => state.addDrawingPath);
  const deleteDrawing = useGraphStore((state) => state.deleteDrawing);
  const drawingCreateRequestId = useGraphStore((state) => state.drawingCreateRequestId);
  const addConnection = useGraphStore((state) => state.addConnection);
  const deleteConnection = useGraphStore((state) => state.deleteConnection);
  const deleteNode = useGraphStore((state) => state.deleteNode);
  const createGraph = useGraphStore((state) => state.createGraph);
  const isLoading = useGraphStore((state) => state.isLoading);
  const error = useGraphStore((state) => state.error);
  const drawingEnabled = useGraphStore((state) => state.drawingEnabled);
  const drawingColor = useGraphStore((state) => state.drawingColor);
  const drawingThickness = useGraphStore((state) => state.drawingThickness);
  const setSelectedNodeGraphicsDebug = useGraphStore((state) => state.setSelectedNodeGraphicsDebug);

  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const minimapCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const minimapTransformRef = useRef<MinimapTransform | null>(null);
  const appRef = useRef<Application | null>(null);
  const backgroundSpriteRef = useRef<Sprite | null>(null);
  const appliedCanvasBackgroundSignatureRef = useRef('');
  const lastResolvedCanvasBackgroundRef = useRef<CanvasBackgroundSettings>(resolveGraphCanvasBackground(graph));
  const viewportRef = useRef<Container | null>(null);
  const nodeLayerRef = useRef<Container | null>(null);
  const drawingHandleLayerRef = useRef<Container | null>(null);
  const edgeLayerRef = useRef<Graphics | null>(null);
  const drawLayerRef = useRef<Graphics | null>(null);
  const effectsLayerRef = useRef<Graphics | null>(null);
  const connectionGeometriesRef = useRef<Map<string, ConnectionGeometry>>(new Map());
  const lightningPulsesRef = useRef<LightningPulse[]>([]);
  const nodeShocksRef = useRef<NodeShock[]>([]);
  const drawingVisualsRef = useRef<Map<string, DrawingVisual>>(new Map());
  const drawingPositionsRef = useRef<Map<string, Position>>(new Map());
  const drawingDragStateRef = useRef<DrawingDragState | null>(null);
  const numericSliderVisualsRef = useRef<Map<string, NumericSliderVisual>>(new Map());
  const numericSliderDragStateRef = useRef<NumericSliderDragState | null>(null);
  const hoveredNumericSliderNodeIdRef = useRef<string | null>(null);
  const activeDrawingPathRef = useRef<ActiveDrawingPath | null>(null);
  const smokePuffsRef = useRef<SmokePuff[]>([]);
  const lastSmokeEmitAtRef = useRef<Map<string, number>>(new Map());
  const nodeVisualsRef = useRef<Map<string, NodeVisual>>(new Map());
  const nodePositionsRef = useRef<Map<string, Position>>(new Map());
  const textNodesRef = useRef<Set<Text>>(new Set());
  const inputPortMarkersRef = useRef<Map<string, Graphics>>(new Map());
  const outputPortMarkersRef = useRef<Map<string, Graphics>>(new Map());
  const inputPortPositionsRef = useRef<Map<string, Position>>(new Map());
  const outputPortPositionsRef = useRef<Map<string, Position>>(new Map());
  const hoveredInputPortKeyRef = useRef<string | null>(null);
  const hoveredOutputPortKeyRef = useRef<string | null>(null);
  const connectionDragStateRef = useRef<ConnectionDragState | null>(null);
  const selectedConnectionIdRef = useRef<string | null>(null);
  const selectedNodeIdRef = useRef<string | null>(selectedNodeId);
  const selectedDrawingIdRef = useRef<string | null>(selectedDrawingId);
  const nodeExecutionStatesRef = useRef(nodeExecutionStates);
  const drawingEnabledRef = useRef(drawingEnabled);
  const drawingColorRef = useRef(drawingColor);
  const drawingThicknessRef = useRef(drawingThickness);
  const previousNodeExecutionStatesRef = useRef<Record<string, NodeExecutionState>>({});
  const nodeGraphicsOutputsRef = useRef(nodeGraphicsOutputs);
  const nodeGraphicsTextureBindingsRef = useRef<Map<string, string>>(new Map());
  const nodePendingGraphicsTextureBindingsRef = useRef<Map<string, string>>(new Map());
  const graphicsTextureCacheRef = useRef<Map<string, GraphicsTextureCacheEntry>>(new Map());
  const pendingGraphicsTextureLoadsRef = useRef<Map<string, Texture>>(new Map());
  const graphRef = useRef(graph);
  const selectedNodeGraphicsDebugRef = useRef<NodeGraphicsComputationDebug | null>(null);
  const projectionTransitionRef = useRef<ProjectionTransitionState | null>(null);
  const renderGraphRef = useRef<() => void>(() => {});
  const viewportRefreshRafRef = useRef<number | null>(null);
  const panStateRef = useRef<PanState | null>(null);
  const nodeDragStateRef = useRef<NodeDragState | null>(null);
  const nodeResizeStateRef = useRef<NodeResizeState | null>(null);
  const hoveredNodeResizeHandleRef = useRef<HoveredResizeHandle | null>(null);
  const nodeCardDraftSizesRef = useRef<Map<string, { width: number; height: number }>>(new Map());
  const nodeCardDraftPositionsRef = useRef<Map<string, Position>>(new Map());
  const lastGraphIdRef = useRef<string | null>(null);
  const viewportInitializedRef = useRef(false);
  const handledDrawingCreateRequestRef = useRef(0);
  const annotationOverlaysRef = useRef<AnnotationOverlayEntry[]>([]);
  const annotationOverlayTransformRef = useRef<AnnotationOverlayTransform>({ x: 0, y: 0, scale: 1 });
  const annotationOverlayViewportRef = useRef<HTMLDivElement | null>(null);
  const viewportSyncRafRef = useRef<number | null>(null);
  const viewportSettledRenderTimeoutRef = useRef<number | null>(null);
  const [canvasReady, setCanvasReady] = useState(false);
  const [annotationOverlays, setAnnotationOverlays] = useState<AnnotationOverlayEntry[]>([]);
  selectedNodeIdRef.current = selectedNodeId;
  selectedDrawingIdRef.current = selectedDrawingId;
  nodeExecutionStatesRef.current = nodeExecutionStates;
  nodeGraphicsOutputsRef.current = nodeGraphicsOutputs;
  drawingEnabledRef.current = drawingEnabled;
  drawingColorRef.current = drawingColor;
  drawingThicknessRef.current = drawingThickness;

  const requestCanvasAnimationLoop = useCallback(() => {
    const app = appRef.current;
    if (!app || app.ticker.started) {
      return;
    }
    app.start();
  }, []);

  const requestViewportDrivenGraphRefresh = useCallback(() => {
    if (viewportRefreshRafRef.current !== null) {
      return;
    }

    viewportRefreshRafRef.current = window.requestAnimationFrame(() => {
      viewportRefreshRafRef.current = null;
      renderGraphRef.current();
    });
  }, []);

  const syncAnnotationOverlayTransform = useCallback(() => {
    const nextTransform = resolveAnnotationOverlayTransform(viewportRef.current);
    const previousTransform = annotationOverlayTransformRef.current;
    const overlayViewport = annotationOverlayViewportRef.current;
    const nextTransformCss = buildAnnotationOverlayTransformCss(nextTransform);

    if (
      previousTransform.x !== nextTransform.x ||
      previousTransform.y !== nextTransform.y ||
      Math.abs(previousTransform.scale - nextTransform.scale) > 0.0001
    ) {
      annotationOverlayTransformRef.current = nextTransform;
    }

    if (overlayViewport && overlayViewport.style.transform !== nextTransformCss) {
      overlayViewport.style.transform = nextTransformCss;
    }
  }, []);

  const requestViewportInteractionRefresh = useCallback(() => {
    requestCanvasAnimationLoop();

    if (viewportSyncRafRef.current === null) {
      viewportSyncRafRef.current = window.requestAnimationFrame(() => {
        viewportSyncRafRef.current = null;
        incrementCanvasDebugCounter('viewportSyncCount');
        syncAnnotationOverlayTransform();
      });
    }

    if (viewportSettledRenderTimeoutRef.current !== null) {
      window.clearTimeout(viewportSettledRenderTimeoutRef.current);
    }
    viewportSettledRenderTimeoutRef.current = window.setTimeout(() => {
      viewportSettledRenderTimeoutRef.current = null;
      incrementCanvasDebugCounter('viewportDeferredRenderCount');
      requestViewportDrivenGraphRefresh();
    }, VIEWPORT_INTERACTION_SETTLE_MS);
  }, [requestCanvasAnimationLoop, requestViewportDrivenGraphRefresh, syncAnnotationOverlayTransform]);

  useEffect(() => {
    return () => {
      if (viewportSyncRafRef.current !== null) {
        window.cancelAnimationFrame(viewportSyncRafRef.current);
        viewportSyncRafRef.current = null;
      }

      if (viewportSettledRenderTimeoutRef.current !== null) {
        window.clearTimeout(viewportSettledRenderTimeoutRef.current);
        viewportSettledRenderTimeoutRef.current = null;
      }
    };
  }, []);

  const {
    drawMinimap,
    fitViewportToGraph,
    handleMinimapPointerDown,
    setViewportRegionForScreenshot,
    startProjectionTransition,
    updateTextResolutionForScale,
  } = useCanvasViewport({
    appRef,
    minimapCanvasRef,
    minimapTransformRef,
    viewportRef,
    textNodesRef,
    graphRef,
    selectedNodeIdRef,
    selectedDrawingIdRef,
    nodeVisualsRef,
    drawingPositionsRef,
    nodePositionsRef,
    nodeCardDraftSizesRef,
    projectionTransitionRef,
    viewportInitializedRef,
    lastResolvedCanvasBackgroundRef,
    renderGraphRef,
    requestCanvasAnimationLoop,
    requestViewportDrivenGraphRefresh,
    resolveNodeCardDimensions,
    config: {
      pixelRatio: PIXEL_RATIO,
      maxTextResolution: MAX_TEXT_RESOLUTION,
      minimapWidth: MINIMAP_WIDTH,
      minimapHeight: MINIMAP_HEIGHT,
      minimapPadding: MINIMAP_PADDING,
      minZoom: MIN_ZOOM,
      maxZoom: MAX_ZOOM,
      viewportMargin: VIEWPORT_MARGIN,
      projectionTransitionDurationMs: PROJECTION_TRANSITION_DURATION_MS,
    },
  });

  useMcpScreenshotBridge({
    enabled: enableMcpScreenshotBridge,
    appRef,
    graphRef,
    setViewportRegionForScreenshot,
  });

  const {
    applyCanvasCursor,
    clearAllNodeGraphicsTextures,
    commitNumericSliderValue,
    drawConnections,
    drawEffects,
    drawFreehandStrokes,
    endConnectionDrag,
    enqueueLightningForNodeInputs,
    enqueueNodeShock,
    getNodeGraphicsTextureForNode,
    pickConnectionAtClientPoint,
    refreshCanvasBackgroundTexture,
    releaseUnusedNodeGraphicsTextures,
    setInputPortHighlight,
    syncNodePortPositions,
    updateNumericSliderFromPointer,
  } = useCanvasRuntime({
    appRef,
    viewportRef,
    graphRef,
    backgroundSpriteRef,
    appliedCanvasBackgroundSignatureRef,
    lastResolvedCanvasBackgroundRef,
    nodeResizeStateRef,
    hoveredNodeResizeHandleRef,
    drawingEnabledRef,
    numericSliderDragStateRef,
    hoveredNumericSliderNodeIdRef,
    panStateRef,
    connectionDragStateRef,
    nodeDragStateRef,
    drawingDragStateRef,
    activeDrawingPathRef,
    nodeExecutionStatesRef,
    lightningPulsesRef,
    nodeShocksRef,
    smokePuffsRef,
    inputPortMarkersRef,
    outputPortMarkersRef,
    inputPortPositionsRef,
    outputPortPositionsRef,
    connectionGeometriesRef,
    edgeLayerRef,
    drawLayerRef,
    effectsLayerRef,
    nodeVisualsRef,
    nodePositionsRef,
    drawingPositionsRef,
    numericSliderVisualsRef,
    selectedConnectionIdRef,
    hoveredInputPortKeyRef,
    hoveredOutputPortKeyRef,
    graphicsTextureCacheRef,
    pendingGraphicsTextureLoadsRef,
    nodeGraphicsTextureBindingsRef,
    nodePendingGraphicsTextureBindingsRef,
    lastSmokeEmitAtRef,
    renderGraphRef,
    requestCanvasAnimationLoop,
    updateNode,
    addConnection,
    config: {
      edgeHitWidth: EDGE_HIT_WIDTH,
      connectionWireScreenWidth: CONNECTION_WIRE_SCREEN_WIDTH,
      connectionWireForegroundAlpha: CONNECTION_WIRE_FOREGROUND_ALPHA,
      connectionWireBackgroundAlpha: CONNECTION_WIRE_BACKGROUND_ALPHA,
      connectionWireSelectedForegroundAlpha: CONNECTION_WIRE_SELECTED_FOREGROUND_ALPHA,
      connectionWireSelectedBackgroundAlpha: CONNECTION_WIRE_SELECTED_BACKGROUND_ALPHA,
      lightningDurationMs: LIGHTNING_DURATION_MS,
      nodeShockDurationMs: NODE_SHOCK_DURATION_MS,
      smokeEmitIntervalMs: SMOKE_EMIT_INTERVAL_MS,
      smokeMinDurationMs: SMOKE_MIN_DURATION_MS,
      smokeMaxDurationMs: SMOKE_MAX_DURATION_MS,
      smokeMaxParticles: SMOKE_MAX_PARTICLES,
    },
  });

  const {
    finishInteraction,
    handleStagePointerDown,
    handleStagePointerMove,
    handleStagePointerUp,
    handleWheel,
    handleResize,
    handleKeyDown,
  } = useCanvasInteractions({
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
    updateTextResolutionForScale,
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
    config: {
      portRadius: PORT_RADIUS,
      nodeDragStartThreshold: NODE_DRAG_START_THRESHOLD,
      drawSmoothingStep: DRAW_SMOOTHING_STEP,
      zoomSensitivity: ZOOM_SENSITIVITY,
      minZoom: MIN_ZOOM,
      maxZoom: MAX_ZOOM,
    },
  });

  const renderGraph = useCallback(() => {
    incrementCanvasDebugCounter('fullRenderCount');
    const nodesLayer = nodeLayerRef.current;
    const drawingHandleLayer = drawingHandleLayerRef.current;
    const currentGraph = graphRef.current;
    const app = appRef.current;
    const viewportContainer = viewportRef.current;
    const viewportWorldBounds =
      app && viewportContainer ? getViewportWorldBounds(app, viewportContainer) : null;
    const canEvaluateViewportGraphics = Boolean(viewportWorldBounds && viewportInitializedRef.current);
    const viewportScale = viewportContainer
      ? Math.max(Math.abs(viewportContainer.scale.x || 1), 0.0001)
      : 1;
    if (viewportSettledRenderTimeoutRef.current !== null) {
      window.clearTimeout(viewportSettledRenderTimeoutRef.current);
      viewportSettledRenderTimeoutRef.current = null;
    }
    syncAnnotationOverlayTransform();
    const projectionTransitionFrame = resolveProjectionTransitionFrame(
      projectionTransitionRef.current,
      currentGraph?.id ?? null,
      performance.now()
    );
    projectionTransitionRef.current = projectionTransitionFrame.transition;
    const activeProjectionTransition = projectionTransitionFrame.transition;
    const projectionTransitionEasedProgress = projectionTransitionFrame.easedProgress;
    const isProjectionTransitionActive = Boolean(activeProjectionTransition);
    const resolvedCanvasBackground = currentGraph
      ? (
        isProjectionTransitionActive && activeProjectionTransition
          ? interpolateCanvasBackground(
            activeProjectionTransition.fromBackground,
            activeProjectionTransition.toBackground,
            projectionTransitionEasedProgress
          )
          : resolveGraphCanvasBackground(currentGraph)
      )
      : resolveGraphCanvasBackground(null);

    if (!nodesLayer || !drawingHandleLayer) return;

    requestCanvasAnimationLoop();
    refreshCanvasBackgroundTexture(resolvedCanvasBackground);
    clearRenderLayerChildren(nodesLayer);
    clearRenderLayerChildren(drawingHandleLayer);
    nodeVisualsRef.current.clear();
    drawingVisualsRef.current.clear();
    numericSliderVisualsRef.current.clear();
    nodePositionsRef.current.clear();
    drawingPositionsRef.current.clear();
    textNodesRef.current.clear();
    inputPortMarkersRef.current.clear();
    outputPortMarkersRef.current.clear();
    inputPortPositionsRef.current.clear();
    outputPortPositionsRef.current.clear();
    hoveredInputPortKeyRef.current = null;
    hoveredOutputPortKeyRef.current = null;

    if (!currentGraph) {
      hoveredNumericSliderNodeIdRef.current = null;
      hoveredNodeResizeHandleRef.current = null;
      nodeCardDraftSizesRef.current.clear();
      nodeCardDraftPositionsRef.current.clear();
      if (annotationOverlaysRef.current.length > 0) {
        annotationOverlaysRef.current = [];
        setAnnotationOverlays([]);
      }
      clearAllNodeGraphicsTextures();
      if (selectedNodeGraphicsDebugRef.current !== null) {
        selectedNodeGraphicsDebugRef.current = null;
        setSelectedNodeGraphicsDebug(null);
      }
      drawConnections();
      drawFreehandStrokes();
      return;
    }

    if (
      hoveredNumericSliderNodeIdRef.current &&
      !currentGraph.nodes.some(
        (node) => node.id === hoveredNumericSliderNodeIdRef.current && node.type === NodeType.NUMERIC_INPUT
      )
    ) {
      hoveredNumericSliderNodeIdRef.current = null;
    }

    if (
      hoveredNodeResizeHandleRef.current &&
      (
        !currentGraph.nodes.some((node) => node.id === hoveredNodeResizeHandleRef.current?.nodeId) ||
        selectedNodeIdRef.current !== hoveredNodeResizeHandleRef.current?.nodeId
      )
    ) {
      hoveredNodeResizeHandleRef.current = null;
    }

    const currentNodeIds = new Set(currentGraph.nodes.map((node) => node.id));
    pruneNodeDraftMaps(currentNodeIds, nodeCardDraftSizesRef.current, nodeCardDraftPositionsRef.current);

    const activeNodeGraphicsTextureIds = new Set<string>();
    let selectedNodeGraphicsDebugNext: NodeGraphicsComputationDebug | null = null;
    const nextAnnotationOverlays: AnnotationOverlayEntry[] = [];
    const selectedNodeIdValue = selectedNodeIdRef.current;
    const activeNodeDragState = nodeDragStateRef.current;

    for (const node of currentGraph.nodes) {
      const dimensions = resolveNodeCardDimensions(node, nodeCardDraftSizesRef.current.get(node.id));
      const dragStateForNode =
        activeNodeDragState && activeNodeDragState.nodeId === node.id
          ? activeNodeDragState
          : null;
      const position = resolveNodeRenderTargetPosition(
        node,
        dragStateForNode,
        nodeCardDraftPositionsRef.current.get(node.id)
      );
      const nodeFrame = resolveNodeRenderFrame({
        node,
        dragState: dragStateForNode,
        draftPosition: position,
        targetWidth: dimensions.width,
        targetHeight: dimensions.height,
        minWidth: dimensions.minWidth,
        minHeight: dimensions.minHeight,
        fromTransitionState: activeProjectionTransition?.fromNodes.get(node.id) ?? null,
        toTransitionState: activeProjectionTransition?.toNodes.get(node.id) ?? null,
        transitionEasedProgress: projectionTransitionEasedProgress,
      });
      const width = nodeFrame.width;
      const height = nodeFrame.height;
      const renderedPosition = nodeFrame.position;
      const graphicsOutput = nodeGraphicsOutputsRef.current[node.id];
      const hasGraphicsOutput = Boolean(graphicsOutput);
      const shouldProjectGraphics = isRenderablePythonGraphicsOutput(node, graphicsOutput);
      const graphicsProjectionPlan = resolveGraphicsProjectionPlan({
        graphicsOutput,
        shouldProjectGraphics,
        nodePosition: renderedPosition,
        nodeWidth: width,
        nodeHeight: height,
        viewportScale,
        pixelRatio: PIXEL_RATIO,
        canEvaluateViewportGraphics,
        viewportWorldBounds,
        canReloadProjectedGraphics: !isProjectionTransitionActive,
        fallbackAspectRatio: NODE_GRAPHICS_FALLBACK_ASPECT_RATIO,
      });
      const projectedWidthOnScreen = graphicsProjectionPlan.projectedWidthOnScreen;
      const estimatedMaxPixels = graphicsProjectionPlan.estimatedMaxPixels;
      const stableMaxPixels = graphicsProjectionPlan.stableMaxPixels;
      const selectedLevel = graphicsProjectionPlan.selectedLevel;
      const selectedLevelPixels = graphicsProjectionPlan.selectedLevelPixels;
      const expectedProjectedGraphicsHeight = graphicsProjectionPlan.expectedProjectedGraphicsHeight;
      const shouldLoadProjectedGraphicsByViewport = graphicsProjectionPlan.shouldLoadProjectedGraphicsByViewport;
      const canReloadProjectedGraphics = graphicsProjectionPlan.canReloadProjectedGraphics;
      const shouldLoadProjectedGraphics = graphicsProjectionPlan.shouldLoadProjectedGraphics;
      if (node.type === NodeType.ANNOTATION) {
        const annotationConfig = normalizeAnnotationConfig(
          node.config.config as Record<string, unknown> | undefined
        );
        if (annotationConfig.text.length > 0) {
          nextAnnotationOverlays.push({
            nodeId: node.id,
            x: renderedPosition.x + ANNOTATION_TEXT_INSET_X,
            y: renderedPosition.y + ANNOTATION_TEXT_INSET_Y,
            width: Math.max(32, width - (ANNOTATION_TEXT_INSET_X * 2)),
            height: Math.max(24, height - ANNOTATION_TEXT_INSET_Y - ANNOTATION_TEXT_INSET_BOTTOM),
            text: annotationConfig.text,
            backgroundColor: annotationConfig.backgroundColor,
            fontColor: annotationConfig.fontColor,
            fontSize: annotationConfig.fontSize,
          });
        }
      }
      let requestUrl: string | null = null;
      const container = new Container();
      const isSelected = selectedNodeId === node.id;

      container.position.set(snapToPixel(renderedPosition.x), snapToPixel(renderedPosition.y));
      container.eventMode = 'static';
      container.cursor = 'pointer';
      // Keep the card body selectable even when fill alpha is 0 (fully transparent).
      const hitPadding = NODE_RESIZE_HANDLE_SIZE * 0.5;
      container.hitArea = new Rectangle(
        -hitPadding,
        -hitPadding,
        width + (hitPadding * 2),
        height + (hitPadding * 2)
      );

      let projectedGraphicsHeight = expectedProjectedGraphicsHeight;
      let projectedGraphicsTexture: Texture | null = null;
      if (shouldProjectGraphics && graphicsOutput) {
        if (shouldLoadProjectedGraphics) {
          const source = buildGraphicsImageUrl(
            graphicsOutput,
            stableMaxPixels ?? undefined
          );
          requestUrl = source;
          projectedGraphicsTexture = getNodeGraphicsTextureForNode(node.id, source);
          activeNodeGraphicsTextureIds.add(node.id);
        } else if (isProjectionTransitionActive) {
          const boundSource = nodeGraphicsTextureBindingsRef.current.get(node.id);
          if (boundSource) {
            const cachedTexture = graphicsTextureCacheRef.current.get(boundSource)?.texture;
            if (cachedTexture) {
              projectedGraphicsTexture = cachedTexture;
              activeNodeGraphicsTextureIds.add(node.id);
            }
          }
        }

        if (projectedGraphicsTexture) {
          const textureDimensions = getTextureDimensions(projectedGraphicsTexture);
          const resolvedTextureWidth = textureDimensions.width;
          const resolvedTextureHeight = textureDimensions.height;
          const resolvedTextureValid = textureDimensions.valid;
          projectedGraphicsHeight = resolvedTextureValid
            ? (width * resolvedTextureHeight) / resolvedTextureWidth
            : width * NODE_GRAPHICS_FALLBACK_ASPECT_RATIO;
        }
      }

      if (node.id === selectedNodeIdValue) {
        selectedNodeGraphicsDebugNext = {
          nodeId: node.id,
          nodeType: node.type,
          hasGraphicsOutput,
          isRenderableGraphics: shouldProjectGraphics,
          graphicsId: graphicsOutput?.id ?? null,
          mimeType: graphicsOutput?.mimeType ?? null,
          levelCount: graphicsOutput?.levels.length ?? 0,
          levelPixels: graphicsOutput?.levels.map((level) => level.pixelCount) ?? [],
          viewportScale,
          projectionWidth: shouldProjectGraphics ? width : null,
          projectedWidthOnScreen,
          devicePixelRatio: PIXEL_RATIO,
          estimatedMaxPixels,
          stableMaxPixels,
          selectedLevel,
          selectedLevelPixels,
          shouldLoadProjectedGraphicsByViewport,
          canReloadProjectedGraphics,
          shouldLoadProjectedGraphics,
          requestUrl,
        };
      }
      const hasProjectedGraphics = shouldProjectGraphics && (
        Boolean(projectedGraphicsTexture) ||
        (shouldLoadProjectedGraphics && Boolean(graphicsOutput))
      );
      const annotationConfig = node.type === NodeType.ANNOTATION
        ? normalizeAnnotationConfig(node.config.config as Record<string, unknown> | undefined)
        : null;
      const annotationBackground = annotationConfig
        ? colorStringToPixi(annotationConfig.backgroundColor, '#fef3c7')
        : null;
      const annotationBorder = annotationConfig
        ? colorStringToPixi(annotationConfig.borderColor, '#334155')
        : null;

      const frame = new Graphics();
      drawNodeCardFrame(
        frame,
        width,
        height,
        annotationBorder
          ? annotationBorder.color
          : isSelected
            ? 0x1d4ed8
            : 0x334155,
        annotationBackground
          ? annotationBackground.color
          : isSelected
            ? 0xe2e8f0
            : 0xf8fafc,
        hasProjectedGraphics,
        annotationBorder?.alpha ?? 1,
        annotationBackground?.alpha ?? 1,
        !annotationConfig
      );
      frame.eventMode = 'static';
      frame.hitArea = new Rectangle(0, 0, width, height);
      container.addChild(frame);

      const nodeExecutionState = nodeExecutionStatesRef.current[node.id];
      const autoRecomputeEnabled = Boolean(node.config.config?.autoRecompute);
      const statusLightColor = nodeExecutionState?.hasError
        ? 0xef4444
        : (nodeExecutionState?.isPending || nodeExecutionState?.isComputing)
          ? 0xf59e0b
          : nodeExecutionState?.isStale
            ? 0x8b5a2b
          : autoRecomputeEnabled
            ? 0x22c55e
            : 0x94a3b8;
      if (!annotationConfig) {
        const statusLight = new Graphics();
        statusLight.lineStyle(1, 0x0f172a, 0.25);
        statusLight.beginFill(statusLightColor, 1);
        statusLight.drawCircle(width - 13, 12, 5);
        statusLight.endFill();
        container.addChild(statusLight);
      }

      if (!annotationConfig) {
        const titleText = truncateTextToWidth(
          node.metadata.name,
          width - 34,
          (candidate) => candidate.length * NODE_TITLE_CHAR_WIDTH_ESTIMATE
        );
        const title = new Text(titleText, NODE_TITLE_TEXT_STYLE);
        title.resolution = PIXEL_RATIO;
        textNodesRef.current.add(title);
        title.position.set(12, 8);
        container.addChild(title);
      }

      if (node.type !== NodeType.NUMERIC_INPUT && node.type !== NodeType.ANNOTATION) {
        const subtitle = new Text(node.type.replace(/_/g, ' '), {
          fontFamily: 'Arial',
          fontSize: 11,
          fill: 0x475569,
        });
        subtitle.resolution = PIXEL_RATIO;
        textNodesRef.current.add(subtitle);
        subtitle.position.set(12, 22);
        container.addChild(subtitle);
      }

      const inputPortOffsets = new Map<string, number>();
      const outputPortOffsets = new Map<string, number>();
      const bodyHeight = Math.max(1, height - HEADER_HEIGHT - NODE_BODY_PADDING);
      const inputSlots = Math.max(node.metadata.inputs.length, 1);
      const outputSlots = Math.max(node.metadata.outputs.length, 1);
      const numericSliderY = height - NUMERIC_SLIDER_Y_OFFSET;
      const isNumericInputNode = node.type === NodeType.NUMERIC_INPUT;

      for (let i = 0; i < node.metadata.inputs.length; i += 1) {
        const port = node.metadata.inputs[i];
        const portKey = makePortKey(node.id, port.name);
        const y = HEADER_HEIGHT + ((i + 1) * bodyHeight) / (inputSlots + 1);
        inputPortOffsets.set(port.name, y);

        const marker = new Graphics();
        drawInputPortMarker(marker, false);
        marker.eventMode = 'static';
        marker.cursor = 'crosshair';
        marker.hitArea = new Circle(0, 0, PORT_RADIUS + 8);
        marker.position.set(0, y);
        marker.on('pointerover', (event: FederatedPointerEvent) => {
          if (drawingEnabledRef.current) {
            return;
          }
          event.stopPropagation();
          requestCanvasAnimationLoop();
          hoveredInputPortKeyRef.current = portKey;
          drawInputPortMarker(marker, true);
          const dragState = connectionDragStateRef.current;
          if (dragState) {
            dragState.hoveredInputKey = portKey;
            drawConnections();
          }
        });
        marker.on('pointerout', (event: FederatedPointerEvent) => {
          if (drawingEnabledRef.current) {
            return;
          }
          event.stopPropagation();
          requestCanvasAnimationLoop();
          if (hoveredInputPortKeyRef.current === portKey) {
            hoveredInputPortKeyRef.current = null;
          }
          drawInputPortMarker(marker, false);
          const dragState = connectionDragStateRef.current;
          if (dragState && dragState.hoveredInputKey === portKey) {
            dragState.hoveredInputKey = null;
            drawConnections();
          }
        });
        container.addChild(marker);
        inputPortMarkersRef.current.set(portKey, marker);
        inputPortPositionsRef.current.set(portKey, {
          x: renderedPosition.x,
          y: renderedPosition.y + y,
        });

        const label = new Text(port.name, {
          fontFamily: 'Arial',
          fontSize: 10,
          fill: 0x1e293b,
        });
        label.resolution = PIXEL_RATIO;
        textNodesRef.current.add(label);
        label.position.set(10, y - 7);
        container.addChild(label);
      }

      for (let i = 0; i < node.metadata.outputs.length; i += 1) {
        const port = node.metadata.outputs[i];
        const portKey = makePortKey(node.id, port.name);
        const y = isNumericInputNode
          ? numericSliderY
          : HEADER_HEIGHT + ((i + 1) * bodyHeight) / (outputSlots + 1);
        outputPortOffsets.set(port.name, y);

        const marker = new Graphics();
        drawOutputPortMarker(marker, false);
        marker.eventMode = 'static';
        marker.cursor = 'crosshair';
        marker.hitArea = new Circle(0, 0, PORT_RADIUS + 8);
        marker.position.set(width, y);
        marker.on('pointerover', (event: FederatedPointerEvent) => {
          if (drawingEnabledRef.current) {
            return;
          }
          event.stopPropagation();
          requestCanvasAnimationLoop();
          hoveredOutputPortKeyRef.current = portKey;
          drawOutputPortMarker(marker, true);
        });
        marker.on('pointerout', (event: FederatedPointerEvent) => {
          if (drawingEnabledRef.current) {
            return;
          }
          event.stopPropagation();
          requestCanvasAnimationLoop();
          if (hoveredOutputPortKeyRef.current === portKey) {
            hoveredOutputPortKeyRef.current = null;
          }
          if (connectionDragStateRef.current?.sourcePortKey !== portKey) {
            drawOutputPortMarker(marker, false);
          }
        });
        marker.on('pointerdown', (event: FederatedPointerEvent) => {
          if (drawingEnabledRef.current) {
            return;
          }
          if (event.button !== 0) return;
          event.stopPropagation();
          const canvas = appRef.current?.view as HTMLCanvasElement | undefined;
          canvas?.focus({ preventScroll: true });

          const sourcePosition = nodePositionsRef.current.get(node.id) ?? node.position;
          connectionDragStateRef.current = {
            sourceNodeId: node.id,
            sourcePort: port.name,
            sourcePortKey: portKey,
            startX: sourcePosition.x + width,
            startY: sourcePosition.y + y,
            pointerX: event.global.x,
            pointerY: event.global.y,
            hoveredInputKey: null,
          };
          drawOutputPortMarker(marker, true);
          selectedNodeIdRef.current = node.id;
          selectNode(node.id);
          drawConnections();
        });
        container.addChild(marker);
        outputPortMarkersRef.current.set(portKey, marker);
        outputPortPositionsRef.current.set(portKey, {
          x: renderedPosition.x + width,
          y: renderedPosition.y + y,
        });

        if (!isNumericInputNode) {
          const label = new Text(port.name, {
            fontFamily: 'Arial',
            fontSize: 10,
            fill: 0x1e293b,
          });
          label.resolution = PIXEL_RATIO;
          textNodesRef.current.add(label);
          label.anchor.set(1, 0);
          label.position.set(width - 10, y - 7);
          container.addChild(label);
        }
      }

      if (isNumericInputNode) {
        const activeNumericSliderDragState = numericSliderDragStateRef.current;
        const numericSliderDragStateForNode =
          activeNumericSliderDragState && activeNumericSliderDragState.nodeId === node.id
            ? activeNumericSliderDragState
            : null;
        const numericConfigBase = normalizeNumericInputConfig(
          node.config.config as Record<string, unknown> | undefined
        );
        const numericConfig = numericSliderDragStateForNode
          ? {
            ...numericConfigBase,
            // Preserve live drag value if the canvas re-renders before pointerup commits it.
            value: snapNumericInputValue(
              numericSliderDragStateForNode.currentValue,
              numericConfigBase.min,
              numericConfigBase.max,
              numericConfigBase.step
            ),
          }
          : numericConfigBase;
        const trackX = NUMERIC_SLIDER_LEFT_PADDING;
        const trackWidth = Math.max(
          40,
          width - NUMERIC_SLIDER_LEFT_PADDING - NUMERIC_SLIDER_RIGHT_PADDING
        );
        const trackY = numericSliderY;

        const track = new Graphics();
        track.eventMode = 'none';
        container.addChild(track);

        const knob = new Graphics();
        knob.eventMode = 'none';
        container.addChild(knob);

        const valueLabel = new Text(formatNumericInputValue(numericConfig.value, numericConfig.step), {
          fontFamily: 'Arial',
          fontSize: 11,
          fontWeight: 'bold',
          fill: 0x1e3a8a,
        });
        valueLabel.resolution = PIXEL_RATIO;
        textNodesRef.current.add(valueLabel);
        valueLabel.anchor.set(0, 0.5);
        valueLabel.position.set(trackX + trackWidth + 8, trackY);
        container.addChild(valueLabel);

        const sliderHitArea = new Graphics();
        sliderHitArea.beginFill(0x000000, 0.001);
        // Cover the full slider row to avoid parent-card cursor precedence at slider edges.
        sliderHitArea.drawRoundedRect(
          0,
          trackY - 14,
          width,
          28,
          10
        );
        sliderHitArea.endFill();
        sliderHitArea.eventMode = 'static';
        sliderHitArea.cursor = 'ew-resize';
        sliderHitArea.on('pointerover', (event: FederatedPointerEvent) => {
          if (drawingEnabledRef.current) {
            return;
          }
          event.stopPropagation();
          hoveredNumericSliderNodeIdRef.current = node.id;
          applyCanvasCursor();
        });
        sliderHitArea.on('pointermove', (event: FederatedPointerEvent) => {
          if (drawingEnabledRef.current) {
            return;
          }
          event.stopPropagation();
          if (numericSliderDragStateRef.current?.nodeId === node.id) {
            requestCanvasAnimationLoop();
            updateNumericSliderFromPointer(node.id, event.global.x, event.global.y);
          }
          hoveredNumericSliderNodeIdRef.current = node.id;
          applyCanvasCursor();
        });
        sliderHitArea.on('pointerout', (event: FederatedPointerEvent) => {
          if (drawingEnabledRef.current) {
            return;
          }
          event.stopPropagation();
          if (numericSliderDragStateRef.current?.nodeId === node.id) {
            return;
          }
          if (hoveredNumericSliderNodeIdRef.current === node.id) {
            hoveredNumericSliderNodeIdRef.current = null;
          }
          applyCanvasCursor();
        });

        const slider: NumericSliderVisual = {
          nodeId: node.id,
          nodeContainer: container,
          track,
          knob,
          valueLabel,
          trackX,
          trackY,
          trackWidth,
          min: numericConfig.min,
          max: numericConfig.max,
          step: numericConfig.step,
          value: numericConfig.value,
        };
        drawNumericSliderVisual(slider);
        numericSliderVisualsRef.current.set(node.id, slider);

        sliderHitArea.on('pointerdown', (event: FederatedPointerEvent) => {
          if (drawingEnabledRef.current) {
            return;
          }
          if (event.button !== 0) {
            return;
          }
          event.stopPropagation();
          const canvas = appRef.current?.view as HTMLCanvasElement | undefined;
          canvas?.focus({ preventScroll: true });

          requestCanvasAnimationLoop();
          selectedConnectionIdRef.current = null;
          selectedNodeIdRef.current = node.id;
          selectNode(node.id);

          numericSliderDragStateRef.current = {
            nodeId: node.id,
            initialValue: slider.value,
            currentValue: slider.value,
          };
          hoveredNumericSliderNodeIdRef.current = node.id;
          applyCanvasCursor();
          updateNumericSliderFromPointer(node.id, event.global.x, event.global.y);
        });
        container.addChild(sliderHitArea);
      }

      if (isSelected) {
        const currentPosition = nodePositionsRef.current.get(node.id) ?? node.position;
        const handleSize = NODE_RESIZE_HANDLE_SIZE;
        const createResizeHandle = (
          handleX: number,
          handleY: number,
          handleDirection: ResizeHandleDirection
        ) => {
          const resizeHandle = new Graphics();
          resizeHandle.lineStyle(1, 0x1e3a8a, 0.7);
          resizeHandle.beginFill(0x1d4ed8, 0.9);
          resizeHandle.drawRoundedRect(handleX, handleY, handleSize, handleSize, 2);
          resizeHandle.endFill();
          resizeHandle.eventMode = 'static';
          resizeHandle.cursor = resolveResizeCursor(handleDirection);
          resizeHandle.on('pointerover', (event: FederatedPointerEvent) => {
            if (drawingEnabledRef.current) {
              return;
            }
            event.stopPropagation();
            hoveredNodeResizeHandleRef.current = { nodeId: node.id, handle: handleDirection };
            applyCanvasCursor();
          });
          resizeHandle.on('pointerout', (event: FederatedPointerEvent) => {
            if (drawingEnabledRef.current) {
              return;
            }
            event.stopPropagation();
            if (
              nodeResizeStateRef.current?.nodeId === node.id &&
              nodeResizeStateRef.current.handle === handleDirection
            ) {
              return;
            }
            if (
              hoveredNodeResizeHandleRef.current?.nodeId === node.id &&
              hoveredNodeResizeHandleRef.current.handle === handleDirection
            ) {
              hoveredNodeResizeHandleRef.current = null;
            }
            applyCanvasCursor();
          });
          resizeHandle.on('pointerdown', (event: FederatedPointerEvent) => {
            if (drawingEnabledRef.current) {
              return;
            }
            if (event.button !== 0) return;
            event.stopPropagation();
            const canvas = appRef.current?.view as HTMLCanvasElement | undefined;
            canvas?.focus({ preventScroll: true });

            selectedConnectionIdRef.current = null;
            selectedNodeIdRef.current = node.id;
            selectNode(node.id);
            nodeResizeStateRef.current = {
              nodeId: node.id,
              pointerX: event.global.x,
              pointerY: event.global.y,
              x: currentPosition.x,
              y: currentPosition.y,
              width,
              height,
              handle: handleDirection,
              minWidth: dimensions.minWidth,
              minHeight: dimensions.minHeight,
              currentX: currentPosition.x,
              currentY: currentPosition.y,
              currentWidth: width,
              currentHeight: height,
            };
            nodeCardDraftSizesRef.current.set(node.id, { width, height });
            nodeCardDraftPositionsRef.current.set(node.id, { x: currentPosition.x, y: currentPosition.y });
            hoveredNodeResizeHandleRef.current = { nodeId: node.id, handle: handleDirection };
            requestCanvasAnimationLoop();
            applyCanvasCursor();
          });
          resizeHandle.on('pointertap', (event: FederatedPointerEvent) => {
            event.stopPropagation();
          });
          container.addChild(resizeHandle);
        };

        if (node.type === NodeType.ANNOTATION) {
          const edgeOffset = handleSize * 0.5;
          createResizeHandle(-edgeOffset, -edgeOffset, 'nw');
          createResizeHandle((width * 0.5) - edgeOffset, -edgeOffset, 'n');
          createResizeHandle(width - edgeOffset, -edgeOffset, 'ne');
          createResizeHandle(width - edgeOffset, (height * 0.5) - edgeOffset, 'e');
          createResizeHandle(width - edgeOffset, height - edgeOffset, 'se');
          createResizeHandle((width * 0.5) - edgeOffset, height - edgeOffset, 's');
          createResizeHandle(-edgeOffset, height - edgeOffset, 'sw');
          createResizeHandle(-edgeOffset, (height * 0.5) - edgeOffset, 'w');
        } else {
          const handleX = width - handleSize - NODE_RESIZE_HANDLE_MARGIN;
          const handleY = height - handleSize - NODE_RESIZE_HANDLE_MARGIN;
          createResizeHandle(handleX, handleY, 'se');
        }
      }

      if (projectedGraphicsTexture) {
        const textureDimensions = getTextureDimensions(projectedGraphicsTexture);
        const resolvedTextureWidth = textureDimensions.width;
        const resolvedTextureValid = textureDimensions.valid;
        if (resolvedTextureValid) {
          const imageSprite = new Sprite(projectedGraphicsTexture);
          imageSprite.eventMode = 'none';
          const scale = width / resolvedTextureWidth;
          imageSprite.scale.set(scale);
          imageSprite.position.set(0, height);
          container.addChild(imageSprite);
        }
      }

      container.on('pointerdown', (event: FederatedPointerEvent) => {
        if (drawingEnabledRef.current) {
          return;
        }
        if (event.button !== 0) return;
        event.stopPropagation();
        const canvas = appRef.current?.view as HTMLCanvasElement | undefined;
        canvas?.focus({ preventScroll: true });

        const currentPosition = nodePositionsRef.current.get(node.id) ?? {
          x: node.position.x,
          y: node.position.y,
        };

        nodeDragStateRef.current = {
          nodeId: node.id,
          pointerX: event.global.x,
          pointerY: event.global.y,
          nodeX: currentPosition.x,
          nodeY: currentPosition.y,
          currentX: currentPosition.x,
          currentY: currentPosition.y,
          moved: false,
        };
        selectedConnectionIdRef.current = null;
        selectedNodeIdRef.current = node.id;
        selectNode(node.id);
      });

      container.on('pointertap', (event: FederatedPointerEvent) => {
        if (drawingEnabledRef.current) {
          return;
        }
        const dragState = nodeDragStateRef.current;
        if (dragState?.nodeId === node.id && dragState.moved) {
          event.stopPropagation();
          return;
        }
        event.stopPropagation();
        selectedConnectionIdRef.current = null;
        selectedNodeIdRef.current = node.id;
        selectNode(node.id);
      });

      nodesLayer.addChild(container);
      nodePositionsRef.current.set(node.id, position);
      nodeVisualsRef.current.set(node.id, {
        node,
        container,
        width,
        height,
        projectedGraphicsHeight,
        inputPortOffsets,
        outputPortOffsets,
      });
      syncNodePortPositions(node.id, position, {
        node,
        container,
        width,
        height,
        projectedGraphicsHeight,
        inputPortOffsets,
        outputPortOffsets,
      });
    }

    if (!isProjectionTransitionActive) {
      releaseUnusedNodeGraphicsTextures(activeNodeGraphicsTextureIds);
    }

    for (const drawing of currentGraph.drawings ?? []) {
      const position = { ...drawing.position };
      const container = new Container();
      const isSelected = selectedDrawingId === drawing.id;
      const width = Math.max(96, Math.min(220, drawing.name.length * 7 + 30));
      const height = 24;

      container.position.set(snapToPixel(position.x), snapToPixel(position.y));
      container.eventMode = 'static';
      container.cursor = 'move';

      const frame = new Graphics();
      frame.lineStyle(2, isSelected ? 0x0ea5e9 : 0x334155, 1);
      frame.beginFill(isSelected ? 0xdbeafe : 0xe2e8f0, 0.95);
      frame.drawRoundedRect(0, 0, width, height, 8);
      frame.endFill();
      container.addChild(frame);

      const title = new Text(drawing.name, {
        fontFamily: 'Arial',
        fontSize: 11,
        fontWeight: 'bold',
        fill: 0x0f172a,
      });
      title.resolution = PIXEL_RATIO;
      textNodesRef.current.add(title);
      title.position.set(10, 5);
      container.addChild(title);

      container.on('pointerdown', (event: FederatedPointerEvent) => {
        if (event.button !== 0) return;
        event.stopPropagation();
        const canvas = appRef.current?.view as HTMLCanvasElement | undefined;
        canvas?.focus({ preventScroll: true });

        const currentPosition = drawingPositionsRef.current.get(drawing.id) ?? drawing.position;
        drawingDragStateRef.current = {
          drawingId: drawing.id,
          pointerX: event.global.x,
          pointerY: event.global.y,
          drawingX: currentPosition.x,
          drawingY: currentPosition.y,
          currentX: currentPosition.x,
          currentY: currentPosition.y,
          moved: false,
        };
        selectedConnectionIdRef.current = null;
        selectedNodeIdRef.current = null;
        selectedDrawingIdRef.current = drawing.id;
        selectDrawing(drawing.id);
      });

      container.on('pointertap', (event: FederatedPointerEvent) => {
        const dragState = drawingDragStateRef.current;
        if (dragState?.drawingId === drawing.id && dragState.moved) {
          event.stopPropagation();
          return;
        }
        event.stopPropagation();
        selectedConnectionIdRef.current = null;
        selectedNodeIdRef.current = null;
        selectedDrawingIdRef.current = drawing.id;
        selectDrawing(drawing.id);
      });

      drawingHandleLayer.addChild(container);
      drawingPositionsRef.current.set(drawing.id, position);
      drawingVisualsRef.current.set(drawing.id, {
        drawing,
        container,
        width,
        height,
      });
    }

    if (!areAnnotationOverlaysEqual(annotationOverlaysRef.current, nextAnnotationOverlays)) {
      annotationOverlaysRef.current = nextAnnotationOverlays;
      setAnnotationOverlays(nextAnnotationOverlays);
    }

    drawConnections();
    drawFreehandStrokes();

    if (!viewportInitializedRef.current) {
      fitViewportToGraph();
      viewportInitializedRef.current = true;
    }
    const viewport = viewportRef.current;
    if (viewport) {
      updateTextResolutionForScale(viewport.scale.x);
    }
    drawMinimap();
    if (!areNodeGraphicsDebugValuesEqual(selectedNodeGraphicsDebugRef.current, selectedNodeGraphicsDebugNext)) {
      selectedNodeGraphicsDebugRef.current = selectedNodeGraphicsDebugNext;
      setSelectedNodeGraphicsDebug(selectedNodeGraphicsDebugNext);
    }
    if (isProjectionTransitionActive) {
      requestViewportDrivenGraphRefresh();
    }
  }, [
    applyCanvasCursor,
    clearAllNodeGraphicsTextures,
    drawConnections,
    drawFreehandStrokes,
    drawMinimap,
    fitViewportToGraph,
    getNodeGraphicsTextureForNode,
    releaseUnusedNodeGraphicsTextures,
    refreshCanvasBackgroundTexture,
    requestCanvasAnimationLoop,
    requestViewportDrivenGraphRefresh,
    setSelectedNodeGraphicsDebug,
    selectDrawing,
    selectNode,
    selectedDrawingId,
    selectedNodeId,
    syncAnnotationOverlayTransform,
    syncNodePortPositions,
    updateNumericSliderFromPointer,
    updateTextResolutionForScale,
  ]);

  useCanvasGraphEffects({
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
  });

  usePixiCanvasLifecycle({
    canvasHostRef,
    appRef,
    viewportRef,
    edgeLayerRef,
    nodeLayerRef,
    drawingHandleLayerRef,
    drawLayerRef,
    effectsLayerRef,
    backgroundSpriteRef,
    viewportRefreshRafRef,
    selectedNodeGraphicsDebugRef,
    setCanvasReady,
    setSelectedNodeGraphicsDebug,
    applyCanvasCursor,
    refreshCanvasBackgroundTexture,
    handleStagePointerDown,
    handleStagePointerMove,
    handleStagePointerUp,
    handleWheel,
    handleResize,
    handleKeyDown,
    finishInteraction,
    drawEffects,
    clearAllNodeGraphicsTextures,
    renderGraphRef,
    appliedCanvasBackgroundSignatureRef,
  });

  useCanvasExecutionEffects({
    nodeExecutionStates,
    nodeGraphicsOutputs,
    previousNodeExecutionStatesRef,
    renderGraphRef,
    enqueueLightningForNodeInputs,
    enqueueNodeShock,
  });

  const overlay = (isLoading && !graph) || !graph
    ? <CanvasStatusOverlay graphExists={Boolean(graph)} isLoading={isLoading} error={error} createGraph={createGraph} />
    : null;

  return (
    <CanvasChrome
      canvasHostRef={canvasHostRef}
      minimapCanvasRef={minimapCanvasRef}
      annotationOverlays={annotationOverlays}
      annotationOverlayViewportRef={annotationOverlayViewportRef}
      handleMinimapPointerDown={handleMinimapPointerDown}
      overlay={overlay}
      minimapWidth={MINIMAP_WIDTH}
      minimapHeight={MINIMAP_HEIGHT}
    />
  );
}

export default Canvas;
