import { ComputationResult, Connection, Graph, GraphNode } from '../types/index.js';
import { DataStore } from './DataStore.js';
import { GraphEngine } from './GraphEngine.js';

const DEFAULT_RECOMPUTE_CONCURRENCY = 1;
const MAX_RECOMPUTE_CONCURRENCY = 32;

export interface BackendNodeExecutionState {
  isPending: boolean;
  isComputing: boolean;
  hasError: boolean;
  isStale: boolean;
  errorMessage: string | null;
  lastRunAt: number | null;
}

export interface GraphRecomputeStatus {
  graphId: string;
  statusVersion: number;
  queueLength: number;
  workerConcurrency: number;
  nodeStates: Record<string, BackendNodeExecutionState>;
}

interface RecomputeTaskSummary {
  scheduledNodeIds: string[];
  completedNodeIds: string[];
}

type RecomputeTaskType = 'graph_update' | 'manual_node' | 'manual_graph';

interface RecomputeTask {
  type: RecomputeTaskType;
  rootNodeIds: string[];
  resolve: (summary: RecomputeTaskSummary) => void;
  reject: (error: Error) => void;
}

interface GraphRuntimeState {
  isProcessing: boolean;
  statusVersion: number;
  queue: RecomputeTask[];
  nodeStates: Record<string, BackendNodeExecutionState>;
}

interface NodeRunOutcome {
  nodeId: string;
  success: boolean;
}

const DEFAULT_NODE_STATE: BackendNodeExecutionState = {
  isPending: false,
  isComputing: false,
  hasError: false,
  isStale: false,
  errorMessage: null,
  lastRunAt: null,
};

function isErrorTextOutput(textOutput: unknown): boolean {
  return typeof textOutput === 'string' && /^\s*error:/i.test(textOutput.trim());
}

function toErrorMessage(error: unknown): string {
  if (typeof error === 'string' && error.trim()) {
    return error;
  }
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return 'Recomputation failed';
}

function connectionSignature(connection: Connection): string {
  return `${connection.sourceNodeId}:${connection.sourcePort}->${connection.targetNodeId}:${connection.targetPort}`;
}

function getAutoRecomputeEnabled(node: GraphNode): boolean {
  return Boolean(node.config.config?.autoRecompute);
}

function clampRecomputeConcurrency(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_RECOMPUTE_CONCURRENCY;
  }

  return Math.max(
    DEFAULT_RECOMPUTE_CONCURRENCY,
    Math.min(MAX_RECOMPUTE_CONCURRENCY, Math.floor(value))
  );
}

export class RecomputeManager {
  private readonly dataStore: DataStore;
  private readonly graphEngine: GraphEngine;
  private readonly graphStates = new Map<string, GraphRuntimeState>();

  constructor(dataStore: DataStore, graphEngine: GraphEngine) {
    this.dataStore = dataStore;
    this.graphEngine = graphEngine;
  }

  queueGraphUpdateRecompute(previousGraph: Graph, nextGraph: Graph): void {
    const rootNodeIds = this.collectChangedRootNodeIds(previousGraph, nextGraph);
    if (rootNodeIds.length === 0) {
      return;
    }

    void this.enqueueTask(nextGraph.id, {
      type: 'graph_update',
      rootNodeIds,
    }).catch(() => undefined);
  }

  async requestNodeRecompute(graphId: string, nodeId: string): Promise<ComputationResult> {
    const graph = await this.requireGraph(graphId);
    const node = graph.nodes.find((candidate) => candidate.id === nodeId);
    if (!node) {
      throw new Error(`Node ${nodeId} not found`);
    }

    await this.enqueueTask(graphId, {
      type: 'manual_node',
      rootNodeIds: [nodeId],
    });

    const result = await this.dataStore.getResult(nodeId, node.version);
    if (!result) {
      const graphState = this.getOrCreateGraphState(graphId);
      const nodeState = graphState.nodeStates[nodeId];
      if (nodeState?.hasError && nodeState.errorMessage) {
        throw new Error(nodeState.errorMessage);
      }
      throw new Error(`No computation result available for node ${nodeId}`);
    }

    return result;
  }

  async requestGraphRecompute(graphId: string): Promise<Map<string, ComputationResult>> {
    const graph = await this.requireGraph(graphId);

    await this.enqueueTask(graphId, {
      type: 'manual_graph',
      rootNodeIds: graph.nodes.map((node) => node.id),
    });

    const results = new Map<string, ComputationResult>();
    const graphState = this.getOrCreateGraphState(graphId);
    for (const node of graph.nodes) {
      const result = await this.dataStore.getResult(node.id, node.version);
      if (result) {
        results.set(node.id, result);
        continue;
      }

      const nodeState = graphState.nodeStates[node.id];
      if (nodeState?.hasError && nodeState.errorMessage) {
        throw new Error(nodeState.errorMessage);
      }
    }

    return results;
  }

