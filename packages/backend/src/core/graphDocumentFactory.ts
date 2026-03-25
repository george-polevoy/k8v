import { v4 as uuidv4 } from 'uuid';
import {
  normalizeConnectionStrokeValue,
  normalizeGraphCameras,
  normalizeGraphProjections,
} from './graphNormalization.js';
import { validateGraphStructure } from './graphValidation.js';
import {
  DEFAULT_GRAPH_EXECUTION_TIMEOUT_MS,
  Graph,
  type Graph as GraphType,
} from '../types/index.js';

export interface CreateGraphDocumentInput {
  name: string;
}

export class GraphDocumentValidationError extends Error {}

export function createGraphDocument(input: CreateGraphDocumentInput): GraphType {
  const projectionState = normalizeGraphProjections(
    [],
    undefined,
    undefined,
    undefined,
    undefined
  );
  const now = Date.now();
  const graph: GraphType = {
    id: uuidv4(),
    name: input.name,
    revision: 0,
    nodes: projectionState.nodes,
    connections: [],
    recomputeConcurrency: 1,
    executionTimeoutMs: DEFAULT_GRAPH_EXECUTION_TIMEOUT_MS,
    canvasBackground: projectionState.canvasBackground,
    connectionStroke: normalizeConnectionStrokeValue(undefined),
    projections: projectionState.projections,
    activeProjectionId: projectionState.activeProjectionId,
    cameras: normalizeGraphCameras(undefined),
    pythonEnvs: [],
    algoInjections: [],
    drawings: [],
    createdAt: now,
    updatedAt: now,
  };

  const validationError = validateGraphStructure(graph);
  if (validationError) {
    throw new GraphDocumentValidationError(validationError);
  }

  return Graph.parse(graph);
}
