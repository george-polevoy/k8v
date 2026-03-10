import {
  normalizeCanvasBackground as normalizeSharedCanvasBackground,
} from '../../shared/src/canvasBackground.js';
import {
  normalizeGraphConnectionStroke,
} from '../../shared/src/connectionStroke.js';
import {
  resolveStandardNodeCardSize,
} from '../../shared/src/nodeCardGeometry.js';

const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;
export const DEFAULT_GRAPH_PROJECTION_ID = 'default';
export const DEFAULT_GRAPH_PROJECTION_NAME = 'Default';

export function normalizeDrawingColor(value: unknown, fallback = '#ffffff'): string {
  const fallbackColor = HEX_COLOR_PATTERN.test(String(fallback)) ? String(fallback).toLowerCase() : '#ffffff';
  if (typeof value !== 'string') {
    return fallbackColor;
  }

  const trimmed = value.trim().toLowerCase();
  if (trimmed === 'white') return '#ffffff';
  if (trimmed === 'green') return '#22c55e';
  if (trimmed === 'red') return '#ef4444';
  if (!HEX_COLOR_PATTERN.test(trimmed)) {
    return fallbackColor;
  }
  return trimmed;
}

export type RuntimeId = 'javascript_vm' | string;

export type NodeType =
  | 'inline_code'
  | 'library'
  | 'subgraph'
  | 'external_input'
  | 'numeric_input'
  | 'external_output'
  | 'annotation';

export interface DataSchema {
  type: string;
  [key: string]: unknown;
}

export interface PortDefinition {
  name: string;
  schema: DataSchema;
  description?: string;
}

export interface PythonEnvironment {
  name: string;
  pythonPath: string;
  cwd: string;
}

export interface DrawingPoint {
  x: number;
  y: number;
}

export type DrawingColor = string;

export interface DrawingPath {
  id: string;
  color: DrawingColor;
  thickness: number;
  points: DrawingPoint[];
}

export interface GraphDrawing {
  id: string;
  name: string;
  position: { x: number; y: number };
  paths: DrawingPath[];
}

export interface GraphNode {
  id: string;
  type: NodeType;
  position: { x: number; y: number };
  metadata: {
    name: string;
    description?: string;
    inputs: PortDefinition[];
    outputs: PortDefinition[];
    category?: string;
    version?: string;
  };
  config: {
    type: NodeType;
    code?: string;
    libraryId?: string;
    subgraphId?: string;
    runtime?: RuntimeId;
    pythonEnv?: string;
    config?: Record<string, unknown>;
  };
  version: string;
  lastComputed?: number;
}

export type ConnectionAnchorSide = 'top' | 'right' | 'bottom' | 'left';

export interface ConnectionAnchor {
  side: ConnectionAnchorSide;
  offset: number;
}

export interface Connection {
  id: string;
  sourceNodeId: string;
  sourcePort: string;
  sourceAnchor?: ConnectionAnchor;
  targetNodeId: string;
  targetPort: string;
  targetAnchor?: ConnectionAnchor;
}

export type CanvasBackgroundMode = 'solid' | 'gradient';

export interface CanvasBackground {
  mode: CanvasBackgroundMode;
  baseColor: string;
}

export interface GraphConnectionStrokeSettings {
  foregroundColor: string;
  backgroundColor: string;
  foregroundWidth: number;
  backgroundWidth: number;
}

export interface GraphProjection {
  id: string;
  name: string;
  nodePositions: Record<string, { x: number; y: number }>;
  nodeCardSizes: Record<string, { width: number; height: number }>;
  canvasBackground?: CanvasBackground;
}

export interface Graph {
  id: string;
  name: string;
  nodes: GraphNode[];
  connections: Connection[];
  canvasBackground?: CanvasBackground;
  connectionStroke?: GraphConnectionStrokeSettings;
  projections?: GraphProjection[];
  activeProjectionId?: string;
  pythonEnvs?: PythonEnvironment[];
  drawings?: GraphDrawing[];
  createdAt: number;
  updatedAt: number;
}

export interface RenderRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RenderBitmap {
  width: number;
  height: number;
}

function clonePosition(position: { x: number; y: number }): { x: number; y: number } {
  return {
    x: position.x,
    y: position.y,
  };
}

export function normalizeCanvasBackground(background: CanvasBackground | undefined): CanvasBackground {
  return normalizeSharedCanvasBackground(background);
}

function resolveNodeCardSizeForNode(node: GraphNode): { width: number; height: number } {
  const config = node.config.config as { cardWidth?: unknown; cardHeight?: unknown } | undefined;
  const resolved = resolveStandardNodeCardSize(
    config,
    node.metadata.inputs.length,
    node.metadata.outputs.length,
    node.type === 'numeric_input'
  );
  return {
    width: resolved.width,
    height: resolved.height,
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
    map[node.id] = resolveNodeCardSizeForNode(node);
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
    cloned[nodeId] = {
      width: fallbackNodeCardSize.width,
      height: fallbackNodeCardSize.height,
    };
  }

  return cloned;
}

