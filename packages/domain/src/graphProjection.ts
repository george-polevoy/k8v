import type {
  CanvasBackground,
  GraphNode,
  GraphProjection,
} from './index.js';

const DEFAULT_GRAPH_PROJECTION_ID = 'default';
const DEFAULT_GRAPH_PROJECTION_NAME = 'Default';
const DEFAULT_CANVAS_BACKGROUND: CanvasBackground = {
  mode: 'gradient',
  baseColor: '#1d437e',
};
const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;
const NODE_WIDTH = 220;
const MIN_NODE_HEIGHT = 68;
const HEADER_HEIGHT = 36;
const NODE_BODY_PADDING = 6;
const PORT_SPACING = 18;
const NUMERIC_INPUT_NODE_MIN_HEIGHT = 80;
const NODE_MIN_WIDTH = 180;
const ANNOTATION_NODE_MIN_WIDTH = 140;
const ANNOTATION_NODE_MIN_HEIGHT = 84;

function clonePosition(position: { x: number; y: number }): { x: number; y: number } {
  return {
    x: position.x,
    y: position.y,
  };
}

function cloneNodeCardSize(size: { width: number; height: number }): { width: number; height: number } {
  return {
    width: size.width,
    height: size.height,
  };
}

function normalizeCanvasBackgroundValue(
  background: CanvasBackground | null | undefined,
  fallback = DEFAULT_CANVAS_BACKGROUND
): CanvasBackground {
  const mode = background?.mode === 'solid' || background?.mode === 'gradient'
    ? background.mode
    : fallback.mode;
  const baseColor = typeof background?.baseColor === 'string' && HEX_COLOR_PATTERN.test(background.baseColor)
    ? background.baseColor.toLowerCase()
    : fallback.baseColor;
  return {
    mode,
    baseColor,
  };
}

function getNodeMinHeight(node: GraphNode): number {
  if (node.type === 'annotation') {
    return ANNOTATION_NODE_MIN_HEIGHT;
  }

  const maxPorts = Math.max(node.metadata.inputs.length, node.metadata.outputs.length, 1);
  const baseHeight = Math.max(
    MIN_NODE_HEIGHT,
    HEADER_HEIGHT + NODE_BODY_PADDING + (maxPorts * PORT_SPACING)
  );

  if (node.type === 'numeric_input') {
    return Math.max(baseHeight, NUMERIC_INPUT_NODE_MIN_HEIGHT);
  }

  return baseHeight;
}

function getNodeMinWidth(node: GraphNode): number {
  return node.type === 'annotation' ? ANNOTATION_NODE_MIN_WIDTH : NODE_MIN_WIDTH;
}

