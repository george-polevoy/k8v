import { normalizeCanvasBackground } from './canvasBackground';
import {
  DEFAULT_GRAPH_PROJECTION_ID,
  DEFAULT_GRAPH_PROJECTION_NAME,
  applyProjectionToNodes,
  cloneProjectionNodeCardSizes,
  cloneProjectionNodePositions,
  normalizeGraphProjectionState,
  syncActiveProjectionLayout,
  type CanvasBackgroundSettings,
  type GraphNode,
  type GraphProjection,
  type Position,
  type ProjectionNodeCardSize,
} from '../types';

export {
  DEFAULT_GRAPH_PROJECTION_ID,
  DEFAULT_GRAPH_PROJECTION_NAME,
  applyProjectionToNodes,
  cloneProjectionNodeCardSizes,
  cloneProjectionNodePositions,
  normalizeGraphProjectionState,
  syncActiveProjectionLayout,
};

function clonePosition(position: Position): Position {
  return { x: position.x, y: position.y };
}

export function withNodePositionInProjection(
  projection: GraphProjection,
  nodeId: string,
  position: Position
): GraphProjection {
  return {
    ...projection,
    nodePositions: {
      ...projection.nodePositions,
      [nodeId]: clonePosition(position),
    },
  };
}

export function withNodeCardSizeInProjection(
  projection: GraphProjection,
  nodeId: string,
  size: ProjectionNodeCardSize
): GraphProjection {
  return {
    ...projection,
    nodeCardSizes: {
      ...(projection.nodeCardSizes ?? {}),
      [nodeId]: {
        width: Math.max(1, Math.round(size.width)),
        height: Math.max(1, Math.round(size.height)),
      },
    },
  };
}

export function withCanvasBackgroundInProjection(
  projection: GraphProjection,
  background: CanvasBackgroundSettings
): GraphProjection {
  return {
    ...projection,
    canvasBackground: normalizeCanvasBackground(background),
  };
}

export type {
  GraphNode,
};
