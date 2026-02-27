import { DEFAULT_CANVAS_BACKGROUND, normalizeCanvasBackground } from './canvasBackground';
import {
  CanvasBackgroundSettings,
  GraphNode,
  GraphProjection,
  Position,
  ProjectionNodeCardSize,
  NodeType,
} from '../types';

export const DEFAULT_GRAPH_PROJECTION_ID = 'default';
export const DEFAULT_GRAPH_PROJECTION_NAME = 'Default';
const NODE_WIDTH = 220;
const MIN_NODE_HEIGHT = 68;
const HEADER_HEIGHT = 36;
const NODE_BODY_PADDING = 6;
const PORT_SPACING = 18;
const NUMERIC_INPUT_NODE_MIN_HEIGHT = 80;
const NODE_MIN_WIDTH = 180;
const ANNOTATION_NODE_MIN_WIDTH = 140;
const ANNOTATION_NODE_MIN_HEIGHT = 84;

function clonePosition(position: Position): Position {
  return { x: position.x, y: position.y };
}

function getNodeMinHeight(node: GraphNode): number {
  if (node.type === NodeType.ANNOTATION) {
    return ANNOTATION_NODE_MIN_HEIGHT;
  }
  const maxPorts = Math.max(node.metadata.inputs.length, node.metadata.outputs.length, 1);
  const baseHeight = Math.max(MIN_NODE_HEIGHT, HEADER_HEIGHT + NODE_BODY_PADDING + (maxPorts * PORT_SPACING));
  if (node.type === NodeType.NUMERIC_INPUT) {
    return Math.max(baseHeight, NUMERIC_INPUT_NODE_MIN_HEIGHT);
  }
  return baseHeight;
}

function getNodeMinWidth(node: GraphNode): number {
  if (node.type === NodeType.ANNOTATION) {
    return ANNOTATION_NODE_MIN_WIDTH;
  }
  return NODE_MIN_WIDTH;
}

function resolveNodeCardSizeFromNode(node: GraphNode): ProjectionNodeCardSize {
  const minHeight = getNodeMinHeight(node);
  const config = node.config.config as Record<string, unknown> | undefined;
  const rawWidth = typeof config?.cardWidth === 'number' && Number.isFinite(config.cardWidth)
    ? config.cardWidth
    : NODE_WIDTH;
  const rawHeight = typeof config?.cardHeight === 'number' && Number.isFinite(config.cardHeight)
    ? config.cardHeight
    : minHeight;

  return {
    width: Math.max(getNodeMinWidth(node), Math.round(rawWidth)),
    height: Math.max(minHeight, Math.round(rawHeight)),
  };
}

function cloneNodeCardSize(size: ProjectionNodeCardSize): ProjectionNodeCardSize {
  return {
    width: size.width,
    height: size.height,
  };
}

function buildNodePositionMap(nodes: GraphNode[]): Record<string, Position> {
  const map: Record<string, Position> = {};
  for (const node of nodes) {
    map[node.id] = clonePosition(node.position);
  }
  return map;
}