  async getGraphStatus(graphId: string): Promise<GraphRecomputeStatus> {
    const graph = await this.requireGraph(graphId);
    const state = this.getOrCreateGraphState(graphId);

    this.synchronizeNodeStates(graph, state);

    return {
      graphId,
      statusVersion: state.statusVersion,
      queueLength: state.queue.length + (state.isProcessing ? 1 : 0),
      workerConcurrency: clampRecomputeConcurrency(graph.recomputeConcurrency),
      nodeStates: { ...state.nodeStates },
    };
  }

  dropGraphState(graphId: string): void {
    this.graphStates.delete(graphId);
  }

  private async enqueueTask(
    graphId: string,
    taskInput: { type: RecomputeTaskType; rootNodeIds: string[] }
  ): Promise<RecomputeTaskSummary> {
    const previewGraph = await this.dataStore.getGraph(graphId) as Graph | null;
    const state = this.getOrCreateGraphState(graphId);

    if (previewGraph) {
      this.synchronizeNodeStates(previewGraph, state);
      const previewNodeIds = this.selectNodeIdsForTask(
        previewGraph,
        taskInput.type,
        taskInput.rootNodeIds
      );
      this.markNodesPending(previewGraph.id, state, previewNodeIds);
      this.applyDerivedStaleStates(previewGraph, state);
    }

    return await new Promise<RecomputeTaskSummary>((resolve, reject) => {
      state.queue.push({
        ...taskInput,
        resolve,
        reject,
      });
      this.kickoffGraphQueue(graphId);
    });
  }

  private kickoffGraphQueue(graphId: string): void {
    const state = this.getOrCreateGraphState(graphId);
    if (state.isProcessing) {
      return;
    }

    state.isProcessing = true;

    void this.processGraphQueue(graphId, state)
      .catch((error) => {
        console.error(`Recompute queue failed for graph ${graphId}:`, error);
      })
      .finally(() => {
        state.isProcessing = false;
        if (state.queue.length > 0) {
          this.kickoffGraphQueue(graphId);
        }
      });
  }

  private async processGraphQueue(graphId: string, state: GraphRuntimeState): Promise<void> {
    while (state.queue.length > 0) {
      const task = state.queue.shift();
      if (!task) {
        continue;
      }

      try {
        const graph = await this.dataStore.getGraph(graphId) as Graph | null;
        if (!graph) {
          task.resolve({
            scheduledNodeIds: [],
            completedNodeIds: [],
          });
          continue;
        }

        this.synchronizeNodeStates(graph, state);

        const scheduledNodeIds = this.selectNodeIdsForTask(graph, task.type, task.rootNodeIds);
        this.markNodesPending(graph.id, state, scheduledNodeIds);

        const completedNodeIds = await this.executeTaskNodes(graph, state, scheduledNodeIds);

        this.applyDerivedStaleStates(graph, state);

        task.resolve({
          scheduledNodeIds,
          completedNodeIds,
        });
      } catch (error) {
        task.reject(error instanceof Error ? error : new Error(String(error)));
      }
    }
  }

