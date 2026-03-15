import { v4 as uuidv4 } from 'uuid';
import { DataStore } from './DataStore.js';
import { RecomputeManager } from './RecomputeManager.js';
import {
  normalizeConnectionStrokeValue,
  normalizeGraphCameras,
  normalizeGraphProjections,
  syncActiveProjectionLayout,
} from './graphNormalization.js';
import {
  buildGraphNodeMap,
  getConnectionSignature,
  isAnnotationLinkedConnection,
} from './annotationConnections.js';
import { validateGraphStructure } from './graphValidation.js';
import {
  CanvasBackground,
  Connection,
  DEFAULT_CANVAS_BACKGROUND,
  DEFAULT_GRAPH_EXECUTION_TIMEOUT_MS,
  Graph,
  GraphCamera,
  GraphConnectionStroke,
  GraphDrawing,
  GraphNode,
  GraphProjection,
  PythonEnvironment,
} from '../types/index.js';

export interface CreateGraphInput {
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

export interface UpdateGraphInput {
  name?: string;
  nodes?: GraphNode[];
  connections?: Connection[];
  recomputeConcurrency?: number;
  executionTimeoutMs?: number;
  canvasBackground?: CanvasBackground;
  connectionStroke?: GraphConnectionStroke;
  projections?: GraphProjection[];
  activeProjectionId?: string;
  cameras?: GraphCamera[];
  pythonEnvs?: PythonEnvironment[];
  drawings?: GraphDrawing[];
  ifMatchUpdatedAt?: number;
}

export class GraphNotFoundError extends Error {}

export class GraphConflictError extends Error {
  constructor(public readonly currentUpdatedAt: number) {
    super('Graph has changed since it was loaded. Reload and retry your update.');
  }
}

export class GraphWriteValidationError extends Error {}

export class GraphUpdateService {
  constructor(
    private readonly dataStore: DataStore,
    private readonly recomputeManager: RecomputeManager
  ) {}

