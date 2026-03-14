import {
  DEFAULT_CANVAS_BACKGROUND,
  DEFAULT_GRAPH_CONNECTION_STROKE,
  DEFAULT_GRAPH_PROJECTION_ID,
  DEFAULT_GRAPH_PROJECTION_NAME,
  type CanvasBackground,
  type GraphConnectionStroke,
  type GraphNode,
  type GraphProjection,
} from '../types/index.js';

const NODE_WIDTH = 220;
const NODE_MIN_WIDTH = 180;
const ANNOTATION_NODE_MIN_WIDTH = 140;
const MIN_NODE_HEIGHT = 68;
const ANNOTATION_NODE_MIN_HEIGHT = 84;
const HEADER_HEIGHT = 36;
const NODE_BODY_PADDING = 6;
const PORT_SPACING = 18;
const NUMERIC_INPUT_NODE_MIN_HEIGHT = 80;
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
const MIN_CONNECTION_STROKE_WIDTH = 0.25;
const MAX_CONNECTION_STROKE_WIDTH = 24;
const MIN_CONNECTION_BRIGHTNESS_DELTA = 24;
const CONNECTION_BRIGHTNESS_ADJUSTMENT = 42;

function buildProjectionNodePositionMap(nodes: GraphNode[]): Record<string, { x: number; y: number }> {
  const map: Record<string, { x: number; y: number }> = {};
  for (const node of nodes) {
    map[node.id] = {
      x: node.position.x,
      y: node.position.y,
    };
  }
  return map;
}

