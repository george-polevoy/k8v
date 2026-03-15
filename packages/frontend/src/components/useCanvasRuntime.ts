import { useCallback, type MutableRefObject } from 'react';
import { Application, Container, Graphics, Point, Sprite, Texture } from 'pixi.js';
import { v4 as uuidv4 } from 'uuid';
import type { NodeExecutionState } from '../store/graphStore';
import type {
  CanvasBackgroundSettings,
  Connection,
  ConnectionAnchorSide,
  DrawingPath,
  Graph,
  Position,
} from '../types';
import { NodeType } from '../types';
import {
  ANNOTATION_CONNECTION_PORT,
  areConnectionAnchorsEqual,
  buildGraphNodeMap,
  isAnnotationConnection,
  isAnnotationNode,
  resolveConnectionAnchorPoint,
} from '../utils/annotationConnections';
import { hasErroredNodeExecutionState, shouldKeepCanvasAnimationLoopRunning } from '../utils/canvasAnimation';
import { normalizeCanvasBackground, resolveGraphCanvasBackground } from '../utils/canvasBackground';
import { makePortKey, parsePortKey } from '../utils/canvasHelpers';
import {
  clearAllNodeGraphicsTextures as clearAllNodeGraphicsTexturesInCache,
  getNodeGraphicsTextureForNode as getNodeGraphicsTextureForNodeInCache,
  releaseUnusedNodeGraphicsTextures as releaseUnusedNodeGraphicsTexturesInCache,
  type GraphicsTextureCacheEntry,
  type TextureCacheState,
} from '../utils/canvasTextureCache';
import {
  enqueueLightningPulse as enqueueLightningPulseEffect,
  enqueueNodeShock as enqueueNodeShockEffect,
  runCanvasEffectsPass,
  type ConnectionGeometry,
  type LightningPulse,
  type NodeShock,
  type SmokePuff,
} from '../utils/canvasEffects';
import { DEFAULT_GRAPH_CONNECTION_STROKE, resolveGraphConnectionStroke } from '../utils/connectionStroke';
import { resolveConnectionArrowHeadLayout } from '../utils/connectionArrows';
import { hexColorToNumber } from '../utils/color';
import { normalizeNumericInputConfig, snapNumericInputValue } from '../utils/numericInput';
import type {
  ActiveDrawingPath,
  ConnectionDragState,
  DrawingDragState,
  HoveredResizeHandle,
  HoveredSelectionResizeHandle,
  NodeDragState,
  NodeResizeState,
  NodeVisual,
  NumericSliderDragState,
  NumericSliderVisual,
  PanState,
  SelectionDragState,
  SelectionMarqueeState,
  SelectionResizeState,
} from './canvasShared';
import {
  createCanvasBackgroundTexture,
  createsCycle,
  distanceSquaredToBezier,
  drawBezierConnection,
  drawConnectionArrowHead,
  drawInputPortMarker,
  drawNumericSliderVisual,
  drawOutputPortMarker,
  getBezierGeometry,
  getCanvasBackgroundSignature,
  resolveNumericSliderValue,
  resolvePencilColor,
  resolveResizeCursor,
} from './canvasShared';

