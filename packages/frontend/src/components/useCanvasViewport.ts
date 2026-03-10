import { PointerEvent as ReactPointerEvent, useCallback, type MutableRefObject } from 'react';
import {
  Application,
  Container,
  Text,
} from 'pixi.js';
import type {
  CanvasBackgroundSettings,
  Graph,
  GraphNode,
  Position,
} from '../types';
import { clamp, snapToPixel } from '../utils/canvasHelpers';
import {
  resolveGraphWorldBounds,
  resolveViewportFitTransform,
} from '../utils/canvasViewportFit';
import { resolveGraphCanvasBackground } from '../utils/canvasBackground';

export interface MinimapTransform {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  scale: number;
  offsetX: number;
  offsetY: number;
}

export interface ProjectionNodeVisualState {
  position: Position;
  width: number;
  height: number;
}

export interface ProjectionTransitionState {
  graphId: string;
  fromProjectionId: string;
  toProjectionId: string;
  fromBackground: CanvasBackgroundSettings;
  toBackground: CanvasBackgroundSettings;
  fromNodes: Map<string, ProjectionNodeVisualState>;
  toNodes: Map<string, ProjectionNodeVisualState>;
  startAt: number;
  durationMs: number;
}

export interface ScreenshotRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ScreenshotBitmap {
  width: number;
  height: number;
}

interface NodeCardSizeDraft {
  width: number;
  height: number;
}

interface NodeVisualLike {
  width: number;
  height: number;
  projectedGraphicsHeight: number;
}

interface ResolveNodeCardDimensionsResult {
  width: number;
  height: number;
}

interface UseCanvasViewportConfig {
  pixelRatio: number;
  maxTextResolution: number;
  minimapWidth: number;
  minimapHeight: number;
  minimapPadding: number;
  minZoom: number;
  maxZoom: number;
  viewportMargin: number;
  projectionTransitionDurationMs: number;
}

interface UseCanvasViewportParams {
  appRef: MutableRefObject<Application | null>;
  minimapCanvasRef: MutableRefObject<HTMLCanvasElement | null>;
  minimapTransformRef: MutableRefObject<MinimapTransform | null>;
  viewportRef: MutableRefObject<Container | null>;
  textNodesRef: MutableRefObject<Set<Text>>;
  graphRef: MutableRefObject<Graph | null>;
  selectedNodeIdsRef: MutableRefObject<string[]>;
  selectedDrawingIdRef: MutableRefObject<string | null>;
  nodeVisualsRef: MutableRefObject<Map<string, NodeVisualLike>>;
  drawingPositionsRef: MutableRefObject<Map<string, Position>>;
  nodePositionsRef: MutableRefObject<Map<string, Position>>;
  nodeCardDraftSizesRef: MutableRefObject<Map<string, NodeCardSizeDraft>>;
  projectionTransitionRef: MutableRefObject<ProjectionTransitionState | null>;
  viewportInitializedRef: MutableRefObject<boolean>;
  lastResolvedCanvasBackgroundRef: MutableRefObject<CanvasBackgroundSettings>;
  renderGraphRef: MutableRefObject<() => void>;
  requestCanvasAnimationLoop: () => void;
  requestViewportDrivenGraphRefresh: () => void;
  resolveNodeCardDimensions: (
    node: GraphNode,
    draftSize?: NodeCardSizeDraft
  ) => ResolveNodeCardDimensionsResult;
  config: UseCanvasViewportConfig;
}

