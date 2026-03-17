import {
  ComputationResult as ComputationResultSchema,
  materializeGraphProjectionState,
  normalizeGraphExecutionTimeoutMs,
  type ComputationResult as ComputationResultType,
  dedupeConnectionsByTargetSlot,
  type Graph,
  type GraphicsArtifact,
} from '../types';
import { normalizeGraphCameraState } from '../utils/cameras';
import { normalizeGraphConnectionStroke } from '../utils/connectionStroke';
import { normalizeHexColor } from '../utils/color';
import type {
  GraphSummary,
  NodeExecutionState,
  NodeGraphicsOutputMap,
  NodeResultMap,
} from './graphStoreTypes';

export const DEFAULT_DRAWING_COLOR = '#ffffff';

export const DEFAULT_NODE_EXECUTION_STATE: NodeExecutionState = {
  isPending: false,
  isComputing: false,
  hasError: false,
  isStale: false,
  errorMessage: null,
  lastRunAt: null,
};

export function resolveErrorMessage(error: unknown, fallback: string): string {
  const axiosError = error as {
    response?: { data?: { error?: unknown } };
    message?: unknown;
  };

  if (
    typeof axiosError.response?.data?.error === 'string' &&
    axiosError.response.data.error.trim()
  ) {
    return axiosError.response.data.error;
  }
  if (typeof axiosError.message === 'string' && axiosError.message.trim()) {
    return axiosError.message;
  }
  return fallback;
}

export function normalizeGraph(graph: Graph): Graph {
  const drawings = Array.isArray(graph.drawings) ? graph.drawings : [];
  const connections = Array.isArray(graph.connections)
    ? dedupeConnectionsByTargetSlot(graph.nodes, graph.connections)
    : [];
  const projectionState = materializeGraphProjectionState(
    graph.nodes,
    graph.projections,
    graph.activeProjectionId,
    graph.canvasBackground
  );

  return {
    ...graph,
    revision:
      typeof graph.revision === 'number' && Number.isFinite(graph.revision) && graph.revision >= 0
        ? graph.revision
        : 0,
    nodes: projectionState.nodes,
    connections,
    canvasBackground: projectionState.canvasBackground,
    projections: projectionState.projections,
    activeProjectionId: projectionState.activeProjectionId,
    executionTimeoutMs: normalizeGraphExecutionTimeoutMs(graph.executionTimeoutMs),
    connectionStroke: normalizeGraphConnectionStroke(graph.connectionStroke),
    cameras: normalizeGraphCameraState(graph.cameras),
    pythonEnvs: Array.isArray(graph.pythonEnvs) ? graph.pythonEnvs : [],
    drawings: drawings.map((drawing) => ({
      ...drawing,
      paths: (drawing.paths ?? []).map((path) => ({
        ...path,
        color: normalizeHexColor(path.color, DEFAULT_DRAWING_COLOR),
      })),
    })),
  };
}

export function buildNodeStateMapForGraph(
  graph: Graph,
  previous: Record<string, NodeExecutionState>
): Record<string, NodeExecutionState> {
  const nextStates: Record<string, NodeExecutionState> = {};
  for (const node of graph.nodes) {
    nextStates[node.id] = {
      ...DEFAULT_NODE_EXECUTION_STATE,
      ...(previous[node.id] ?? {}),
    };
  }
  return nextStates;
}

export function normalizeGraphicsOutput(graphics: unknown): GraphicsArtifact | null {
  if (!graphics || typeof graphics !== 'object') {
    return null;
  }

  const maybeGraphics = graphics as Partial<GraphicsArtifact>;
  if (typeof maybeGraphics.id !== 'string' || !maybeGraphics.id.trim()) {
    return null;
  }

  if (typeof maybeGraphics.mimeType !== 'string' || !maybeGraphics.mimeType.trim()) {
    return null;
  }

  if (!Array.isArray(maybeGraphics.levels) || maybeGraphics.levels.length === 0) {
    return null;
  }

  const normalizedLevels = maybeGraphics.levels
    .filter((level) =>
      level &&
      typeof level.level === 'number' &&
      Number.isFinite(level.level) &&
      typeof level.width === 'number' &&
      Number.isFinite(level.width) &&
      level.width > 0 &&
      typeof level.height === 'number' &&
      Number.isFinite(level.height) &&
      level.height > 0 &&
      typeof level.pixelCount === 'number' &&
      Number.isFinite(level.pixelCount) &&
      level.pixelCount > 0
    )
    .map((level) => ({
      level: Math.max(0, Math.floor(level.level)),
      width: Math.max(1, Math.floor(level.width)),
      height: Math.max(1, Math.floor(level.height)),
      pixelCount: Math.max(1, Math.floor(level.pixelCount)),
    }))
    .sort((left, right) => left.level - right.level);

  if (normalizedLevels.length === 0) {
    return null;
  }

  return {
    id: maybeGraphics.id.trim(),
    mimeType: maybeGraphics.mimeType.trim().toLowerCase(),
    levels: normalizedLevels,
  };
}

export function normalizeComputationResult(result: unknown): ComputationResultType | null {
  const parsed = ComputationResultSchema.safeParse(result);
  if (!parsed.success) {
    return null;
  }

  const normalizedGraphics = parsed.data.graphics
    ? normalizeGraphicsOutput(parsed.data.graphics)
    : null;

  return {
    ...parsed.data,
    ...(normalizedGraphics ? { graphics: normalizedGraphics } : {}),
  };
}

export function buildNodeGraphicsOutputMapForGraph(
  graph: Graph,
  previous: NodeGraphicsOutputMap
): NodeGraphicsOutputMap {
  const nextGraphicsOutputs: NodeGraphicsOutputMap = {};
  for (const node of graph.nodes) {
    nextGraphicsOutputs[node.id] = previous[node.id] ?? null;
  }
  return nextGraphicsOutputs;
}

export function buildNodeResultMapForGraph(
  graph: Graph,
  previous: NodeResultMap
): NodeResultMap {
  const nextResults: NodeResultMap = {};
  for (const node of graph.nodes) {
    nextResults[node.id] = previous[node.id] ?? null;
  }
  return nextResults;
}

export function normalizeBackendNodeExecutionState(
  value: Partial<NodeExecutionState> | undefined,
  fallback: NodeExecutionState
): NodeExecutionState {
  if (!value || typeof value !== 'object') {
    return fallback;
  }

  return {
    isPending: Boolean(value.isPending),
    isComputing: Boolean(value.isComputing),
    hasError: Boolean(value.hasError),
    isStale: Boolean(value.isStale),
    errorMessage: typeof value.errorMessage === 'string' ? value.errorMessage : null,
    lastRunAt: typeof value.lastRunAt === 'number' ? value.lastRunAt : fallback.lastRunAt,
  };
}

export function parseGraphSummariesResponse(data: unknown): GraphSummary[] {
  const maybeGraphs = (data as { graphs?: unknown })?.graphs;
  if (!Array.isArray(maybeGraphs)) {
    return [];
  }

  return maybeGraphs
    .filter((summary): summary is GraphSummary =>
      Boolean(summary) &&
      typeof summary === 'object' &&
      typeof summary.id === 'string' &&
      typeof summary.name === 'string' &&
      typeof summary.revision === 'number' &&
      typeof summary.updatedAt === 'number'
    )
    .sort((left, right) => right.updatedAt - left.updatedAt);
}