  private async executeTaskNodes(
    graph: Graph,
    state: GraphRuntimeState,
    orderedNodeIds: string[]
  ): Promise<string[]> {
    if (orderedNodeIds.length === 0) {
      return [];
    }

    const nodeSet = new Set(orderedNodeIds);
    const outgoing = new Map<string, string[]>();
    const remainingDependencyCount = new Map<string, number>();
    const blockedByErrorCount = new Map<string, number>();
    const completedNodeIds: string[] = [];
    const completedNodeSet = new Set<string>();

    for (const nodeId of orderedNodeIds) {
      outgoing.set(nodeId, []);
      remainingDependencyCount.set(nodeId, 0);
      blockedByErrorCount.set(nodeId, 0);
    }

    for (const connection of graph.connections) {
      if (!nodeSet.has(connection.sourceNodeId) || !nodeSet.has(connection.targetNodeId)) {
        continue;
      }

      outgoing.get(connection.sourceNodeId)?.push(connection.targetNodeId);
      remainingDependencyCount.set(
        connection.targetNodeId,
        (remainingDependencyCount.get(connection.targetNodeId) ?? 0) + 1
      );
    }

    const readyQueue = orderedNodeIds.filter(
      (nodeId) => (remainingDependencyCount.get(nodeId) ?? 0) === 0
    );
    const readySet = new Set<string>(readyQueue);
    const running = new Map<string, Promise<NodeRunOutcome>>();
    const workerConcurrency = clampRecomputeConcurrency(graph.recomputeConcurrency);

    const enqueueIfReady = (nodeId: string) => {
      if (completedNodeSet.has(nodeId) || running.has(nodeId) || readySet.has(nodeId)) {
        return;
      }

      if ((remainingDependencyCount.get(nodeId) ?? 0) === 0) {
        readyQueue.push(nodeId);
        readySet.add(nodeId);
      }
    };

    const propagateCompletion = (nodeId: string, success: boolean) => {
      if (completedNodeSet.has(nodeId)) {
        return;
      }

      completedNodeSet.add(nodeId);
      completedNodeIds.push(nodeId);

      if (!success) {
        for (const downstreamId of outgoing.get(nodeId) ?? []) {
          blockedByErrorCount.set(
            downstreamId,
            (blockedByErrorCount.get(downstreamId) ?? 0) + 1
          );
        }
      }

      for (const downstreamId of outgoing.get(nodeId) ?? []) {
        const remaining = (remainingDependencyCount.get(downstreamId) ?? 0) - 1;
        remainingDependencyCount.set(downstreamId, remaining);
        if (remaining <= 0) {
          enqueueIfReady(downstreamId);
        }
      }
    };

    const markSkippedNode = (nodeId: string) => {
      this.patchNodeState(graph.id, state, nodeId, {
        isPending: false,
        isComputing: false,
        hasError: false,
        isStale: true,
        errorMessage: null,
      });
      propagateCompletion(nodeId, false);
    };

    const launchReadyNodes = () => {
      while (running.size < workerConcurrency && readyQueue.length > 0) {
        const nodeId = readyQueue.shift();
        if (!nodeId) {
          continue;
        }

        readySet.delete(nodeId);

        if ((blockedByErrorCount.get(nodeId) ?? 0) > 0) {
          markSkippedNode(nodeId);
          continue;
        }

        running.set(nodeId, this.runSingleNode(graph, state, nodeId));
      }
    };

    launchReadyNodes();

    while (running.size > 0) {
      const settled = await Promise.race(
        Array.from(running.entries()).map(async ([runningNodeId, promise]) => ({
          runningNodeId,
          outcome: await promise,
        }))
      );

      running.delete(settled.runningNodeId);
      propagateCompletion(settled.outcome.nodeId, settled.outcome.success);
      launchReadyNodes();
    }

    for (const nodeId of orderedNodeIds) {
      if (!completedNodeSet.has(nodeId)) {
        this.patchNodeState(graph.id, state, nodeId, {
          isPending: false,
          isComputing: false,
          hasError: false,
          isStale: true,
          errorMessage: null,
        });
        completedNodeSet.add(nodeId);
        completedNodeIds.push(nodeId);
      }
    }

    return completedNodeIds;
  }

  private async runSingleNode(
    graph: Graph,
    state: GraphRuntimeState,
    nodeId: string
  ): Promise<NodeRunOutcome> {
    this.patchNodeState(graph.id, state, nodeId, {
      isPending: false,
      isComputing: true,
      hasError: false,
      isStale: false,
      errorMessage: null,
    });

    try {
      const result = await this.graphEngine.computeNode(graph, nodeId);
      const hasError = isErrorTextOutput(result.textOutput);

      this.patchNodeState(graph.id, state, nodeId, {
        isPending: false,
        isComputing: false,
        hasError,
        isStale: false,
        errorMessage: hasError ? result.textOutput ?? 'Execution error' : null,
        lastRunAt: result.timestamp,
      });

      return {
        nodeId,
        success: !hasError,
      };
    } catch (error) {
      this.patchNodeState(graph.id, state, nodeId, {
        isPending: false,
        isComputing: false,
        hasError: true,
        isStale: false,
        errorMessage: toErrorMessage(error),
        lastRunAt: Date.now(),
      });

      return {
        nodeId,
        success: false,
      };
    }
  }

  private markNodesPending(graphId: string, state: GraphRuntimeState, nodeIds: string[]): void {
    for (const nodeId of nodeIds) {
      this.patchNodeState(graphId, state, nodeId, {
        isPending: true,
        isComputing: false,
        hasError: false,
        isStale: false,
        errorMessage: null,
      });
    }
  }