  async createGraph(input: CreateGraphInput): Promise<Graph> {
    const projectionState = normalizeGraphProjections(
      input.nodes,
      input.projections,
      input.activeProjectionId,
      input.canvasBackground,
      input.canvasBackground
    );
    const now = Date.now();
    const graph: Graph = {
      id: uuidv4(),
      name: input.name,
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

    this.assertValidGraph(graph);
    await this.dataStore.storeGraph(graph);
    return graph;
  }

  async updateGraph(
    graphId: string,
    input: UpdateGraphInput,
    options?: { noRecompute?: boolean }
  ): Promise<Graph> {
    const existing = await this.dataStore.getGraph(graphId) as Graph | null;
    if (!existing) {
      throw new GraphNotFoundError(`Graph ${graphId} not found`);
    }

    const expectedUpdatedAt = input.ifMatchUpdatedAt;
    if (typeof expectedUpdatedAt === 'number' && expectedUpdatedAt !== existing.updatedAt) {
      throw new GraphConflictError(existing.updatedAt);
    }

    if (Array.isArray(input.projections) && input.projections.length === 0) {
      throw new GraphWriteValidationError('At least one projection must remain in the graph.');
    }

    const graphUpdates = { ...input } as Partial<Graph> & { ifMatchUpdatedAt?: number };
    delete graphUpdates.ifMatchUpdatedAt;

    const mergedNodes = input.nodes ?? existing.nodes;
    const mergedConnections = input.connections ?? existing.connections;
    const mergedCanvasBackground = input.canvasBackground ?? existing.canvasBackground ?? DEFAULT_CANVAS_BACKGROUND;
    const mergedConnectionStroke = input.connectionStroke ?? existing.connectionStroke;
    const inboundConnectionChangedNodeIds = input.connections
      ? collectInboundConnectionChangedNodeIds(existing.nodes, existing.connections, mergedNodes, mergedConnections)
      : new Set<string>();
    const projectionInput = input.projections ?? (
      input.nodes
        ? syncActiveProjectionLayout(
            existing.projections,
            mergedNodes,
            input.activeProjectionId ?? existing.activeProjectionId
          )
        : existing.projections
    );
    const projectionState = normalizeGraphProjections(
      mergedNodes,
      projectionInput,
      input.activeProjectionId ?? existing.activeProjectionId,
      mergedCanvasBackground,
      input.canvasBackground
    );
    const nextNodes = bumpNodeVersions(projectionState.nodes, inboundConnectionChangedNodeIds);
    const graph: Graph = {
      ...existing,
      ...graphUpdates,
      id: graphId,
      nodes: nextNodes,
      recomputeConcurrency: input.recomputeConcurrency ?? existing.recomputeConcurrency ?? 1,
      executionTimeoutMs:
        input.executionTimeoutMs ??
        existing.executionTimeoutMs ??
        DEFAULT_GRAPH_EXECUTION_TIMEOUT_MS,
      canvasBackground: projectionState.canvasBackground,
      connectionStroke: normalizeConnectionStrokeValue(mergedConnectionStroke),
      projections: projectionState.projections,
      activeProjectionId: projectionState.activeProjectionId,
      cameras: normalizeGraphCameras(input.cameras ?? existing.cameras),
      pythonEnvs: input.pythonEnvs ?? existing.pythonEnvs ?? [],
      drawings: input.drawings ?? existing.drawings ?? [],
      updatedAt: Date.now(),
    };

    this.assertValidGraph(graph);
    await this.dataStore.storeGraph(graph);
    if (!options?.noRecompute) {
      this.recomputeManager.queueGraphUpdateRecompute(existing, graph);
    }
    return graph;
  }

  private assertValidGraph(graph: Graph): void {
    const validationError = validateGraphStructure(graph);
    if (validationError) {
      throw new GraphWriteValidationError(validationError);
    }
  }
}

function collectInboundConnectionChangedNodeIds(
  previousNodes: GraphNode[],
  previousConnections: Connection[],
  nextNodes: GraphNode[],
  nextConnections: Connection[]
): Set<string> {
  const combinedNodeMap = buildGraphNodeMap([
    ...previousNodes,
    ...nextNodes,
  ]);
  const previousByTarget = new Map<string, Set<string>>();
  for (const connection of previousConnections) {
    if (isAnnotationLinkedConnection(connection, combinedNodeMap)) {
      continue;
    }
    const signature = getConnectionSignature(connection);
    const existing = previousByTarget.get(connection.targetNodeId);
    if (existing) {
      existing.add(signature);
    } else {
      previousByTarget.set(connection.targetNodeId, new Set([signature]));
    }
  }

  const nextByTarget = new Map<string, Set<string>>();
  for (const connection of nextConnections) {
    if (isAnnotationLinkedConnection(connection, combinedNodeMap)) {
      continue;
    }
    const signature = getConnectionSignature(connection);
    const existing = nextByTarget.get(connection.targetNodeId);
    if (existing) {
      existing.add(signature);
    } else {
      nextByTarget.set(connection.targetNodeId, new Set([signature]));
    }
  }

  const changedNodeIds = new Set<string>();
  const targetNodeIds = new Set<string>([
    ...previousByTarget.keys(),
    ...nextByTarget.keys(),
  ]);

  for (const targetNodeId of targetNodeIds) {
    const previous = previousByTarget.get(targetNodeId) ?? new Set<string>();
    const next = nextByTarget.get(targetNodeId) ?? new Set<string>();
    if (previous.size !== next.size) {
      changedNodeIds.add(targetNodeId);
      continue;
    }

    let differs = false;
    for (const signature of previous) {
      if (!next.has(signature)) {
        differs = true;
        break;
      }
    }

    if (differs) {
      changedNodeIds.add(targetNodeId);
    }
  }

  return changedNodeIds;
}

function bumpNodeVersions(nodes: GraphNode[], nodeIds: Set<string>): GraphNode[] {
  if (nodeIds.size === 0) {
    return nodes;
  }

  const versionPrefix = Date.now().toString();
  return nodes.map((node) => {
    if (!nodeIds.has(node.id)) {
      return node;
    }
    return {
      ...node,
      version: `${versionPrefix}-${node.id}`,
    };
  });
}
