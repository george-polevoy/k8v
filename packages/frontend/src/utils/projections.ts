import { GraphNode, GraphProjection, Position } from '../types';

export const DEFAULT_GRAPH_PROJECTION_ID = 'default';
export const DEFAULT_GRAPH_PROJECTION_NAME = 'Default';

function clonePosition(position: Position): Position {
  return { x: position.x, y: position.y };
}

function buildNodePositionMap(nodes: GraphNode[]): Record<string, Position> {
  const map: Record<string, Position> = {};
  for (const node of nodes) {
    map[node.id] = clonePosition(node.position);
  }
  return map;
}

export function cloneProjectionNodePositions(
  nodes: GraphNode[],
  sourceProjection?: GraphProjection
): Record<string, Position> {
  const fallbackNodePositions = buildNodePositionMap(nodes);
  const cloned: Record<string, Position> = {};

  for (const [nodeId, fallbackPosition] of Object.entries(fallbackNodePositions)) {
    const candidate = sourceProjection?.nodePositions?.[nodeId];
    if (
      candidate &&
      Number.isFinite(candidate.x) &&
      Number.isFinite(candidate.y)
    ) {
      cloned[nodeId] = clonePosition(candidate);
      continue;
    }

    cloned[nodeId] = clonePosition(fallbackPosition);
  }

  return cloned;
}

function normalizeProjection(
  projection: GraphProjection,
  nodeFallbackPositions: Record<string, Position>
): GraphProjection {
  const normalizedNodePositions: Record<string, Position> = {};
  for (const [nodeId, fallbackPosition] of Object.entries(nodeFallbackPositions)) {
    const candidate = projection.nodePositions?.[nodeId];
    if (
      candidate &&
      Number.isFinite(candidate.x) &&
      Number.isFinite(candidate.y)
    ) {
      normalizedNodePositions[nodeId] = clonePosition(candidate);
    } else {
      normalizedNodePositions[nodeId] = clonePosition(fallbackPosition);
    }
  }

  return {
    id: projection.id,
    name: projection.name.trim() || projection.id,
    nodePositions: normalizedNodePositions,
  };
}

export function normalizeGraphProjectionState(
  nodes: GraphNode[],
  projections: GraphProjection[] | null | undefined,
  activeProjectionId: string | null | undefined
): { projections: GraphProjection[]; activeProjectionId: string } {
  const fallbackPositions = buildNodePositionMap(nodes);

  const deduped: GraphProjection[] = [];
  const seen = new Set<string>();
  for (const projection of projections ?? []) {
    if (!projection || typeof projection.id !== 'string' || !projection.id.trim()) {
      continue;
    }
    const id = projection.id.trim();
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    deduped.push(
      normalizeProjection(
        {
          ...projection,
          id,
          name: typeof projection.name === 'string' ? projection.name : id,
          nodePositions: projection.nodePositions ?? {},
        },
        fallbackPositions
      )
    );
  }

  if (!seen.has(DEFAULT_GRAPH_PROJECTION_ID)) {
    deduped.unshift({
      id: DEFAULT_GRAPH_PROJECTION_ID,
      name: DEFAULT_GRAPH_PROJECTION_NAME,
      nodePositions: fallbackPositions,
    });
  }

  const selectedActive = typeof activeProjectionId === 'string' && activeProjectionId.trim()
    ? activeProjectionId.trim()
    : DEFAULT_GRAPH_PROJECTION_ID;
  const normalizedActive = deduped.some((projection) => projection.id === selectedActive)
    ? selectedActive
    : DEFAULT_GRAPH_PROJECTION_ID;

  return {
    projections: deduped,
    activeProjectionId: normalizedActive,
  };
}

export function applyProjectionToNodes(
  nodes: GraphNode[],
  projection: GraphProjection
): GraphNode[] {
  return nodes.map((node) => {
    const projected = projection.nodePositions[node.id];
    if (!projected) {
      return node;
    }
    if (projected.x === node.position.x && projected.y === node.position.y) {
      return node;
    }
    return {
      ...node,
      position: clonePosition(projected),
    };
  });
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
