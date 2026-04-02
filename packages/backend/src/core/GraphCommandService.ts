import {
  DEFAULT_GRAPH_EXECUTION_TIMEOUT_MS,
  Graph,
  applyGraphCommandMutation,
  type Graph as GraphType,
  type GraphCommand,
  type GraphRuntimeState,
} from '../types/index.js';
import { DataStore } from './DataStore.js';
import { GraphEventBroker } from './GraphEventBroker.js';
import { RecomputeManager } from './RecomputeManager.js';
import {
  getConnectionSignature,
  isPresentationConnection,
} from './annotationConnections.js';
import {
  normalizeConnectionStrokeValue,
  normalizeGraphCameras,
  normalizeGraphProjections,
  syncActiveProjectionLayout,
} from './graphNormalization.js';
import { validateGraphStructure } from './graphValidation.js';

export class GraphRevisionConflictError extends Error {
  constructor(public readonly currentRevision: number) {
    super('Graph revision conflict. Reload the latest graph and retry.');
  }
}

export class GraphCommandValidationError extends Error {}

export class GraphCommandService {
  constructor(
    private readonly dataStore: DataStore,
    private readonly recomputeManager: RecomputeManager,
    private readonly eventBroker: GraphEventBroker
  ) {}

  async executeCommands(
    graphId: string,
    baseRevision: number,
    commands: GraphCommand[],
    options: { noRecompute?: boolean } = {}
  ): Promise<{ graph: GraphType; runtimeState: GraphRuntimeState }> {
    const currentGraph = await this.dataStore.getGraph(graphId);
    if (!currentGraph) {
      throw new Error(`Graph ${graphId} not found`);
    }
    if (currentGraph.revision !== baseRevision) {
      throw new GraphRevisionConflictError(currentGraph.revision);
    }

    let persistedGraph = currentGraph;
    let workingGraph = structuredClone(currentGraph);
    let graphChanged = false;

    const flushGraph = async (): Promise<void> => {
      if (!graphChanged) {
        return;
      }

      const nextGraph = this.normalizeGraphForPersistence(persistedGraph, workingGraph);
      await this.dataStore.storeGraph(nextGraph);
      if (!options.noRecompute) {
        this.recomputeManager.queueGraphUpdateRecompute(persistedGraph, nextGraph);
      }
      this.eventBroker.publish({
        type: 'graph.revised',
        graphId: nextGraph.id,
        revision: nextGraph.revision,
        updatedAt: nextGraph.updatedAt,
      });
      persistedGraph = nextGraph;
      workingGraph = structuredClone(nextGraph);
      graphChanged = false;
    };

    for (const command of commands) {
      if (command.kind === 'compute_graph') {
        await flushGraph();
        await this.recomputeManager.requestGraphRecompute(graphId);
        continue;
      }

      if (command.kind === 'compute_node') {
        await flushGraph();
        await this.recomputeManager.requestNodeRecompute(graphId, command.nodeId);
        continue;
      }

      workingGraph = this.applyGraphMutation(workingGraph, command);
      graphChanged = true;
    }

    await flushGraph();

    return {
      graph: persistedGraph,
      runtimeState: await this.buildRuntimeState(persistedGraph),
    };
  }

  async buildRuntimeState(
    graph: GraphType,
    options: { sinceCursor?: string } = {}
  ): Promise<GraphRuntimeState> {
    const status = await this.recomputeManager.getGraphStatus(graph.id, {
      sinceCursor: options.sinceCursor,
    });
    const resultNodeIds = status.isSnapshot
      ? graph.nodes.map((node) => node.id)
      : status.changedResultNodeIds;
    const results = await this.dataStore.listLatestResultsForGraph(graph.id, resultNodeIds);
    return {
      graphId: graph.id,
      revision: graph.revision,
      statusVersion: status.statusVersion,
      cursor: status.cursor,
      queueLength: status.queueLength,
      workerConcurrency: status.workerConcurrency,
      nodeStates: status.nodeStates,
      results,
    };
  }

  private normalizeGraphForPersistence(previousGraph: GraphType, candidateGraph: GraphType): GraphType {
    const inboundConnectionChangedNodeIds = collectInboundConnectionChangedNodeIds(
      previousGraph.nodes,
      previousGraph.connections,
      candidateGraph.nodes,
      candidateGraph.connections
    );
    const projectionInput = syncActiveProjectionLayout(
      candidateGraph.projections,
      candidateGraph.nodes,
      candidateGraph.activeProjectionId
    );
    const projectionState = normalizeGraphProjections(
      candidateGraph.nodes,
      projectionInput,
      candidateGraph.activeProjectionId,
      candidateGraph.canvasBackground,
      candidateGraph.canvasBackground
    );

    const normalized: GraphType = {
      ...candidateGraph,
      revision: previousGraph.revision + 1,
      nodes: bumpNodeVersions(projectionState.nodes, inboundConnectionChangedNodeIds),
      projections: projectionState.projections,
      activeProjectionId: projectionState.activeProjectionId,
      canvasBackground: projectionState.canvasBackground,
      connectionStroke: normalizeConnectionStrokeValue(candidateGraph.connectionStroke),
      cameras: normalizeGraphCameras(candidateGraph.cameras),
      pythonEnvs: candidateGraph.pythonEnvs ?? [],
      drawings: candidateGraph.drawings ?? [],
      recomputeConcurrency: candidateGraph.recomputeConcurrency ?? 1,
      executionTimeoutMs:
        candidateGraph.executionTimeoutMs ?? DEFAULT_GRAPH_EXECUTION_TIMEOUT_MS,
      updatedAt: Date.now(),
    };

    const validationError = validateGraphStructure(normalized);
    if (validationError) {
      throw new GraphCommandValidationError(validationError);
    }

    return Graph.parse(normalized);
  }

  private applyGraphMutation(graph: GraphType, command: GraphCommand): GraphType {
    try {
      return applyGraphCommandMutation(graph, command);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new GraphCommandValidationError(message);
    }
  }
}

function collectInboundConnectionChangedNodeIds(
  previousNodes: GraphType['nodes'],
  previousConnections: GraphType['connections'],
  nextNodes: GraphType['nodes'],
  nextConnections: GraphType['connections']
): Set<string> {
  const previousByTarget = new Map<string, Set<string>>();
  for (const connection of previousConnections) {
    if (isPresentationConnection(connection)) {
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
    if (isPresentationConnection(connection)) {
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

function bumpNodeVersions(nodes: GraphType['nodes'], nodeIds: Set<string>): GraphType['nodes'] {
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
