import { v4 as uuidv4 } from 'uuid';
import {
  normalizeConnectionStrokeValue,
  normalizeGraphCameras,
  normalizeGraphProjections,
} from './graphNormalization.js';
import { validateGraphStructure } from './graphValidation.js';
import {
  type CanvasBackground,
  type Connection,
  DEFAULT_GRAPH_EXECUTION_TIMEOUT_MS,
  Graph,
  type Graph as GraphType,
  type GraphCamera,
  type GraphConnectionStroke,
  type GraphDrawing,
  type GraphNode,
  type GraphProjection,
  type PythonEnvironment,
} from '../types/index.js';

export interface CreateGraphDocumentInput {
  name: string;
  nodes: GraphNode[];
  connections: Connection[];
  recomputeConcurrency?: number;
  executionTimeoutMs?: number;
  canvasBackground?: CanvasBackground;
  connectionStroke?: GraphConnectionStroke;
  projections?: GraphProjection[];
  activeProjectionId?: string;
  cameras?: GraphCamera[];
  pythonEnvs?: PythonEnvironment[];
  drawings?: GraphDrawing[];
}

export class GraphDocumentValidationError extends Error {}

export function createGraphDocument(input: CreateGraphDocumentInput): GraphType {
  const projectionState = normalizeGraphProjections(
    input.nodes,
    input.projections,
    input.activeProjectionId,
    input.canvasBackground,
    input.canvasBackground
  );
  const now = Date.now();
  const graph: GraphType = {
    id: uuidv4(),
    name: input.name,
    revision: 0,
    nodes: projectionState.nodes,
    connections: input.connections,
    recomputeConcurrency: input.recomputeConcurrency ?? 1,
    executionTimeoutMs: input.executionTimeoutMs ?? DEFAULT_GRAPH_EXECUTION_TIMEOUT_MS,
    canvasBackground: projectionState.canvasBackground,
    connectionStroke: normalizeConnectionStrokeValue(input.connectionStroke),
    projections: projectionState.projections,
    activeProjectionId: projectionState.activeProjectionId,
    cameras: normalizeGraphCameras(input.cameras),
    pythonEnvs: input.pythonEnvs ?? [],
    drawings: input.drawings ?? [],
    createdAt: now,
    updatedAt: now,
  };

  const validationError = validateGraphStructure(graph);
  if (validationError) {
    throw new GraphDocumentValidationError(validationError);
  }

  return Graph.parse(graph);
}
