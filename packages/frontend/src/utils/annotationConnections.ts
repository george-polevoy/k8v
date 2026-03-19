import type {
  Connection,
  ConnectionAnchor,
  ConnectionAnchorSide,
  Position,
} from '../types';
import {
  ANNOTATION_CONNECTION_PORT,
  areConnectionAnchorsEqual,
  buildGraphNodeMap,
  isPresentationConnection,
  isAnnotationNode,
} from '../types';

export {
  ANNOTATION_CONNECTION_PORT,
  areConnectionAnchorsEqual,
  buildGraphNodeMap,
  isAnnotationNode,
};

export function isPresentationConnectionEndpoint(
  port: string,
  anchor?: ConnectionAnchor
): boolean {
  return port === ANNOTATION_CONNECTION_PORT || Boolean(anchor);
}

export function isPresentationArrowConnection(connection: Connection): boolean {
  return isPresentationConnection(connection);
}

export function clampConnectionAnchorOffset(value: number): number {
  if (!Number.isFinite(value)) {
    return 0.5;
  }
  return Math.min(Math.max(value, 0), 1);
}

export function resolveConnectionAnchorPoint(
  nodePosition: Position,
  width: number,
  height: number,
  anchor: ConnectionAnchor
): Position {
  const offset = clampConnectionAnchorOffset(anchor.offset);

  switch (anchor.side) {
    case 'top':
      return {
        x: nodePosition.x + (width * offset),
        y: nodePosition.y,
      };
    case 'bottom':
      return {
        x: nodePosition.x + (width * offset),
        y: nodePosition.y + height,
      };
    case 'left':
      return {
        x: nodePosition.x,
        y: nodePosition.y + (height * offset),
      };
    case 'right':
    default:
      return {
        x: nodePosition.x + width,
        y: nodePosition.y + (height * offset),
      };
  }
}

function createAnchor(side: ConnectionAnchorSide, offset: number): ConnectionAnchor {
  return {
    side,
    offset: clampConnectionAnchorOffset(offset),
  };
}

export interface AnnotationEdgeDropTarget {
  anchor: ConnectionAnchor;
  point: Position;
  distance: number;
}

export function resolveAnnotationEdgeDropTarget(
  nodePosition: Position,
  width: number,
  height: number,
  pointer: Position,
  hitPadding: number
): AnnotationEdgeDropTarget | null {
  const candidates: AnnotationEdgeDropTarget[] = [];

  if (
    pointer.x >= nodePosition.x - hitPadding &&
    pointer.x <= nodePosition.x + width + hitPadding &&
    pointer.y >= nodePosition.y - hitPadding &&
    pointer.y <= nodePosition.y + hitPadding
  ) {
    const anchor = createAnchor('top', (pointer.x - nodePosition.x) / Math.max(width, 1));
    candidates.push({
      anchor,
      point: resolveConnectionAnchorPoint(nodePosition, width, height, anchor),
      distance: Math.abs(pointer.y - nodePosition.y),
    });
  }

  if (
    pointer.x >= nodePosition.x + width - hitPadding &&
    pointer.x <= nodePosition.x + width + hitPadding &&
    pointer.y >= nodePosition.y - hitPadding &&
    pointer.y <= nodePosition.y + height + hitPadding
  ) {
    const anchor = createAnchor('right', (pointer.y - nodePosition.y) / Math.max(height, 1));
    candidates.push({
      anchor,
      point: resolveConnectionAnchorPoint(nodePosition, width, height, anchor),
      distance: Math.abs(pointer.x - (nodePosition.x + width)),
    });
  }

  if (
    pointer.x >= nodePosition.x - hitPadding &&
    pointer.x <= nodePosition.x + width + hitPadding &&
    pointer.y >= nodePosition.y + height - hitPadding &&
    pointer.y <= nodePosition.y + height + hitPadding
  ) {
    const anchor = createAnchor('bottom', (pointer.x - nodePosition.x) / Math.max(width, 1));
    candidates.push({
      anchor,
      point: resolveConnectionAnchorPoint(nodePosition, width, height, anchor),
      distance: Math.abs(pointer.y - (nodePosition.y + height)),
    });
  }

  if (
    pointer.x >= nodePosition.x - hitPadding &&
    pointer.x <= nodePosition.x + hitPadding &&
    pointer.y >= nodePosition.y - hitPadding &&
    pointer.y <= nodePosition.y + height + hitPadding
  ) {
    const anchor = createAnchor('left', (pointer.y - nodePosition.y) / Math.max(height, 1));
    candidates.push({
      anchor,
      point: resolveConnectionAnchorPoint(nodePosition, width, height, anchor),
      distance: Math.abs(pointer.x - nodePosition.x),
    });
  }

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((left, right) => left.distance - right.distance);
  return candidates[0] ?? null;
}

export const resolveCardEdgeDropTarget = resolveAnnotationEdgeDropTarget;