  private selectNodeIdsForTask(
    graph: Graph,
    type: RecomputeTaskType,
    rootNodeIds: string[]
  ): string[] {
    if (type === 'manual_graph') {
      return this.topologicalSortNodeIds(graph);
    }

    const graphNodeIds = new Set(graph.nodes.map((node) => node.id));
    const normalizedRoots = [...new Set(rootNodeIds)].filter((nodeId) => graphNodeIds.has(nodeId));

    if (normalizedRoots.length === 0) {
      return [];
    }

    const impactedNodeIds = this.collectImpactedDescendants(graph, normalizedRoots);
    const selectedNodeIds = new Set<string>();

    if (type === 'graph_update') {
      for (const node of graph.nodes) {
        if (impactedNodeIds.has(node.id) && getAutoRecomputeEnabled(node)) {
          selectedNodeIds.add(node.id);
        }
      }
    } else {
      for (const rootNodeId of normalizedRoots) {
        selectedNodeIds.add(rootNodeId);
      }

      for (const node of graph.nodes) {
        if (impactedNodeIds.has(node.id) && getAutoRecomputeEnabled(node)) {
          selectedNodeIds.add(node.id);
        }
      }
    }

    return this.topologicalSortNodeIds(graph).filter((nodeId) => selectedNodeIds.has(nodeId));
  }

  private collectImpactedDescendants(graph: Graph, roots: string[]): Set<string> {
    const outgoing = this.buildOutgoingAdjacency(graph);
    const queue = [...roots];
    const visited = new Set<string>();

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current || visited.has(current)) {
        continue;
      }

      visited.add(current);