interface UseCanvasRuntimeParams {
  appRef: MutableRefObject<Application | null>;
  viewportRef: MutableRefObject<Container | null>;
  graphRef: MutableRefObject<Graph | null>;
  backgroundSpriteRef: MutableRefObject<Sprite | null>;
  appliedCanvasBackgroundSignatureRef: MutableRefObject<string>;
  lastResolvedCanvasBackgroundRef: MutableRefObject<CanvasBackgroundSettings>;
  nodeResizeStateRef: MutableRefObject<NodeResizeState | null>;
  hoveredNodeResizeHandleRef: MutableRefObject<HoveredResizeHandle | null>;
  selectionResizeStateRef: MutableRefObject<SelectionResizeState | null>;
  hoveredSelectionResizeHandleRef: MutableRefObject<HoveredSelectionResizeHandle | null>;
  drawingEnabledRef: MutableRefObject<boolean>;
  numericSliderDragStateRef: MutableRefObject<NumericSliderDragState | null>;
  hoveredNumericSliderNodeIdRef: MutableRefObject<string | null>;
  selectionMarqueeStateRef: MutableRefObject<SelectionMarqueeState | null>;
  selectionDragStateRef: MutableRefObject<SelectionDragState | null>;
  panStateRef: MutableRefObject<PanState | null>;
  spacePressedRef: MutableRefObject<boolean>;
  connectionDragStateRef: MutableRefObject<ConnectionDragState | null>;
  nodeDragStateRef: MutableRefObject<NodeDragState | null>;
  drawingDragStateRef: MutableRefObject<DrawingDragState | null>;
  activeDrawingPathRef: MutableRefObject<ActiveDrawingPath | null>;
  nodeExecutionStatesRef: MutableRefObject<Record<string, NodeExecutionState>>;
  lightningPulsesRef: MutableRefObject<LightningPulse[]>;
  nodeShocksRef: MutableRefObject<NodeShock[]>;
  smokePuffsRef: MutableRefObject<SmokePuff[]>;
  inputPortMarkersRef: MutableRefObject<Map<string, Graphics>>;
  outputPortMarkersRef: MutableRefObject<Map<string, Graphics>>;
  inputPortPositionsRef: MutableRefObject<Map<string, Position>>;
  outputPortPositionsRef: MutableRefObject<Map<string, Position>>;
  connectionGeometriesRef: MutableRefObject<Map<string, ConnectionGeometry>>;
  edgeLayerRef: MutableRefObject<Graphics | null>;
  drawLayerRef: MutableRefObject<Graphics | null>;
  effectsLayerRef: MutableRefObject<Graphics | null>;
  nodeVisualsRef: MutableRefObject<Map<string, NodeVisual>>;
  nodePositionsRef: MutableRefObject<Map<string, Position>>;
  drawingPositionsRef: MutableRefObject<Map<string, Position>>;
  numericSliderVisualsRef: MutableRefObject<Map<string, NumericSliderVisual>>;
  selectedConnectionIdRef: MutableRefObject<string | null>;
  hoveredInputPortKeyRef: MutableRefObject<string | null>;
  hoveredOutputPortKeyRef: MutableRefObject<string | null>;
  graphicsTextureCacheRef: MutableRefObject<Map<string, GraphicsTextureCacheEntry>>;
  pendingGraphicsTextureLoadsRef: MutableRefObject<Map<string, Texture>>;
  nodeGraphicsTextureBindingsRef: MutableRefObject<Map<string, string>>;
  nodePendingGraphicsTextureBindingsRef: MutableRefObject<Map<string, string>>;
  lastSmokeEmitAtRef: MutableRefObject<Map<string, number>>;
  onEffectFrame: () => void;
  requestCanvasAnimationLoop: () => void;
  requestNodeGraphicsTextureRefresh: () => void;
  updateNode: (nodeId: string, updates: Record<string, unknown>) => void;
  addConnection: (connection: Connection) => void;
  config: {
    edgeHitWidth: number;
    connectionWireScreenWidth: number;
    connectionWireForegroundAlpha: number;
    connectionWireBackgroundAlpha: number;
    connectionWireSelectedForegroundAlpha: number;
    connectionWireSelectedBackgroundAlpha: number;
    lightningDurationMs: number;
    nodeShockDurationMs: number;
    smokeEmitIntervalMs: number;
    smokeMinDurationMs: number;
    smokeMaxDurationMs: number;
    smokeMaxParticles: number;
  };
}

function blendPixiColors(baseColor: number, targetColor: number, amount: number): number {
  const clampedAmount = Math.max(0, Math.min(1, amount));
  const baseR = (baseColor >> 16) & 0xff;
  const baseG = (baseColor >> 8) & 0xff;
  const baseB = baseColor & 0xff;
  const targetR = (targetColor >> 16) & 0xff;
  const targetG = (targetColor >> 8) & 0xff;
  const targetB = targetColor & 0xff;
  const blendedR = Math.round(baseR + ((targetR - baseR) * clampedAmount));
  const blendedG = Math.round(baseG + ((targetG - baseG) * clampedAmount));
  const blendedB = Math.round(baseB + ((targetB - baseB) * clampedAmount));
  return (blendedR << 16) | (blendedG << 8) | blendedB;
}

function resolveConnectionSide(
  anchorSide: ConnectionAnchorSide | undefined,
  fallback: ConnectionAnchorSide
): ConnectionAnchorSide {
  return anchorSide ?? fallback;
}

function resolveFreePointerEndSide(
  startX: number,
  startY: number,
  endX: number,
  endY: number
): ConnectionAnchorSide {
  const deltaX = endX - startX;
  const deltaY = endY - startY;
  if (Math.abs(deltaX) >= Math.abs(deltaY)) {
    return deltaX >= 0 ? 'left' : 'right';
  }
  return deltaY >= 0 ? 'top' : 'bottom';
}