export function useCanvasViewport(params: UseCanvasViewportParams) {
  const {
    appRef,
    minimapCanvasRef,
    minimapTransformRef,
    viewportRef,
    textNodesRef,
    graphRef,
    selectedNodeIdsRef,
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
    config,
  } = params;

  const updateTextResolutionForScale = useCallback((scale: number) => {
    const nextResolution = clamp(
      config.pixelRatio * Math.max(scale, 1),
      config.pixelRatio,
      config.maxTextResolution
    );

    for (const textNode of textNodesRef.current) {
      if (Math.abs(textNode.resolution - nextResolution) > 0.01) {
        textNode.resolution = nextResolution;
      }
    }
  }, [config.maxTextResolution, config.pixelRatio, textNodesRef]);

  const centerViewportAtWorldPoint = useCallback((worldX: number, worldY: number) => {
    const app = appRef.current;
    const viewport = viewportRef.current;
    if (!app || !viewport) {
      return;
    }

    const scale = viewport.scale.x || 1;
    viewport.position.set(
      snapToPixel(app.screen.width * 0.5 - worldX * scale),
      snapToPixel(app.screen.height * 0.5 - worldY * scale)
    );
    requestCanvasAnimationLoop();
    requestViewportDrivenGraphRefresh();
  }, [appRef, requestCanvasAnimationLoop, requestViewportDrivenGraphRefresh, viewportRef]);

  const drawMinimap = useCallback(() => {
    const canvas = minimapCanvasRef.current;
    const app = appRef.current;
    const viewport = viewportRef.current;
    const currentGraph = graphRef.current;

    if (!canvas || !app || !viewport) {
      return;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }

    const cssWidth = config.minimapWidth;
    const cssHeight = config.minimapHeight;
    const dpr = config.pixelRatio;
    const deviceWidth = Math.max(1, Math.round(cssWidth * dpr));
    const deviceHeight = Math.max(1, Math.round(cssHeight * dpr));

    if (canvas.width !== deviceWidth || canvas.height !== deviceHeight) {
      canvas.width = deviceWidth;
      canvas.height = deviceHeight;
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssWidth, cssHeight);
    ctx.fillStyle = 'rgba(15, 23, 42, 0.72)';
    ctx.fillRect(0, 0, cssWidth, cssHeight);

    const viewportScale = viewport.scale.x || 1;
    const viewMinX = -viewport.position.x / viewportScale;
    const viewMinY = -viewport.position.y / viewportScale;
    const viewMaxX = viewMinX + app.screen.width / viewportScale;
    const viewMaxY = viewMinY + app.screen.height / viewportScale;

    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    if (currentGraph && (currentGraph.nodes.length > 0 || (currentGraph.drawings?.length ?? 0) > 0)) {
      for (const node of currentGraph.nodes) {
        const position = nodePositionsRef.current.get(node.id) ?? node.position;
        const visual = nodeVisualsRef.current.get(node.id);
        const dimensions = resolveNodeCardDimensions(node, nodeCardDraftSizesRef.current.get(node.id));
        const nodeWidth = visual?.width ?? dimensions.width;
        const nodeHeight = visual
          ? visual.height + visual.projectedGraphicsHeight
          : dimensions.height;

        minX = Math.min(minX, position.x);
        minY = Math.min(minY, position.y);
        maxX = Math.max(maxX, position.x + nodeWidth);
        maxY = Math.max(maxY, position.y + nodeHeight);
      }

      for (const drawing of currentGraph.drawings ?? []) {
        const drawingPosition = drawingPositionsRef.current.get(drawing.id) ?? drawing.position;
        minX = Math.min(minX, drawingPosition.x);
        minY = Math.min(minY, drawingPosition.y);
        maxX = Math.max(maxX, drawingPosition.x + 140);
        maxY = Math.max(maxY, drawingPosition.y + 26);

        for (const path of drawing.paths) {
          for (const point of path.points) {
            const worldX = drawingPosition.x + point.x;
            const worldY = drawingPosition.y + point.y;
            minX = Math.min(minX, worldX);
            minY = Math.min(minY, worldY);
            maxX = Math.max(maxX, worldX);
            maxY = Math.max(maxY, worldY);
          }
        }
      }
    } else {
      minX = viewMinX - 100;
      minY = viewMinY - 100;
      maxX = viewMaxX + 100;
      maxY = viewMaxY + 100;
    }

    if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
      minX = viewMinX - 100;
      minY = viewMinY - 100;
      maxX = viewMaxX + 100;
      maxY = viewMaxY + 100;
    }

    const minimapWorldPadding = 120;
    minX -= minimapWorldPadding;
    minY -= minimapWorldPadding;
    maxX += minimapWorldPadding;
    maxY += minimapWorldPadding;

    const worldWidth = Math.max(maxX - minX, 1);
    const worldHeight = Math.max(maxY - minY, 1);
    const innerWidth = cssWidth - config.minimapPadding * 2;
    const innerHeight = cssHeight - config.minimapPadding * 2;
    const scale = Math.min(innerWidth / worldWidth, innerHeight / worldHeight);
    const offsetX = config.minimapPadding + (innerWidth - worldWidth * scale) * 0.5;
    const offsetY = config.minimapPadding + (innerHeight - worldHeight * scale) * 0.5;

    minimapTransformRef.current = {
      minX,
      minY,
      maxX,
      maxY,
      scale,
      offsetX,
      offsetY,
    };

    if (currentGraph) {
      const selectedNodeIdSet = new Set(selectedNodeIdsRef.current);
      for (const node of currentGraph.nodes) {
        const position = nodePositionsRef.current.get(node.id) ?? node.position;
        const visual = nodeVisualsRef.current.get(node.id);
        const dimensions = resolveNodeCardDimensions(node, nodeCardDraftSizesRef.current.get(node.id));
        const nodeWidth = visual?.width ?? dimensions.width;
        const nodeHeight = visual
          ? visual.height + visual.projectedGraphicsHeight
          : dimensions.height;

        const x = offsetX + (position.x - minX) * scale;
        const y = offsetY + (position.y - minY) * scale;
        const w = nodeWidth * scale;
        const h = nodeHeight * scale;

        ctx.fillStyle = selectedNodeIdSet.has(node.id) ? 'rgba(59, 130, 246, 0.75)' : 'rgba(203, 213, 225, 0.95)';
        ctx.strokeStyle = 'rgba(30, 41, 59, 0.8)';
        ctx.lineWidth = 1;
        ctx.fillRect(x, y, w, h);
        ctx.strokeRect(x, y, w, h);
      }

      for (const drawing of currentGraph.drawings ?? []) {
        const position = drawingPositionsRef.current.get(drawing.id) ?? drawing.position;
        const x = offsetX + (position.x - minX) * scale;
        const y = offsetY + (position.y - minY) * scale;
        const w = Math.max(26 * scale, 10);
        const h = Math.max(12 * scale, 6);
        ctx.fillStyle = selectedDrawingIdRef.current === drawing.id
          ? 'rgba(14, 165, 233, 0.9)'
          : 'rgba(15, 118, 110, 0.75)';
        ctx.fillRect(x, y, w, h);

        ctx.strokeStyle = 'rgba(241, 245, 249, 0.9)';
        ctx.lineWidth = 1;
        for (const path of drawing.paths) {
          if (path.points.length < 2) {
            continue;
          }
          ctx.beginPath();
          const first = path.points[0];
          ctx.moveTo(
            offsetX + ((position.x + first.x) - minX) * scale,
            offsetY + ((position.y + first.y) - minY) * scale
          );
          for (let index = 1; index < path.points.length; index += 1) {
            const point = path.points[index];
            ctx.lineTo(
              offsetX + ((position.x + point.x) - minX) * scale,
              offsetY + ((position.y + point.y) - minY) * scale
            );
          }
          ctx.stroke();
        }
      }
    }

    const viewX = offsetX + (viewMinX - minX) * scale;
    const viewY = offsetY + (viewMinY - minY) * scale;
    const viewW = (viewMaxX - viewMinX) * scale;
    const viewH = (viewMaxY - viewMinY) * scale;
    ctx.strokeStyle = 'rgba(59, 130, 246, 1)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(viewX, viewY, viewW, viewH);
  }, [
    appRef,
    config.minimapHeight,
    config.minimapPadding,
    config.minimapWidth,
    config.pixelRatio,
    drawingPositionsRef,
    graphRef,
    minimapCanvasRef,
    minimapTransformRef,
    nodeCardDraftSizesRef,
    nodePositionsRef,
    nodeVisualsRef,
    resolveNodeCardDimensions,
    selectedDrawingIdRef,
    selectedNodeIdsRef,
    viewportRef,
  ]);

  const handleMinimapPointerDown = useCallback((event: ReactPointerEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    event.stopPropagation();

    const transform = minimapTransformRef.current;
    const canvas = minimapCanvasRef.current;
    if (!transform || !canvas) {
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const worldX = clamp(
      transform.minX + (x - transform.offsetX) / transform.scale,
      transform.minX,
      transform.maxX
    );
    const worldY = clamp(
      transform.minY + (y - transform.offsetY) / transform.scale,
      transform.minY,
      transform.maxY
    );

    centerViewportAtWorldPoint(worldX, worldY);
    drawMinimap();
  }, [centerViewportAtWorldPoint, drawMinimap, minimapCanvasRef, minimapTransformRef]);

  const fitViewportToGraph = useCallback(() => {
    const app = appRef.current;
    const viewport = viewportRef.current;
    const currentGraph = graphRef.current;

    if (!app || !viewport) {
      return;
    }

    const resetViewport = () => {
      viewport.scale.set(1);
      viewport.position.set(app.screen.width / 2, app.screen.height / 2);
      updateTextResolutionForScale(1);
      drawMinimap();
      requestViewportDrivenGraphRefresh();
    };

    if (!currentGraph || (currentGraph.nodes.length === 0 && (currentGraph.drawings?.length ?? 0) === 0)) {
      resetViewport();
      return;
    }

    const nodeBounds = currentGraph.nodes.flatMap((node) => {
      const visual = nodeVisualsRef.current.get(node.id);
      const position = nodePositionsRef.current.get(node.id);
      if (!visual || !position) {
        return [];
      }

      return [{
        x: position.x,
        y: position.y,
        width: visual.width,
        height: visual.height,
        projectedGraphicsHeight: visual.projectedGraphicsHeight,
      }];
    });
    const drawingBounds = (currentGraph.drawings ?? []).map((drawing) => ({
      position: drawingPositionsRef.current.get(drawing.id) ?? drawing.position,
      paths: drawing.paths,
    }));
    const graphBounds = resolveGraphWorldBounds(nodeBounds, drawingBounds);
    if (!graphBounds) {
      resetViewport();
      return;
    }

    const nextTransform = resolveViewportFitTransform({
      bounds: graphBounds,
      screenWidth: app.screen.width,
      screenHeight: app.screen.height,
      margin: config.viewportMargin,
      minZoom: config.minZoom,
      maxZoom: config.maxZoom,
    });
    viewport.scale.set(nextTransform.scale);
    viewport.position.set(nextTransform.x, nextTransform.y);
    updateTextResolutionForScale(nextTransform.scale);
    drawMinimap();
    requestViewportDrivenGraphRefresh();
  }, [
    appRef,
    config.maxZoom,
    config.minZoom,
    config.viewportMargin,
    drawMinimap,
    drawingPositionsRef,
    graphRef,
    nodePositionsRef,
    nodeVisualsRef,
    requestViewportDrivenGraphRefresh,
    updateTextResolutionForScale,
    viewportRef,
  ]);

  const setViewportRegionForScreenshot = useCallback((
    region: ScreenshotRegion,
    bitmap: ScreenshotBitmap
  ): boolean => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return false;
    }

    const safeRegionWidth = Math.max(0.0001, Math.abs(region.width));
    const safeRegionHeight = Math.max(0.0001, Math.abs(region.height));
    const safeBitmapWidth = Math.max(1, Math.round(bitmap.width));
    const safeBitmapHeight = Math.max(1, Math.round(bitmap.height));
    const scaleX = safeBitmapWidth / safeRegionWidth;
    const scaleY = safeBitmapHeight / safeRegionHeight;

    viewport.scale.set(scaleX, scaleY);
    viewport.position.set(
      snapToPixel(-region.x * scaleX),
      snapToPixel(-region.y * scaleY)
    );
    viewportInitializedRef.current = true;
    updateTextResolutionForScale(scaleX);
    drawMinimap();
    requestViewportDrivenGraphRefresh();
    renderGraphRef.current();
    return true;
  }, [
    drawMinimap,
    renderGraphRef,
    requestViewportDrivenGraphRefresh,
    updateTextResolutionForScale,
    viewportInitializedRef,
    viewportRef,
  ]);

  const buildProjectionTargetNodeVisualMap = useCallback((targetGraph: Graph | null): Map<string, ProjectionNodeVisualState> => {
    const map = new Map<string, ProjectionNodeVisualState>();
    if (!targetGraph) {
      return map;
    }

    for (const node of targetGraph.nodes) {
      const dimensions = resolveNodeCardDimensions(node, nodeCardDraftSizesRef.current.get(node.id));
      map.set(node.id, {
        position: {
          x: node.position.x,
          y: node.position.y,
        },
        width: dimensions.width,
        height: dimensions.height,
      });
    }

    return map;
  }, [nodeCardDraftSizesRef, resolveNodeCardDimensions]);

  const startProjectionTransition = useCallback((previousGraph: Graph | null, nextGraph: Graph | null) => {
    if (!previousGraph || !nextGraph) {
      projectionTransitionRef.current = null;
      return;
    }

    const fromNodes = new Map<string, ProjectionNodeVisualState>();
    for (const node of previousGraph.nodes) {
      const renderedPosition = nodePositionsRef.current.get(node.id) ?? node.position;
      const renderedVisual = nodeVisualsRef.current.get(node.id);
      const fallbackDimensions = resolveNodeCardDimensions(node, nodeCardDraftSizesRef.current.get(node.id));
      fromNodes.set(node.id, {
        position: {
          x: renderedPosition.x,
          y: renderedPosition.y,
        },
        width: renderedVisual?.width ?? fallbackDimensions.width,
        height: renderedVisual?.height ?? fallbackDimensions.height,
      });
    }

    projectionTransitionRef.current = {
      graphId: nextGraph.id,
      fromProjectionId: previousGraph.activeProjectionId ?? 'unknown',
      toProjectionId: nextGraph.activeProjectionId ?? 'unknown',
      fromBackground: lastResolvedCanvasBackgroundRef.current,
      toBackground: resolveGraphCanvasBackground(nextGraph),
      fromNodes,
      toNodes: buildProjectionTargetNodeVisualMap(nextGraph),
      startAt: performance.now(),
      durationMs: config.projectionTransitionDurationMs,
    };
  }, [
    buildProjectionTargetNodeVisualMap,
    config.projectionTransitionDurationMs,
    lastResolvedCanvasBackgroundRef,
    nodeCardDraftSizesRef,
    nodePositionsRef,
    nodeVisualsRef,
    projectionTransitionRef,
    resolveNodeCardDimensions,
  ]);

  return {
    drawMinimap,
    fitViewportToGraph,
    handleMinimapPointerDown,
    setViewportRegionForScreenshot,
    startProjectionTransition,
    updateTextResolutionForScale,
  };
}
