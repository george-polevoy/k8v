import type {
  Connection,
  ConnectionAnchor,
  ConnectionAnchorSide,
  GraphNode,
  Position,
} from '../types';
import { NodeType } from '../types';

export const ANNOTATION_CONNECTION_PORT = '__annotation__';

export function buildGraphNodeMap(nodes: GraphNode[]): Map<string, GraphNode> {
  return new Map(nodes.map((node) => [node.id, node]));
}

export function isAnnotationNode(node: Pick<GraphNode, 'type'> | null | undefined): boolean {
  return node?.type === NodeType.ANNOTATION;
}

export function isAnnotationConnection(
  connection: Connection,
  nodeById: ReadonlyMap<string, GraphNode>
): boolean {
  return (
    isAnnotationNode(nodeById.get(connection.sourceNodeId)) ||
    isAnnotationNode(nodeById.get(connection.targetNodeId))
  );
}

export function areConnectionAnchorsEqual(
  left: ConnectionAnchor | undefined,
  right: ConnectionAnchor | undefined
): boolean {
  if (left === right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }
  return left.side === right.side && Math.abs(left.offset - right.offset) < 1e-6;
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
