import type { GraphNode, GraphicsArtifact, Position } from '../types';
import { snapToPixel } from './canvasHelpers';
import { estimateProjectedPixelBudget, resolveStableGraphicsRequestMaxPixels } from './graphics';

export interface WorldBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface NodeRenderDragStateLike {
  nodeId: string;
  currentX: number;
  currentY: number;
}

export interface ProjectionNodeVisualStateLike {
  position: Position;
  width: number;
  height: number;
}

export interface ResolveNodeRenderFrameInput {
  node: GraphNode;
  dragState: NodeRenderDragStateLike | null;
  draftPosition?: Position;
  targetWidth: number;
  targetHeight: number;
  minWidth: number;
  minHeight: number;
  fromTransitionState: ProjectionNodeVisualStateLike | null;
  toTransitionState: ProjectionNodeVisualStateLike | null;
  transitionEasedProgress: number;
}

export interface NodeRenderFrame {
  position: Position;
  width: number;
  height: number;
}

export interface ResolveGraphicsProjectionPlanInput {
  graphicsOutput: GraphicsArtifact | null | undefined;
  shouldProjectGraphics: boolean;
  nodePosition: Position;
  nodeWidth: number;
  nodeHeight: number;
  viewportScale: number;
  pixelRatio: number;
  canEvaluateViewportGraphics: boolean;
  viewportWorldBounds: WorldBounds | null;
  canReloadProjectedGraphics: boolean;
  fallbackAspectRatio: number;
}

export interface GraphicsProjectionPlan {
  projectedWidthOnScreen: number | null;
  estimatedMaxPixels: number | null;
  stableMaxPixels: number | null;
  selectedLevel: number | null;
  selectedLevelPixels: number | null;
  expectedProjectedGraphicsHeight: number;
  shouldLoadProjectedGraphicsByViewport: boolean;
  shouldLoadProjectedGraphics: boolean;
  canReloadProjectedGraphics: boolean;
}

export function resolveNodeRenderTargetPosition(
  node: GraphNode,
  dragState: NodeRenderDragStateLike | null,
  draftPosition?: Position
): Position {
  if (!dragState || dragState.nodeId !== node.id) {
    if (draftPosition) {
      return { ...draftPosition };
    }
    return { ...node.position };
  }

  return {
    x: dragState.currentX,
    y: dragState.currentY,
  };
}

export function resolveNodeRenderFrame({
  node,
  dragState,
  draftPosition,
  targetWidth,
  targetHeight,
  minWidth,
  minHeight,
  fromTransitionState,
  toTransitionState,
  transitionEasedProgress,
}: ResolveNodeRenderFrameInput): NodeRenderFrame {
  const targetPosition = resolveNodeRenderTargetPosition(node, dragState, draftPosition);
  const startTransitionState = dragState
    ? null
    : fromTransitionState ?? toTransitionState;
  const endTransitionState = toTransitionState ?? {
    position: targetPosition,
    width: targetWidth,
    height: targetHeight,
  };

  const interpolatedPosition = startTransitionState
    ? {
      x: startTransitionState.position.x +
        (endTransitionState.position.x - startTransitionState.position.x) * transitionEasedProgress,
      y: startTransitionState.position.y +
        (endTransitionState.position.y - startTransitionState.position.y) * transitionEasedProgress,
    }
    : targetPosition;
  const width = startTransitionState
    ? Math.max(
      minWidth,
      snapToPixel(
        startTransitionState.width +
          (endTransitionState.width - startTransitionState.width) * transitionEasedProgress
      )
    )
    : targetWidth;
  const height = startTransitionState
    ? Math.max(
      minHeight,
      snapToPixel(
        startTransitionState.height +
          (endTransitionState.height - startTransitionState.height) * transitionEasedProgress
      )
    )
    : targetHeight;

  return {
    position: {
      x: snapToPixel(interpolatedPosition.x),
      y: snapToPixel(interpolatedPosition.y),
    },
    width,
    height,
  };
}

function worldBoundsIntersect(a: WorldBounds, b: WorldBounds): boolean {
  return !(a.maxX <= b.minX || a.minX >= b.maxX || a.maxY <= b.minY || a.minY >= b.maxY);
}

function resolveGraphicsAspectRatio(graphics: GraphicsArtifact, fallbackAspectRatio: number): number {
  const baseLevel = graphics.levels[0];
  if (!baseLevel || baseLevel.width <= 0 || baseLevel.height <= 0) {
    return fallbackAspectRatio;
  }

  return Math.max(baseLevel.height / baseLevel.width, 0.01);
}

export function resolveGraphicsProjectionPlan({
  graphicsOutput,
  shouldProjectGraphics,
  nodePosition,
  nodeWidth,
  nodeHeight,
  viewportScale,
  pixelRatio,
  canEvaluateViewportGraphics,
  viewportWorldBounds,
  canReloadProjectedGraphics,
  fallbackAspectRatio,
}: ResolveGraphicsProjectionPlanInput): GraphicsProjectionPlan {
  let projectedWidthOnScreen: number | null = null;
  let estimatedMaxPixels: number | null = null;
  let stableMaxPixels: number | null = null;
  let selectedLevel: number | null = null;
  let selectedLevelPixels: number | null = null;
  let expectedProjectedGraphicsHeight = 0;
  let shouldLoadProjectedGraphicsByViewport = false;

  if (shouldProjectGraphics && graphicsOutput) {
    projectedWidthOnScreen = nodeWidth * viewportScale;
    estimatedMaxPixels = estimateProjectedPixelBudget(
      graphicsOutput,
      projectedWidthOnScreen,
      pixelRatio
    );
    stableMaxPixels = resolveStableGraphicsRequestMaxPixels(
      graphicsOutput,
      estimatedMaxPixels
    );

    const matchedLevel = graphicsOutput.levels.find(
      (level) => level.pixelCount === stableMaxPixels
    );
    if (matchedLevel) {
      selectedLevel = matchedLevel.level;
      selectedLevelPixels = matchedLevel.pixelCount;
    }

    expectedProjectedGraphicsHeight = Math.max(
      1,
      nodeWidth * resolveGraphicsAspectRatio(graphicsOutput, fallbackAspectRatio)
    );
    const graphicsBounds: WorldBounds | null =
      expectedProjectedGraphicsHeight > 0
        ? {
          minX: nodePosition.x,
          minY: nodePosition.y + nodeHeight,
          maxX: nodePosition.x + nodeWidth,
          maxY: nodePosition.y + nodeHeight + expectedProjectedGraphicsHeight,
        }
        : null;
    shouldLoadProjectedGraphicsByViewport = Boolean(
      canEvaluateViewportGraphics &&
      viewportWorldBounds &&
      graphicsBounds &&
      worldBoundsIntersect(viewportWorldBounds, graphicsBounds)
    );
  }

  return {
    projectedWidthOnScreen,
    estimatedMaxPixels,
    stableMaxPixels,
    selectedLevel,
    selectedLevelPixels,
    expectedProjectedGraphicsHeight,
    shouldLoadProjectedGraphicsByViewport,
    shouldLoadProjectedGraphics: shouldLoadProjectedGraphicsByViewport && canReloadProjectedGraphics,
    canReloadProjectedGraphics,
  };
}