function buildNodeCardSizeMap(nodes: GraphNode[]): Record<string, ProjectionNodeCardSize> {
  const map: Record<string, ProjectionNodeCardSize> = {};
  for (const node of nodes) {
    map[node.id] = resolveNodeCardSizeFromNode(node);
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

export function cloneProjectionNodeCardSizes(
  nodes: GraphNode[],
  sourceProjection?: GraphProjection
): Record<string, ProjectionNodeCardSize> {
  const fallbackNodeCardSizes = buildNodeCardSizeMap(nodes);
  const cloned: Record<string, ProjectionNodeCardSize> = {};

  for (const [nodeId, fallbackNodeCardSize] of Object.entries(fallbackNodeCardSizes)) {
    const candidate = sourceProjection?.nodeCardSizes?.[nodeId];
    if (
      candidate &&
      Number.isFinite(candidate.width) &&
      candidate.width > 0 &&
      Number.isFinite(candidate.height) &&
      candidate.height > 0
    ) {
      cloned[nodeId] = {
        width: Math.max(1, Math.round(candidate.width)),
        height: Math.max(1, Math.round(candidate.height)),
      };
      continue;
    }

    cloned[nodeId] = cloneNodeCardSize(fallbackNodeCardSize);
  }

  return cloned;
}

function normalizeProjection(
  projection: GraphProjection,
  nodeFallbackPositions: Record<string, Position>,
  nodeFallbackCardSizes: Record<string, ProjectionNodeCardSize>,
  fallbackCanvasBackground: CanvasBackgroundSettings
): GraphProjection {
  const normalizedNodePositions: Record<string, Position> = {};
  const normalizedNodeCardSizes: Record<string, ProjectionNodeCardSize> = {};
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

    const fallbackNodeCardSize = nodeFallbackCardSizes[nodeId];
    const sizeCandidate = projection.nodeCardSizes?.[nodeId];
    if (
      sizeCandidate &&
      Number.isFinite(sizeCandidate.width) &&
      sizeCandidate.width > 0 &&
      Number.isFinite(sizeCandidate.height) &&
      sizeCandidate.height > 0
    ) {
      normalizedNodeCardSizes[nodeId] = {
        width: Math.max(1, Math.round(sizeCandidate.width)),
        height: Math.max(1, Math.round(sizeCandidate.height)),
      };
    } else {
      normalizedNodeCardSizes[nodeId] = cloneNodeCardSize(fallbackNodeCardSize);
    }
  }

  return {
    id: projection.id,
    name: projection.name.trim() || projection.id,
    nodePositions: normalizedNodePositions,
    nodeCardSizes: normalizedNodeCardSizes,
    canvasBackground: normalizeCanvasBackground(projection.canvasBackground ?? fallbackCanvasBackground),
  };
}

export function normalizeGraphProjectionState(
  nodes: GraphNode[],
  projections: GraphProjection[] | null | undefined,
  activeProjectionId: string | null | undefined,
  fallbackCanvasBackground?: CanvasBackgroundSettings | null
): { projections: GraphProjection[]; activeProjectionId: string } {
  const fallbackPositions = buildNodePositionMap(nodes);
  const fallbackNodeCardSizes = buildNodeCardSizeMap(nodes);
  const fallbackBackground = normalizeCanvasBackground(
    fallbackCanvasBackground ?? DEFAULT_CANVAS_BACKGROUND
  );

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
          nodeCardSizes: projection.nodeCardSizes ?? {},
          canvasBackground: projection.canvasBackground,
        },
        fallbackPositions,
        fallbackNodeCardSizes,
        fallbackBackground
      )
    );
  }

  if (!seen.has(DEFAULT_GRAPH_PROJECTION_ID)) {
    deduped.unshift({
      id: DEFAULT_GRAPH_PROJECTION_ID,
      name: DEFAULT_GRAPH_PROJECTION_NAME,
      nodePositions: fallbackPositions,
      nodeCardSizes: fallbackNodeCardSizes,
      canvasBackground: fallbackBackground,
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
    const projectedNodeCardSize = projection.nodeCardSizes[node.id] ?? resolveNodeCardSizeFromNode(node);
    const currentConfig = node.config.config ?? {};
    const nextConfig = {
      ...currentConfig,
      cardWidth: projectedNodeCardSize.width,
      cardHeight: projectedNodeCardSize.height,
    };
    const position = projected ?? node.position;

    const positionUnchanged = position.x === node.position.x && position.y === node.position.y;
    const sizeUnchanged = currentConfig.cardWidth === nextConfig.cardWidth &&
      currentConfig.cardHeight === nextConfig.cardHeight;
    if (positionUnchanged && sizeUnchanged) {
      return node;
    }

    return {
      ...node,
      position: clonePosition(position),
      config: {
        ...node.config,
        config: nextConfig,
      },
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