      for (const downstreamNodeId of outgoing.get(current) ?? []) {
        if (!visited.has(downstreamNodeId)) {
          queue.push(downstreamNodeId);
        }
      }
    }

    return visited;
  }

  private topologicalSortNodeIds(graph: Graph): string[] {
    const nodeOrder = new Map(graph.nodes.map((node, index) => [node.id, index]));
    const inDegree = new Map<string, number>();
    const outgoing = new Map<string, string[]>();

    for (const node of graph.nodes) {
      inDegree.set(node.id, 0);
      outgoing.set(node.id, []);
    }

    for (const connection of graph.connections) {
      if (!inDegree.has(connection.sourceNodeId) || !inDegree.has(connection.targetNodeId)) {
        continue;
      }

      outgoing.get(connection.sourceNodeId)?.push(connection.targetNodeId);
      inDegree.set(
        connection.targetNodeId,
        (inDegree.get(connection.targetNodeId) ?? 0) + 1
      );
    }

    const queue = graph.nodes
      .map((node) => node.id)
      .filter((nodeId) => (inDegree.get(nodeId) ?? 0) === 0)
      .sort((left, right) => (nodeOrder.get(left) ?? 0) - (nodeOrder.get(right) ?? 0));

    const ordered: string[] = [];

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) {
        continue;
      }

      ordered.push(current);

      for (const downstreamNodeId of outgoing.get(current) ?? []) {
        const nextDegree = (inDegree.get(downstreamNodeId) ?? 0) - 1;
        inDegree.set(downstreamNodeId, nextDegree);
        if (nextDegree === 0) {
          queue.push(downstreamNodeId);
          queue.sort((left, right) => (nodeOrder.get(left) ?? 0) - (nodeOrder.get(right) ?? 0));
        }
      }
    }

    if (ordered.length !== graph.nodes.length) {
      return graph.nodes.map((node) => node.id);
    }

    return ordered;
  }

  private buildOutgoingAdjacency(graph: Graph): Map<string, string[]> {
    const outgoing = new Map<string, string[]>();

    for (const node of graph.nodes) {
      outgoing.set(node.id, []);
    }

    for (const connection of graph.connections) {
      outgoing.get(connection.sourceNodeId)?.push(connection.targetNodeId);
    }

    return outgoing;
  }

  private applyDerivedStaleStates(graph: Graph, state: GraphRuntimeState): void {
    const outgoing = this.buildOutgoingAdjacency(graph);
    const queue: string[] = [];
    const visited = new Set<string>();
    const staleNodeIds = new Set<string>();

    for (const node of graph.nodes) {
      const nodeState = state.nodeStates[node.id] ?? DEFAULT_NODE_STATE;
      if (nodeState.hasError) {
        queue.push(node.id);
        visited.add(node.id);
      }
    }

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) {
        continue;
      }

      for (const downstreamNodeId of outgoing.get(current) ?? []) {
        if (!visited.has(downstreamNodeId)) {
          visited.add(downstreamNodeId);
          queue.push(downstreamNodeId);
        }

        staleNodeIds.add(downstreamNodeId);
      }
    }

    for (const node of graph.nodes) {
      const currentState = state.nodeStates[node.id] ?? { ...DEFAULT_NODE_STATE };
      const shouldBeStale =
        staleNodeIds.has(node.id) &&
        !currentState.hasError &&
        !currentState.isPending &&
        !currentState.isComputing;

      if (currentState.isStale !== shouldBeStale) {
        this.patchNodeState(graph.id, state, node.id, {
          isStale: shouldBeStale,
        });
      }
    }
  }

  private collectChangedRootNodeIds(previousGraph: Graph, nextGraph: Graph): string[] {
    const previousNodeMap = new Map(previousGraph.nodes.map((node) => [node.id, node]));
    const nextNodeMap = new Map(nextGraph.nodes.map((node) => [node.id, node]));
    const rootNodeIds = new Set<string>();

    for (const nextNode of nextGraph.nodes) {
      const previousNode = previousNodeMap.get(nextNode.id);
      if (!previousNode || previousNode.version !== nextNode.version) {
        rootNodeIds.add(nextNode.id);
      }
    }

    const previousConnections = new Set(previousGraph.connections.map(connectionSignature));
    const nextConnections = new Set(nextGraph.connections.map(connectionSignature));

    for (const connection of nextGraph.connections) {
      const signature = connectionSignature(connection);
      if (previousConnections.has(signature)) {
        continue;
      }

      rootNodeIds.add(connection.sourceNodeId);
      rootNodeIds.add(connection.targetNodeId);
    }

    for (const connection of previousGraph.connections) {
      const signature = connectionSignature(connection);
      if (nextConnections.has(signature)) {
        continue;
      }

      if (nextNodeMap.has(connection.sourceNodeId)) {
        rootNodeIds.add(connection.sourceNodeId);
      }
      if (nextNodeMap.has(connection.targetNodeId)) {
        rootNodeIds.add(connection.targetNodeId);
      }
    }

    return [...rootNodeIds].filter((nodeId) => nextNodeMap.has(nodeId));
  }

  private synchronizeNodeStates(graph: Graph, state: GraphRuntimeState): void {
    const nextStates: Record<string, BackendNodeExecutionState> = {};

    for (const node of graph.nodes) {
      nextStates[node.id] = {
        ...DEFAULT_NODE_STATE,
        ...(state.nodeStates[node.id] ?? {}),
      };
    }

    const previousNodeIds = Object.keys(state.nodeStates);
    const nextNodeIds = Object.keys(nextStates);

    const changedShape =
      previousNodeIds.length !== nextNodeIds.length ||
      previousNodeIds.some((nodeId) => !(nodeId in nextStates));

    if (changedShape) {
      state.nodeStates = nextStates;
      state.statusVersion += 1;
      return;
    }

    state.nodeStates = nextStates;
  }

  private patchNodeState(
    _graphId: string,
    state: GraphRuntimeState,
    nodeId: string,
    patch: Partial<BackendNodeExecutionState>
  ): void {
    const previousState = state.nodeStates[nodeId] ?? { ...DEFAULT_NODE_STATE };
    const nextState: BackendNodeExecutionState = {
      ...previousState,
      ...patch,
    };

    const changed =
      previousState.isPending !== nextState.isPending ||
      previousState.isComputing !== nextState.isComputing ||
      previousState.hasError !== nextState.hasError ||
      previousState.isStale !== nextState.isStale ||
      previousState.errorMessage !== nextState.errorMessage ||
      previousState.lastRunAt !== nextState.lastRunAt;

    if (!changed) {
      return;
    }

    state.nodeStates[nodeId] = nextState;
    state.statusVersion += 1;
  }

  private getOrCreateGraphState(graphId: string): GraphRuntimeState {
    const existing = this.graphStates.get(graphId);
    if (existing) {
      return existing;
    }

    const created: GraphRuntimeState = {
      isProcessing: false,
      statusVersion: 0,
      queue: [],
      nodeStates: {},
    };

    this.graphStates.set(graphId, created);
    return created;
  }

  private async requireGraph(graphId: string): Promise<Graph> {
    const graph = await this.dataStore.getGraph(graphId) as Graph | null;
    if (!graph) {
      throw new Error('Graph not found');
    }
    return graph;
  }
}