export function normalizeCanvasBackgroundValue(
  background: CanvasBackground | undefined
): CanvasBackground {
  const mode = background?.mode === 'solid' || background?.mode === 'gradient'
    ? background.mode
    : DEFAULT_CANVAS_BACKGROUND.mode;
  const baseColor = background?.baseColor && HEX_COLOR_PATTERN.test(background.baseColor)
    ? background.baseColor.toLowerCase()
    : DEFAULT_CANVAS_BACKGROUND.baseColor;
  return {
    mode,
    baseColor,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function toHexChannel(value: number): string {
  return clamp(Math.round(value), 0, 255).toString(16).padStart(2, '0');
}

function adjustHexBrightness(color: string, delta: number): string {
  const r = Number.parseInt(color.slice(1, 3), 16);
  const g = Number.parseInt(color.slice(3, 5), 16);
  const b = Number.parseInt(color.slice(5, 7), 16);
  return `#${toHexChannel(r + delta)}${toHexChannel(g + delta)}${toHexChannel(b + delta)}`;
}

function resolveBrightness(color: string): number {
  const r = Number.parseInt(color.slice(1, 3), 16);
  const g = Number.parseInt(color.slice(3, 5), 16);
  const b = Number.parseInt(color.slice(5, 7), 16);
  return (0.299 * r) + (0.587 * g) + (0.114 * b);
}

export function normalizeConnectionStrokeValue(
  stroke: GraphConnectionStroke | undefined
): GraphConnectionStroke {
  const foregroundColor = stroke?.foregroundColor && HEX_COLOR_PATTERN.test(stroke.foregroundColor)
    ? stroke.foregroundColor.toLowerCase()
    : DEFAULT_GRAPH_CONNECTION_STROKE.foregroundColor;

  const rawBackgroundColor = stroke?.backgroundColor && HEX_COLOR_PATTERN.test(stroke.backgroundColor)
    ? stroke.backgroundColor.toLowerCase()
    : DEFAULT_GRAPH_CONNECTION_STROKE.backgroundColor;

  const rawForegroundWidth = typeof stroke?.foregroundWidth === 'number' && Number.isFinite(stroke.foregroundWidth)
    ? stroke.foregroundWidth
    : Number.NaN;
  const rawBackgroundWidth = typeof stroke?.backgroundWidth === 'number' && Number.isFinite(stroke.backgroundWidth)
    ? stroke.backgroundWidth
    : Number.NaN;
  const inferredForegroundWidth = rawForegroundWidth > 0
    ? rawForegroundWidth
    : rawBackgroundWidth > 0
      ? rawBackgroundWidth * 0.5
      : DEFAULT_GRAPH_CONNECTION_STROKE.foregroundWidth;
  const foregroundWidth = clamp(
    inferredForegroundWidth,
    MIN_CONNECTION_STROKE_WIDTH,
    MAX_CONNECTION_STROKE_WIDTH
  );
  const backgroundWidth = foregroundWidth * 2;

  const foregroundBrightness = resolveBrightness(foregroundColor);
  const backgroundBrightness = resolveBrightness(rawBackgroundColor);
  const brightnessDelta = Math.abs(foregroundBrightness - backgroundBrightness);
  let backgroundColor = rawBackgroundColor;
  if (brightnessDelta < MIN_CONNECTION_BRIGHTNESS_DELTA) {
    const lighterCandidate = adjustHexBrightness(rawBackgroundColor, CONNECTION_BRIGHTNESS_ADJUSTMENT);
    const darkerCandidate = adjustHexBrightness(rawBackgroundColor, -CONNECTION_BRIGHTNESS_ADJUSTMENT);
    const lighterDelta = Math.abs(resolveBrightness(lighterCandidate) - foregroundBrightness);
    const darkerDelta = Math.abs(resolveBrightness(darkerCandidate) - foregroundBrightness);
    backgroundColor = lighterDelta >= darkerDelta ? lighterCandidate : darkerCandidate;

    if (Math.abs(resolveBrightness(backgroundColor) - foregroundBrightness) < MIN_CONNECTION_BRIGHTNESS_DELTA) {
      backgroundColor = foregroundBrightness >= 128 ? '#111827' : '#e2e8f0';
    }
  }

  return {
    foregroundColor,
    backgroundColor,
    foregroundWidth,
    backgroundWidth,
  };
}

function getNodeMinHeight(node: GraphNode): number {
  if (node.type === 'annotation') {
    return ANNOTATION_NODE_MIN_HEIGHT;
  }
  const maxPorts = Math.max(node.metadata.inputs.length, node.metadata.outputs.length, 1);
  const baseHeight = Math.max(MIN_NODE_HEIGHT, HEADER_HEIGHT + NODE_BODY_PADDING + (maxPorts * PORT_SPACING));
  if (node.type === 'numeric_input') {
    return Math.max(baseHeight, NUMERIC_INPUT_NODE_MIN_HEIGHT);
  }
  return baseHeight;
}

function getNodeMinWidth(node: GraphNode): number {
  if (node.type === 'annotation') {
    return ANNOTATION_NODE_MIN_WIDTH;
  }
  return NODE_MIN_WIDTH;
}

function buildProjectionNodeCardSizeMap(
  nodes: GraphNode[]
): Record<string, { width: number; height: number }> {
  const map: Record<string, { width: number; height: number }> = {};
  for (const node of nodes) {
    const nodeConfig = (node.config.config ?? {}) as Record<string, unknown>;
    const minHeight = getNodeMinHeight(node);
    const rawWidth = typeof nodeConfig.cardWidth === 'number' && Number.isFinite(nodeConfig.cardWidth)
      ? nodeConfig.cardWidth
      : NODE_WIDTH;
    const rawHeight = typeof nodeConfig.cardHeight === 'number' && Number.isFinite(nodeConfig.cardHeight)
      ? nodeConfig.cardHeight
      : minHeight;
    map[node.id] = {
      width: Math.max(getNodeMinWidth(node), Math.round(rawWidth)),
      height: Math.max(minHeight, Math.round(rawHeight)),
    };
  }
  return map;
}

export function syncActiveProjectionLayout(
  projections: GraphProjection[] | undefined,
  nodes: GraphNode[],
  activeProjectionId: string | undefined
): GraphProjection[] | undefined {
  if (!Array.isArray(projections) || projections.length === 0) {
    return projections;
  }

  const normalizedActiveProjectionId =
    typeof activeProjectionId === 'string' && activeProjectionId.trim()
      ? activeProjectionId.trim()
      : DEFAULT_GRAPH_PROJECTION_ID;
  const nodePositions = buildProjectionNodePositionMap(nodes);
  const nodeCardSizes = buildProjectionNodeCardSizeMap(nodes);

  return projections.map((projection) => (
    projection.id === normalizedActiveProjectionId
      ? {
          ...projection,
          nodePositions,
          nodeCardSizes,
        }
      : projection
  ));
}

export function normalizeGraphProjections(
  nodes: GraphNode[],
  projections: GraphProjection[] | undefined,
  activeProjectionId: string | undefined,
  fallbackCanvasBackground: CanvasBackground | undefined,
  activeCanvasBackgroundOverride?: CanvasBackground | undefined
): {
  projections: GraphProjection[];
  activeProjectionId: string;
  nodes: GraphNode[];
  canvasBackground: CanvasBackground;
} {
  const fallbackNodePositions = buildProjectionNodePositionMap(nodes);
  const fallbackNodeCardSizes = buildProjectionNodeCardSizeMap(nodes);
  const normalizedFallbackCanvasBackground = normalizeCanvasBackgroundValue(fallbackCanvasBackground);
  const deduped: GraphProjection[] = [];
  const seenProjectionIds = new Set<string>();

  for (const projection of projections ?? []) {
    const projectionId = projection.id.trim();
    if (!projectionId || seenProjectionIds.has(projectionId)) {
      continue;
    }
    seenProjectionIds.add(projectionId);

    const normalizedNodePositions: Record<string, { x: number; y: number }> = {};
    const normalizedNodeCardSizes: Record<string, { width: number; height: number }> = {};
    for (const [nodeId, fallbackPosition] of Object.entries(fallbackNodePositions)) {
      const candidate = projection.nodePositions?.[nodeId];
      if (
        candidate &&
        Number.isFinite(candidate.x) &&
        Number.isFinite(candidate.y)
      ) {
        normalizedNodePositions[nodeId] = {
          x: candidate.x,
          y: candidate.y,
        };
      } else {
        normalizedNodePositions[nodeId] = {
          x: fallbackPosition.x,
          y: fallbackPosition.y,
        };
      }

      const fallbackNodeCardSize = fallbackNodeCardSizes[nodeId];
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
        normalizedNodeCardSizes[nodeId] = {
          width: fallbackNodeCardSize.width,
          height: fallbackNodeCardSize.height,
        };
      }
    }

    deduped.push({
      ...projection,
      id: projectionId,
      name: projection.name.trim() || projectionId,
      nodePositions: normalizedNodePositions,
      nodeCardSizes: normalizedNodeCardSizes,
      canvasBackground: normalizeCanvasBackgroundValue(
        projection.canvasBackground ?? normalizedFallbackCanvasBackground
      ),
    });
  }

  if (!seenProjectionIds.has(DEFAULT_GRAPH_PROJECTION_ID)) {
    deduped.unshift({
      id: DEFAULT_GRAPH_PROJECTION_ID,
      name: DEFAULT_GRAPH_PROJECTION_NAME,
      nodePositions: fallbackNodePositions,
      nodeCardSizes: fallbackNodeCardSizes,
      canvasBackground: normalizedFallbackCanvasBackground,
    });
  }

  const selectedActiveProjectionId =
    typeof activeProjectionId === 'string' && activeProjectionId.trim()
      ? activeProjectionId.trim()
      : DEFAULT_GRAPH_PROJECTION_ID;
  const normalizedActiveProjectionId = deduped.some(
    (projection) => projection.id === selectedActiveProjectionId
  )
    ? selectedActiveProjectionId
    : DEFAULT_GRAPH_PROJECTION_ID;

  const activeProjectionIndex = deduped.findIndex(
    (projection) => projection.id === normalizedActiveProjectionId
  );
  if (activeProjectionIndex >= 0 && activeCanvasBackgroundOverride) {
    deduped[activeProjectionIndex] = {
      ...deduped[activeProjectionIndex],
      canvasBackground: normalizeCanvasBackgroundValue(activeCanvasBackgroundOverride),
    };
  }

  const activeProjection = deduped[activeProjectionIndex >= 0 ? activeProjectionIndex : 0];
  const activeCanvasBackground = normalizeCanvasBackgroundValue(
    activeProjection?.canvasBackground ?? normalizedFallbackCanvasBackground
  );
  const projectedNodes = nodes.map((node) => {
    const projectionPosition = activeProjection?.nodePositions[node.id];
    const projectionNodeCardSize = activeProjection?.nodeCardSizes[node.id];
    const configWithCardSize = {
      ...(node.config.config ?? {}),
      cardWidth: projectionNodeCardSize?.width ?? fallbackNodeCardSizes[node.id].width,
      cardHeight: projectionNodeCardSize?.height ?? fallbackNodeCardSizes[node.id].height,
    };

    return {
      ...node,
      position: projectionPosition
        ? { x: projectionPosition.x, y: projectionPosition.y }
        : node.position,
      config: {
        ...node.config,
        config: configWithCardSize,
      },
    };
  });

  return {
    projections: deduped,
    activeProjectionId: normalizedActiveProjectionId,
    nodes: projectedNodes,
    canvasBackground: activeCanvasBackground,
  };
}