export function normalizeGraphProjectionState(
  nodes: GraphNode[],
  projections: GraphProjection[] | undefined,
  activeProjectionId: string | undefined,
  fallbackCanvasBackground: CanvasBackground | undefined
): { projections: GraphProjection[]; activeProjectionId: string } {
  const fallbackNodePositions = buildNodePositionMap(nodes);
  const fallbackNodeCardSizes = buildNodeCardSizeMap(nodes);
  const fallbackBackground = normalizeCanvasBackground(fallbackCanvasBackground);
  const deduped: GraphProjection[] = [];
  const seen = new Set<string>();

  for (const projection of projections ?? []) {
    const projectionId = projection.id.trim();
    if (!projectionId || seen.has(projectionId)) {
      continue;
    }
    seen.add(projectionId);

    const nodePositions: Record<string, { x: number; y: number }> = {};
    const nodeCardSizes: Record<string, { width: number; height: number }> = {};
    for (const [nodeId, fallbackPosition] of Object.entries(fallbackNodePositions)) {
      const candidate = projection.nodePositions?.[nodeId];
      if (
        candidate &&
        Number.isFinite(candidate.x) &&
        Number.isFinite(candidate.y)
      ) {
        nodePositions[nodeId] = clonePosition(candidate);
      } else {
        nodePositions[nodeId] = clonePosition(fallbackPosition);
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
        nodeCardSizes[nodeId] = {
          width: Math.max(1, Math.round(sizeCandidate.width)),
          height: Math.max(1, Math.round(sizeCandidate.height)),
        };
      } else {
        nodeCardSizes[nodeId] = {
          width: fallbackNodeCardSize.width,
          height: fallbackNodeCardSize.height,
        };
      }
    }

    deduped.push({
      id: projectionId,
      name: projection.name.trim() || projectionId,
      nodePositions,
      nodeCardSizes,
      canvasBackground: normalizeCanvasBackground(projection.canvasBackground ?? fallbackBackground),
    });
  }

  if (!seen.has(DEFAULT_GRAPH_PROJECTION_ID)) {
    deduped.unshift({
      id: DEFAULT_GRAPH_PROJECTION_ID,
      name: DEFAULT_GRAPH_PROJECTION_NAME,
      nodePositions: fallbackNodePositions,
      nodeCardSizes: fallbackNodeCardSizes,
      canvasBackground: fallbackBackground,
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

  return {
    projections: deduped,
    activeProjectionId: normalizedActiveProjectionId,
  };
}

export function applyProjectionToNodes(nodes: GraphNode[], projection: GraphProjection): GraphNode[] {
  return nodes.map((node) => {
    const projected = projection.nodePositions[node.id];
    const projectedNodeCardSize = projection.nodeCardSizes[node.id] ?? resolveNodeCardSizeForNode(node);
    const nextConfig = {
      ...(node.config.config ?? {}),
      cardWidth: projectedNodeCardSize.width,
      cardHeight: projectedNodeCardSize.height,
    };
    const position = projected ?? node.position;
    if (
      node.position.x === position.x &&
      node.position.y === position.y &&
      node.config.config?.cardWidth === nextConfig.cardWidth &&
      node.config.config?.cardHeight === nextConfig.cardHeight
    ) {
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

export function normalizeGraph(graph: Graph): Graph {
  const canvasBackground = normalizeCanvasBackground(graph.canvasBackground);
  const drawings = Array.isArray(graph.drawings) ? graph.drawings : [];
  const projectionState = normalizeGraphProjectionState(
    graph.nodes,
    graph.projections,
    graph.activeProjectionId,
    canvasBackground
  );
  const activeProjection = projectionState.projections.find(
    (projection) => projection.id === projectionState.activeProjectionId
  ) ?? projectionState.projections[0];
  const projectedNodes = activeProjection
    ? applyProjectionToNodes(graph.nodes, activeProjection)
    : graph.nodes;
  const activeProjectionBackground = normalizeCanvasBackground(
    activeProjection?.canvasBackground ?? canvasBackground
  );

  return {
    ...graph,
    nodes: projectedNodes,
    canvasBackground: activeProjectionBackground,
    connectionStroke: normalizeGraphConnectionStroke(graph.connectionStroke),
    projections: projectionState.projections,
    activeProjectionId: projectionState.activeProjectionId,
    drawings: drawings.map((drawing) => ({
      ...drawing,
      paths: (drawing.paths ?? []).map((path) => ({
        ...path,
        color: normalizeDrawingColor(path.color, '#ffffff'),
      })),
    })),
    pythonEnvs: Array.isArray(graph.pythonEnvs) ? graph.pythonEnvs : [],
  };
}