export function useCanvasRuntime(params: UseCanvasRuntimeParams) {
  const {
    appRef,
    viewportRef,
    graphRef,
    backgroundSpriteRef,
    appliedCanvasBackgroundSignatureRef,
    lastResolvedCanvasBackgroundRef,
    nodeResizeStateRef,
    hoveredNodeResizeHandleRef,
    selectionResizeStateRef,
    hoveredSelectionResizeHandleRef,
    drawingEnabledRef,
    numericSliderDragStateRef,
    hoveredNumericSliderNodeIdRef,
    selectionMarqueeStateRef,
    selectionDragStateRef,
    panStateRef,
    spacePressedRef,
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
    onEffectFrame,
    requestCanvasAnimationLoop,
    requestNodeGraphicsTextureRefresh,
    updateNode,
    addConnection,
    config,
  } = params;

  const refreshCanvasBackgroundTexture = useCallback((backgroundOverride?: CanvasBackgroundSettings) => {
    const app = appRef.current;
    const backgroundSprite = backgroundSpriteRef.current;
    if (!app || !backgroundSprite) {
      return;
    }

    const resolvedBackground = normalizeCanvasBackground(
      backgroundOverride ?? resolveGraphCanvasBackground(graphRef.current)
    );
    const signature = getCanvasBackgroundSignature(
      resolvedBackground,
      app.screen.width,
      app.screen.height
    );
    if (signature === appliedCanvasBackgroundSignatureRef.current) {
      return;
    }

    const previousTexture = backgroundSprite.texture;
    backgroundSprite.texture = createCanvasBackgroundTexture(
      app.screen.width,
      app.screen.height,
      resolvedBackground
    );
    backgroundSprite.width = app.screen.width;
    backgroundSprite.height = app.screen.height;
    appliedCanvasBackgroundSignatureRef.current = signature;
    lastResolvedCanvasBackgroundRef.current = resolvedBackground;

    if (previousTexture !== Texture.WHITE && previousTexture !== backgroundSprite.texture) {
      previousTexture.destroy(true);
    }
  }, [appRef, appliedCanvasBackgroundSignatureRef, backgroundSpriteRef, graphRef, lastResolvedCanvasBackgroundRef]);

  const applyCanvasCursor = useCallback(() => {
    const app = appRef.current;
    if (!app) {
      return;
    }

    const canvas = app.view as HTMLCanvasElement;
    if (drawingEnabledRef.current) {
      canvas.style.cursor = 'crosshair';
      return;
    }
    if (selectionResizeStateRef.current || hoveredSelectionResizeHandleRef.current) {
      const resizeHandle =
        selectionResizeStateRef.current?.handle ??
        hoveredSelectionResizeHandleRef.current?.handle ??
        'se';
      canvas.style.cursor = resolveResizeCursor(resizeHandle);
      return;
    }
    if (nodeResizeStateRef.current || hoveredNodeResizeHandleRef.current) {
      const resizeHandle =
        nodeResizeStateRef.current?.handle ??
        hoveredNodeResizeHandleRef.current?.handle ??
        'se';
      canvas.style.cursor = resolveResizeCursor(resizeHandle);
      return;
    }
    if (numericSliderDragStateRef.current || hoveredNumericSliderNodeIdRef.current) {
      canvas.style.cursor = 'ew-resize';
      return;
    }
    if (panStateRef.current) {
      canvas.style.cursor = 'grabbing';
      return;
    }
    if (selectionMarqueeStateRef.current) {
      canvas.style.cursor = 'crosshair';
      return;
    }
    if (selectionDragStateRef.current) {
      canvas.style.cursor = 'grabbing';
      return;
    }
    canvas.style.cursor = spacePressedRef.current ? 'grab' : 'default';
  }, [
    appRef,
    drawingEnabledRef,
    hoveredNodeResizeHandleRef,
    hoveredSelectionResizeHandleRef,
    hoveredNumericSliderNodeIdRef,
    nodeResizeStateRef,
    numericSliderDragStateRef,
    panStateRef,
    selectionDragStateRef,
    selectionMarqueeStateRef,
    selectionResizeStateRef,
    spacePressedRef,
  ]);

  const shouldKeepCanvasAnimationLoop = useCallback(() => {
    return shouldKeepCanvasAnimationLoopRunning({
      hasActiveInteraction: Boolean(
        connectionDragStateRef.current ||
        nodeDragStateRef.current ||
        nodeResizeStateRef.current ||
        selectionDragStateRef.current ||
        selectionMarqueeStateRef.current ||
        selectionResizeStateRef.current ||
        numericSliderDragStateRef.current ||
        drawingDragStateRef.current ||
        panStateRef.current ||
        activeDrawingPathRef.current
      ),
      hasErroredNodes: hasErroredNodeExecutionState(nodeExecutionStatesRef.current),
      lightningPulseCount: lightningPulsesRef.current.length,
      nodeShockCount: nodeShocksRef.current.length,
      smokePuffCount: smokePuffsRef.current.length,
    });
  }, [
    activeDrawingPathRef,
    connectionDragStateRef,
    drawingDragStateRef,
    lightningPulsesRef,
    nodeDragStateRef,
    nodeExecutionStatesRef,
    nodeResizeStateRef,
    nodeShocksRef,
    numericSliderDragStateRef,
    panStateRef,
    selectionDragStateRef,
    selectionMarqueeStateRef,
    selectionResizeStateRef,
    smokePuffsRef,
  ]);

  const pauseCanvasAnimationLoopIfIdle = useCallback(() => {
    const app = appRef.current;
    if (!app || !app.ticker.started) {
      return;
    }
    if (shouldKeepCanvasAnimationLoop()) {
      return;
    }
    app.stop();
  }, [appRef, shouldKeepCanvasAnimationLoop]);

  const setInputPortHighlight = useCallback((portKey: string, highlighted: boolean) => {
    const marker = inputPortMarkersRef.current.get(portKey);
    if (marker) {
      drawInputPortMarker(marker, highlighted);
      requestCanvasAnimationLoop();
    }
  }, [inputPortMarkersRef, requestCanvasAnimationLoop]);

  const setOutputPortHighlight = useCallback((portKey: string, highlighted: boolean) => {
    const marker = outputPortMarkersRef.current.get(portKey);
    if (marker) {
      drawOutputPortMarker(marker, highlighted);
      requestCanvasAnimationLoop();
    }
  }, [outputPortMarkersRef, requestCanvasAnimationLoop]);

  const syncNodePortPositions = useCallback((nodeId: string, position: Position, visual: NodeVisual) => {
    for (const [portName, offsetY] of visual.inputPortOffsets.entries()) {
      inputPortPositionsRef.current.set(makePortKey(nodeId, portName), {
        x: position.x,
        y: position.y + offsetY,
      });
    }

    for (const [portName, offsetY] of visual.outputPortOffsets.entries()) {
      outputPortPositionsRef.current.set(makePortKey(nodeId, portName), {
        x: position.x + visual.width,
        y: position.y + offsetY,
      });
    }
  }, [inputPortPositionsRef, outputPortPositionsRef]);

  const getTextureCacheState = useCallback((): TextureCacheState => ({
    graphicsTextureCache: graphicsTextureCacheRef.current,
    pendingGraphicsTextureLoads: pendingGraphicsTextureLoadsRef.current,
    nodeGraphicsTextureBindings: nodeGraphicsTextureBindingsRef.current,
    nodePendingGraphicsTextureBindings: nodePendingGraphicsTextureBindingsRef.current,
  }), [
    graphicsTextureCacheRef,
    nodeGraphicsTextureBindingsRef,
    nodePendingGraphicsTextureBindingsRef,
    pendingGraphicsTextureLoadsRef,
  ]);

  const getNodeGraphicsTextureForNode = useCallback((nodeId: string, source: string): Texture => {
    return getNodeGraphicsTextureForNodeInCache(
      getTextureCacheState(),
      nodeId,
      source,
      requestNodeGraphicsTextureRefresh
    );
  }, [getTextureCacheState, requestNodeGraphicsTextureRefresh]);

  const releaseUnusedNodeGraphicsTextures = useCallback((activeNodeIds: Set<string>) => {
    releaseUnusedNodeGraphicsTexturesInCache(getTextureCacheState(), activeNodeIds);
  }, [getTextureCacheState]);

  const clearAllNodeGraphicsTextures = useCallback(() => {
    clearAllNodeGraphicsTexturesInCache(getTextureCacheState());
  }, [getTextureCacheState]);

  const pickConnectionAtClientPoint = useCallback((clientX: number, clientY: number): string | null => {
    const viewport = viewportRef.current;
    const app = appRef.current;
    if (!viewport || !app) {
      return null;
    }

    const canvasRect = (app.view as HTMLCanvasElement).getBoundingClientRect();
    const localX = clientX - canvasRect.left;
    const localY = clientY - canvasRect.top;
    const worldPoint = viewport.toLocal(new Point(localX, localY));
    const scale = Math.max(viewport.scale.x, 0.1);
    const connectionStroke = resolveGraphConnectionStroke(graphRef.current);
    const hitWidth = Math.max(config.edgeHitWidth, connectionStroke.backgroundWidth * 6);
    const maxDistanceWorld = hitWidth / scale;
    const maxDistanceSquared = maxDistanceWorld * maxDistanceWorld;

    let pickedId: string | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const [connectionId, geometry] of connectionGeometriesRef.current.entries()) {
      const distanceSquared = distanceSquaredToBezier(worldPoint.x, worldPoint.y, geometry);
      if (distanceSquared <= maxDistanceSquared && distanceSquared < bestDistance) {
        bestDistance = distanceSquared;
        pickedId = connectionId;
      }
    }

    return pickedId;
  }, [appRef, config.edgeHitWidth, connectionGeometriesRef, graphRef, viewportRef]);

  const drawConnections = useCallback(() => {
    const edges = edgeLayerRef.current;
    const currentGraph = graphRef.current;

    if (!edges) {
      return;
    }

    requestCanvasAnimationLoop();
    edges.clear();
    connectionGeometriesRef.current.clear();
    if (!currentGraph) {
      return;
    }

    const viewportScale = Math.max(viewportRef.current?.scale.x ?? 1, 0.1);
    const connectionStroke = resolveGraphConnectionStroke(currentGraph);
    const foregroundLineWidth = Math.max(
      connectionStroke.foregroundWidth / viewportScale,
      config.connectionWireScreenWidth / viewportScale
    );
    const backgroundLineWidth = Math.max(
      connectionStroke.backgroundWidth / viewportScale,
      foregroundLineWidth * 2
    );
    const foregroundColor = hexColorToNumber(
      connectionStroke.foregroundColor,
      DEFAULT_GRAPH_CONNECTION_STROKE.foregroundColor
    );
    const backgroundColor = hexColorToNumber(
      connectionStroke.backgroundColor,
      DEFAULT_GRAPH_CONNECTION_STROKE.backgroundColor
    );
    const selectedForegroundColor = blendPixiColors(foregroundColor, 0x2563eb, 0.55);
    const selectedBackgroundColor = blendPixiColors(backgroundColor, 0x93c5fd, 0.45);
    const nodeById = buildGraphNodeMap(currentGraph.nodes);
    const arrowHeadLayout = resolveConnectionArrowHeadLayout({
      foregroundLineWidth,
      backgroundLineWidth,
      viewportScale,
    });

    for (const connection of currentGraph.connections) {
      const sourceVisual = nodeVisualsRef.current.get(connection.sourceNodeId);
      const targetVisual = nodeVisualsRef.current.get(connection.targetNodeId);
      const sourcePosition = nodePositionsRef.current.get(connection.sourceNodeId);
      const targetPosition = nodePositionsRef.current.get(connection.targetNodeId);

      if (!sourceVisual || !targetVisual || !sourcePosition || !targetPosition) {
        continue;
      }

      const sourceNode = nodeById.get(connection.sourceNodeId);
      const targetNode = nodeById.get(connection.targetNodeId);
      const sourceIsAnnotation = isAnnotationNode(sourceNode);
      const targetIsAnnotation = isAnnotationNode(targetNode);
      const sourceAnchor = connection.sourceAnchor ?? { side: 'right' as const, offset: 0.5 };
      const targetAnchor = connection.targetAnchor ?? { side: 'left' as const, offset: 0.5 };
      const sourceY = sourceVisual.outputPortOffsets.get(connection.sourcePort) ?? sourceVisual.height / 2;
      const targetY = targetVisual.inputPortOffsets.get(connection.targetPort) ?? targetVisual.height / 2;
      const sourcePoint = sourceIsAnnotation
        ? resolveConnectionAnchorPoint(sourcePosition, sourceVisual.width, sourceVisual.height, sourceAnchor)
        : {
            x: sourcePosition.x + sourceVisual.width,
            y: sourcePosition.y + sourceY,
          };
      const targetPoint = targetIsAnnotation
        ? resolveConnectionAnchorPoint(targetPosition, targetVisual.width, targetVisual.height, targetAnchor)
        : {
            x: targetPosition.x,
            y: targetPosition.y + targetY,
          };
      const startSide = resolveConnectionSide(sourceIsAnnotation ? sourceAnchor.side : undefined, 'right');
      const endSide = resolveConnectionSide(targetIsAnnotation ? targetAnchor.side : undefined, 'left');
      const geometry = getBezierGeometry(
        connection.id,
        sourcePoint.x,
        sourcePoint.y,
        targetPoint.x,
        targetPoint.y,
        startSide,
        endSide
      );
      connectionGeometriesRef.current.set(connection.id, geometry);
      const isSelectedConnection = selectedConnectionIdRef.current === connection.id;
      const shouldDrawArrowHead = isAnnotationConnection(connection, nodeById);
      const resolvedBackgroundColor = isSelectedConnection ? selectedBackgroundColor : backgroundColor;
      const resolvedBackgroundAlpha = isSelectedConnection
        ? config.connectionWireSelectedBackgroundAlpha
        : config.connectionWireBackgroundAlpha;
      const resolvedForegroundColor = isSelectedConnection ? selectedForegroundColor : foregroundColor;
      const resolvedForegroundAlpha = isSelectedConnection
        ? config.connectionWireSelectedForegroundAlpha
        : config.connectionWireForegroundAlpha;
      edges.lineStyle(
        backgroundLineWidth,
        resolvedBackgroundColor,
        resolvedBackgroundAlpha,
        0.5,
        false
      );
      drawBezierConnection(edges, geometry.startX, geometry.startY, geometry.endX, geometry.endY, startSide, endSide);
      if (shouldDrawArrowHead) {
        drawConnectionArrowHead(
          edges,
          geometry,
          resolvedBackgroundColor,
          resolvedBackgroundAlpha,
          arrowHeadLayout.background.length,
          arrowHeadLayout.background.width
        );
      }
      edges.lineStyle(
        foregroundLineWidth,
        resolvedForegroundColor,
        resolvedForegroundAlpha,
        0.5,
        false
      );
      drawBezierConnection(edges, geometry.startX, geometry.startY, geometry.endX, geometry.endY, startSide, endSide);
      if (shouldDrawArrowHead) {
        drawConnectionArrowHead(
          edges,
          geometry,
          resolvedForegroundColor,
          resolvedForegroundAlpha,
          arrowHeadLayout.foreground.length,
          arrowHeadLayout.foreground.width
        );
      }
    }

    const dragState = connectionDragStateRef.current;
    if (!dragState) {
      return;
    }

    let endX = dragState.startX;
    let endY = dragState.startY;
    let endSide = resolveFreePointerEndSide(dragState.startX, dragState.startY, endX, endY);
    const startSide = resolveConnectionSide(dragState.sourceAnchor?.side, 'right');
    const hoveredTarget = dragState.hoveredTarget;

    if (hoveredTarget?.type === 'input-port') {
      const hoveredPosition = inputPortPositionsRef.current.get(hoveredTarget.portKey);
      if (hoveredPosition) {
        endX = hoveredPosition.x;
        endY = hoveredPosition.y;
        endSide = 'left';
      }
    } else if (hoveredTarget?.type === 'annotation') {
      endX = hoveredTarget.point.x;
      endY = hoveredTarget.point.y;
      endSide = hoveredTarget.anchor.side;
    } else {
      const viewport = viewportRef.current;
      if (viewport) {
        const worldPoint = viewport.toLocal(new Point(dragState.pointerX, dragState.pointerY));
        endX = worldPoint.x;
        endY = worldPoint.y;
        endSide = resolveFreePointerEndSide(dragState.startX, dragState.startY, endX, endY);
      }
    }

    const dragGeometry = getBezierGeometry(
      'drag-preview',
      dragState.startX,
      dragState.startY,
      endX,
      endY,
      startSide,
      endSide
    );
    const drawPreviewArrowHead =
      dragState.sourcePort === ANNOTATION_CONNECTION_PORT ||
      Boolean(dragState.sourceAnchor) ||
      hoveredTarget?.type === 'annotation';

    edges.lineStyle(
      backgroundLineWidth,
      selectedBackgroundColor,
      config.connectionWireSelectedBackgroundAlpha,
      0.5,
      false
    );
    drawBezierConnection(edges, dragGeometry.startX, dragGeometry.startY, dragGeometry.endX, dragGeometry.endY, startSide, endSide);
    if (drawPreviewArrowHead) {
      drawConnectionArrowHead(
        edges,
        dragGeometry,
        selectedBackgroundColor,
        config.connectionWireSelectedBackgroundAlpha,
        arrowHeadLayout.background.length,
        arrowHeadLayout.background.width
      );
    }
    edges.lineStyle(
      foregroundLineWidth,
      selectedForegroundColor,
      config.connectionWireSelectedForegroundAlpha,
      0.5,
      false
    );
    drawBezierConnection(edges, dragGeometry.startX, dragGeometry.startY, dragGeometry.endX, dragGeometry.endY, startSide, endSide);
    if (drawPreviewArrowHead) {
      drawConnectionArrowHead(
        edges,
        dragGeometry,
        selectedForegroundColor,
        config.connectionWireSelectedForegroundAlpha,
        arrowHeadLayout.foreground.length,
        arrowHeadLayout.foreground.width
      );
    }
  }, [
    config.connectionWireBackgroundAlpha,
    config.connectionWireForegroundAlpha,
    config.connectionWireScreenWidth,
    config.connectionWireSelectedBackgroundAlpha,
    config.connectionWireSelectedForegroundAlpha,
    connectionDragStateRef,
    connectionGeometriesRef,
    edgeLayerRef,
    graphRef,
    inputPortPositionsRef,
    nodePositionsRef,
    nodeVisualsRef,
    requestCanvasAnimationLoop,
    selectedConnectionIdRef,
    viewportRef,
  ]);

  const drawFreehandStrokes = useCallback(() => {
    const drawLayer = drawLayerRef.current;
    const viewport = viewportRef.current;
    const currentGraph = graphRef.current;
    if (!drawLayer || !viewport) {
      return;
    }

    requestCanvasAnimationLoop();
    drawLayer.clear();
    const viewportScale = Math.max(viewport.scale.x, 0.1);

    const drawPath = (path: DrawingPath, origin: Position) => {
      if (path.points.length === 0) {
        return;
      }

      const lineWidth = Math.max(path.thickness / viewportScale, 0.5 / viewportScale);
      const color = resolvePencilColor(path.color);
      drawLayer.lineStyle(lineWidth, color, 0.95, 0.5, false);

      if (path.points.length === 1) {
        const point = path.points[0];
        drawLayer.beginFill(color, 0.95);
        drawLayer.drawCircle(origin.x + point.x, origin.y + point.y, lineWidth * 0.5);
        drawLayer.endFill();
        return;
      }

      drawLayer.moveTo(origin.x + path.points[0].x, origin.y + path.points[0].y);
      for (let index = 1; index < path.points.length; index += 1) {
        drawLayer.lineTo(origin.x + path.points[index].x, origin.y + path.points[index].y);
      }
    };

    for (const drawing of currentGraph?.drawings ?? []) {
      const drawingPosition = drawingPositionsRef.current.get(drawing.id) ?? drawing.position;
      for (const path of drawing.paths) {
        drawPath(path, drawingPosition);
      }
    }

    const activePath = activeDrawingPathRef.current;
    if (!activePath) {
      return;
    }

    const drawing = currentGraph?.drawings?.find((candidate) => candidate.id === activePath.drawingId);
    if (!drawing) {
      return;
    }

    const drawingPosition = drawingPositionsRef.current.get(drawing.id) ?? drawing.position;
    drawPath(activePath.path, drawingPosition);
  }, [activeDrawingPathRef, drawLayerRef, drawingPositionsRef, graphRef, requestCanvasAnimationLoop, viewportRef]);

  const enqueueLightningForConnection = useCallback((connectionId: string) => {
    const now = performance.now();
    requestCanvasAnimationLoop();
    lightningPulsesRef.current = enqueueLightningPulseEffect(
      lightningPulsesRef.current,
      connectionId,
      now,
      config.lightningDurationMs
    );
  }, [config.lightningDurationMs, lightningPulsesRef, requestCanvasAnimationLoop]);

  const enqueueLightningForNodeInputs = useCallback((nodeId: string) => {
    const currentGraph = graphRef.current;
    if (!currentGraph) {
      return;
    }

    const nodeById = buildGraphNodeMap(currentGraph.nodes);
    for (const connection of currentGraph.connections) {
      if (connection.targetNodeId === nodeId && !isAnnotationConnection(connection, nodeById)) {
        enqueueLightningForConnection(connection.id);
      }
    }
  }, [enqueueLightningForConnection, graphRef]);

  const enqueueNodeShock = useCallback((nodeId: string) => {
    const now = performance.now();
    requestCanvasAnimationLoop();
    nodeShocksRef.current = enqueueNodeShockEffect(
      nodeShocksRef.current,
      nodeId,
      now,
      config.nodeShockDurationMs
    );
  }, [config.nodeShockDurationMs, nodeShocksRef, requestCanvasAnimationLoop]);

  const drawEffects = useCallback(() => {
    const effectsLayer = effectsLayerRef.current;
    if (!effectsLayer) {
      return;
    }

    onEffectFrame();
    const effectResult = runCanvasEffectsPass({
      effectsLayer,
      now: performance.now(),
      hasGraph: Boolean(graphRef.current),
      nodeExecutionStates: nodeExecutionStatesRef.current,
      nodeVisuals: nodeVisualsRef.current,
      nodePositions: nodePositionsRef.current,
      connectionGeometries: connectionGeometriesRef.current,
      smokePuffs: smokePuffsRef.current,
      lightningPulses: lightningPulsesRef.current,
      nodeShocks: nodeShocksRef.current,
      lastSmokeEmitAtByNode: lastSmokeEmitAtRef.current,
      smokeEmitIntervalMs: config.smokeEmitIntervalMs,
      smokeMinDurationMs: config.smokeMinDurationMs,
      smokeMaxDurationMs: config.smokeMaxDurationMs,
      smokeMaxParticles: config.smokeMaxParticles,
    });
    smokePuffsRef.current = effectResult.smokePuffs;
    lightningPulsesRef.current = effectResult.lightningPulses;
    nodeShocksRef.current = effectResult.nodeShocks;
    lastSmokeEmitAtRef.current = effectResult.lastSmokeEmitAtByNode;
    pauseCanvasAnimationLoopIfIdle();
  }, [
    config.smokeEmitIntervalMs,
    config.smokeMaxDurationMs,
    config.smokeMaxParticles,
    config.smokeMinDurationMs,
    connectionGeometriesRef,
    effectsLayerRef,
    graphRef,
    lastSmokeEmitAtRef,
    lightningPulsesRef,
    nodeExecutionStatesRef,
    nodePositionsRef,
    nodeShocksRef,
    nodeVisualsRef,
    onEffectFrame,
    pauseCanvasAnimationLoopIfIdle,
    smokePuffsRef,
  ]);

  const endConnectionDrag = useCallback((commit: boolean) => {
    const dragState = connectionDragStateRef.current;
    if (!dragState) {
      return;
    }

    const previousHoveredTarget = dragState.hoveredTarget;
    const previousSourceOutput = dragState.sourcePortKey;

    if (commit && previousHoveredTarget) {
      const currentGraph = graphRef.current;
      if (currentGraph) {
        let targetNodeId = '';
        let targetPort = '';
        let targetAnchor = undefined;

        if (previousHoveredTarget.type === 'input-port') {
          const parsed = parsePortKey(previousHoveredTarget.portKey);
          targetNodeId = parsed.nodeId;
          targetPort = parsed.portName;
        } else if (previousHoveredTarget.type === 'annotation') {
          targetNodeId = previousHoveredTarget.nodeId;
          targetPort = ANNOTATION_CONNECTION_PORT;
          targetAnchor = previousHoveredTarget.anchor;
        }

        if (!targetPort) {
          connectionDragStateRef.current = null;
          hoveredInputPortKeyRef.current = null;
          hoveredOutputPortKeyRef.current = null;
          drawConnections();
          return;
        }

        const alreadyExists = currentGraph.connections.some((connection) =>
          connection.sourceNodeId === dragState.sourceNodeId &&
          connection.sourcePort === dragState.sourcePort &&
          areConnectionAnchorsEqual(connection.sourceAnchor, dragState.sourceAnchor) &&
          connection.targetNodeId === targetNodeId &&
          connection.targetPort === targetPort &&
          areConnectionAnchorsEqual(connection.targetAnchor, targetAnchor)
        );

        const introducesCycle = createsCycle(
          currentGraph.nodes,
          dragState.sourceNodeId,
          targetNodeId,
          currentGraph.connections
        );

        if (!alreadyExists && !introducesCycle) {
          addConnection({
            id: uuidv4(),
            sourceNodeId: dragState.sourceNodeId,
            sourcePort: dragState.sourcePort,
            sourceAnchor: dragState.sourceAnchor,
            targetNodeId,
            targetPort,
            targetAnchor,
          });
        }
      }
    }

    connectionDragStateRef.current = null;
    hoveredInputPortKeyRef.current = null;
    hoveredOutputPortKeyRef.current = null;
    if (previousHoveredTarget?.type === 'input-port') {
      setInputPortHighlight(previousHoveredTarget.portKey, false);
    }
    setOutputPortHighlight(previousSourceOutput || '', false);
    drawConnections();
  }, [
    addConnection,
    connectionDragStateRef,
    drawConnections,
    graphRef,
    hoveredInputPortKeyRef,
    hoveredOutputPortKeyRef,
    setInputPortHighlight,
    setOutputPortHighlight,
  ]);

  const updateNumericSliderFromPointer = useCallback((nodeId: string, pointerX: number, pointerY: number) => {
    const slider = numericSliderVisualsRef.current.get(nodeId);
    if (!slider) {
      return;
    }

    const localPoint = slider.nodeContainer.toLocal(new Point(pointerX, pointerY));
    const nextValue = resolveNumericSliderValue(localPoint.x, slider);
    if (nextValue !== slider.value) {
      slider.value = nextValue;
      drawNumericSliderVisual(slider);
    }

    const dragState = numericSliderDragStateRef.current;
    if (dragState?.nodeId === nodeId) {
      dragState.currentValue = nextValue;
    }
  }, [numericSliderDragStateRef, numericSliderVisualsRef]);

  const commitNumericSliderValue = useCallback((nodeId: string, nextValue: number) => {
    const currentGraph = graphRef.current;
    const node = currentGraph?.nodes.find((candidate) => candidate.id === nodeId);
    if (!node || node.type !== NodeType.NUMERIC_INPUT) {
      return;
    }

    const currentConfig = normalizeNumericInputConfig(node.config.config as Record<string, unknown> | undefined);
    const value = snapNumericInputValue(nextValue, currentConfig.min, currentConfig.max, currentConfig.step);
    if (value === currentConfig.value) {
      return;
    }

    updateNode(nodeId, {
      config: {
        ...node.config,
        config: {
          ...(node.config.config ?? {}),
          min: currentConfig.min,
          max: currentConfig.max,
          step: currentConfig.step,
          value,
        },
      },
    });
  }, [graphRef, updateNode]);

  return {
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
    setOutputPortHighlight,
    syncNodePortPositions,
    updateNumericSliderFromPointer,
  };
}
