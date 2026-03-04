import { clamp, easeInOutCubic } from './canvasHelpers';

export interface ProjectionTransitionLike {
  graphId: string;
  startAt: number;
  durationMs: number;
}

export interface ProjectionTransitionFrame<TTransition extends ProjectionTransitionLike> {
  transition: TTransition | null;
  progress: number;
  easedProgress: number;
  isActive: boolean;
}

export interface RenderDisplayObjectLike {
  destroy(options?: { children?: boolean }): void;
}

export interface RenderLayerLike {
  removeChildren(): RenderDisplayObjectLike[];
}

export function clearRenderLayerChildren(layer: RenderLayerLike): void {
  const staleChildren = layer.removeChildren();
  for (const displayObject of staleChildren) {
    displayObject.destroy({ children: true });
  }
}

export function resolveProjectionTransitionFrame<TTransition extends ProjectionTransitionLike>(
  transition: TTransition | null,
  currentGraphId: string | null,
  now: number
): ProjectionTransitionFrame<TTransition> {
  if (!transition || !currentGraphId || transition.graphId !== currentGraphId) {
    return {
      transition: null,
      progress: 1,
      easedProgress: 1,
      isActive: false,
    };
  }

  const progress = clamp((now - transition.startAt) / transition.durationMs, 0, 1);
  const easedProgress = easeInOutCubic(progress);
  if (progress >= 1) {
    return {
      transition: null,
      progress,
      easedProgress,
      isActive: false,
    };
  }

  return {
    transition,
    progress,
    easedProgress,
    isActive: true,
  };
}

export function pruneNodeDraftMaps<TSize, TPosition>(
  currentNodeIds: Set<string>,
  nodeCardDraftSizes: Map<string, TSize>,
  nodeCardDraftPositions: Map<string, TPosition>
): void {
  for (const nodeId of nodeCardDraftSizes.keys()) {
    if (!currentNodeIds.has(nodeId)) {
      nodeCardDraftSizes.delete(nodeId);
    }
  }
  for (const nodeId of nodeCardDraftPositions.keys()) {
    if (!currentNodeIds.has(nodeId)) {
      nodeCardDraftPositions.delete(nodeId);
    }
  }
}