function resolveNodeCardSizeFromNode(node: GraphNode): { width: number; height: number } {
  const config = node.config;
  const minHeight = getNodeMinHeight(node);
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

function buildNodePositionMap(nodes: GraphNode[]): Record<string, { x: number; y: number }> {
  const map: Record<string, { x: number; y: number }> = {};
  for (const node of nodes) {
    map[node.id] = clonePosition(node.position);
  }
  return map;
}

function buildNodeCardSizeMap(
  nodes: GraphNode[]
): Record<string, { width: number; height: number }> {
  const map: Record<string, { width: number; height: number }> = {};
  for (const node of nodes) {
    map[node.id] = resolveNodeCardSizeFromNode(node);
  }
  return map;
}

export function cloneProjectionNodePositions(
  nodes: GraphNode[],
  sourceProjection?: GraphProjection
): Record<string, { x: number; y: number }> {
  const fallbackPositions = buildNodePositionMap(nodes);
  const cloned: Record<string, { x: number; y: number }> = {};

  for (const [nodeId, fallbackPosition] of Object.entries(fallbackPositions)) {
    const candidate = sourceProjection?.nodePositions?.[nodeId];
    if (candidate && Number.isFinite(candidate.x) && Number.isFinite(candidate.y)) {
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
): Record<string, { width: number; height: number }> {
  const fallbackNodeCardSizes = buildNodeCardSizeMap(nodes);
  const cloned: Record<string, { width: number; height: number }> = {};

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

export function normalizeGraphProjectionState(
  nodes: GraphNode[],
  projections: GraphProjection[] | null | undefined,
  activeProjectionId: string | null | undefined,
  fallbackCanvasBackground?: CanvasBackground | null
): { projections: GraphProjection[]; activeProjectionId: string } {
  const fallbackPositions = buildNodePositionMap(nodes);
  const fallbackNodeCardSizes = buildNodeCardSizeMap(nodes);
  const fallbackBackground = normalizeCanvasBackgroundValue(
    fallbackCanvasBackground,
    DEFAULT_CANVAS_BACKGROUND
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

    const normalizedNodePositions: Record<string, { x: number; y: number }> = {};
    const normalizedNodeCardSizes: Record<string, { width: number; height: number }> = {};
    for (const [nodeId, fallbackPosition] of Object.entries(fallbackPositions)) {
      const positionCandidate = projection.nodePositions?.[nodeId];
      normalizedNodePositions[nodeId] =
        positionCandidate &&
        Number.isFinite(positionCandidate.x) &&
        Number.isFinite(positionCandidate.y)
          ? clonePosition(positionCandidate)
          : clonePosition(fallbackPosition);

      const fallbackNodeCardSize = fallbackNodeCardSizes[nodeId];
      const sizeCandidate = projection.nodeCardSizes?.[nodeId];
      normalizedNodeCardSizes[nodeId] =
        sizeCandidate &&
        Number.isFinite(sizeCandidate.width) &&
        sizeCandidate.width > 0 &&
        Number.isFinite(sizeCandidate.height) &&
        sizeCandidate.height > 0
          ? {
              width: Math.max(1, Math.round(sizeCandidate.width)),
              height: Math.max(1, Math.round(sizeCandidate.height)),
            }
          : cloneNodeCardSize(fallbackNodeCardSize);
    }

    deduped.push({
      id,
      name: projection.name.trim() || id,
      nodePositions: normalizedNodePositions,
      nodeCardSizes: normalizedNodeCardSizes,
      canvasBackground: normalizeCanvasBackgroundValue(
        projection.canvasBackground ?? fallbackBackground,
        fallbackBackground
      ),
    });
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

  const selectedActiveProjectionId =
    typeof activeProjectionId === 'string' && activeProjectionId.trim()
      ? activeProjectionId.trim()
      : DEFAULT_GRAPH_PROJECTION_ID;

  return {
    projections: deduped,
    activeProjectionId: deduped.some((projection) => projection.id === selectedActiveProjectionId)
      ? selectedActiveProjectionId
      : DEFAULT_GRAPH_PROJECTION_ID,
  };
}

export function applyProjectionToNodes(
  nodes: GraphNode[],
  projection: GraphProjection
): GraphNode[] {
  return nodes.map((node) => {
    const projectedPosition = projection.nodePositions[node.id] ?? node.position;
    const projectedNodeCardSize =
      projection.nodeCardSizes[node.id] ?? resolveNodeCardSizeFromNode(node);
    const currentConfig = node.config;
    const nextCardWidth = projectedNodeCardSize.width;
    const nextCardHeight = projectedNodeCardSize.height;

    if (
      node.position.x === projectedPosition.x &&
      node.position.y === projectedPosition.y &&
      currentConfig.cardWidth === nextCardWidth &&
      currentConfig.cardHeight === nextCardHeight
    ) {
      return node;
    }

    switch (node.type) {
      case 'inline_code':
        return {
          ...node,
          position: clonePosition(projectedPosition),
          config: {
            ...node.config,
            cardWidth: nextCardWidth,
            cardHeight: nextCardHeight,
          },
        };
      case 'subgraph':
        return {
          ...node,
          position: clonePosition(projectedPosition),
          config: {
            ...node.config,
            cardWidth: nextCardWidth,
            cardHeight: nextCardHeight,
          },
        };
      case 'numeric_input':
        return {
          ...node,
          position: clonePosition(projectedPosition),
          config: {
            ...node.config,
            cardWidth: nextCardWidth,
            cardHeight: nextCardHeight,
          },
        };
      case 'annotation':
        return {
          ...node,
          position: clonePosition(projectedPosition),
          config: {
            ...node.config,
            cardWidth: nextCardWidth,
            cardHeight: nextCardHeight,
          },
        };
      default:
        return node;
    }
  });
}

export function materializeGraphProjectionState(
  nodes: GraphNode[],
  projections: GraphProjection[] | null | undefined,
  activeProjectionId: string | null | undefined,
  fallbackCanvasBackground?: CanvasBackground | null,
  activeCanvasBackgroundOverride?: CanvasBackground | null
): {
  projections: GraphProjection[];
  activeProjectionId: string;
  nodes: GraphNode[];
  canvasBackground: CanvasBackground;
} {
  const projectionState = normalizeGraphProjectionState(
    nodes,
    projections,
    activeProjectionId,
    fallbackCanvasBackground
  );

  const normalizedProjections = activeCanvasBackgroundOverride
    ? projectionState.projections.map((projection) => (
        projection.id === projectionState.activeProjectionId
          ? {
              ...projection,
              canvasBackground: normalizeCanvasBackgroundValue(
                activeCanvasBackgroundOverride,
                projection.canvasBackground
              ),
            }
          : projection
      ))
    : projectionState.projections;
  const activeProjection = normalizedProjections.find(
    (projection) => projection.id === projectionState.activeProjectionId
  ) ?? normalizedProjections[0];

  return {
    projections: normalizedProjections,
    activeProjectionId: projectionState.activeProjectionId,
    nodes: activeProjection ? applyProjectionToNodes(nodes, activeProjection) : nodes,
    canvasBackground: normalizeCanvasBackgroundValue(
      activeProjection?.canvasBackground ?? fallbackCanvasBackground,
      DEFAULT_CANVAS_BACKGROUND
    ),
  };
}

export function syncActiveProjectionLayout(
  projections: GraphProjection[] | null | undefined,
  nodes: GraphNode[],
  activeProjectionId: string | null | undefined
): GraphProjection[] | undefined {
  if (!Array.isArray(projections) || projections.length === 0) {
    return projections ?? undefined;
  }

  const normalizedActiveProjectionId =
    typeof activeProjectionId === 'string' && activeProjectionId.trim()
      ? activeProjectionId.trim()
      : DEFAULT_GRAPH_PROJECTION_ID;
  const nodePositions = buildNodePositionMap(nodes);
  const nodeCardSizes = buildNodeCardSizeMap(nodes);

  return projections.map((projection) =>
    projection.id === normalizedActiveProjectionId
      ? {
          ...projection,
          nodePositions,
          nodeCardSizes,
        }
      : projection
  );
}
