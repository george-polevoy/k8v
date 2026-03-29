import { ComputationResult, Graph } from '../types/index.js';
import { DataStore } from './DataStore.js';
import { GraphEventBroker } from './GraphEventBroker.js';
import { GraphEngine } from './GraphEngine.js';
import {
  buildGraphNodeMap,
  filterComputationalConnections,
} from './annotationConnections.js';
import {
  clampRecomputeConcurrency,
  collectChangedRootNodeIds,
  collectStaleNodeIdsFromErrorStates,
  isComputableNode,
  isErrorTextOutput,
  selectNodeIdsForTask,
  toErrorMessage,
} from './recompute/recomputePlanning.js';
import { RecomputeStateStore } from './recompute/RecomputeStateStore.js';
import type {
  GraphRecomputeStatus,
  GraphRuntimeState,
  NodeRunOutcome,
  RecomputeTask,
  RecomputeTaskSummary,
} from './recompute/recomputeTypes.js';

export type { BackendNodeExecutionState, GraphRecomputeStatus } from './recompute/recomputeTypes.js';

export class RecomputeManager {
  private readonly stateStore = new RecomputeStateStore();
  private nextManualRecomputeVersion = Date.now();

  constructor(
    private readonly dataStore: DataStore,
    private readonly graphEngine: GraphEngine,
    private readonly eventBroker?: GraphEventBroker
  ) {}

  queueGraphUpdateRecompute(previousGraph: Graph, nextGraph: Graph): void {
    const rootNodeIds = collectChangedRootNodeIds(previousGraph, nextGraph);
    if (rootNodeIds.length === 0) {
      return;
    }

    void this.enqueueTask(nextGraph.id, {
      type: 'graph_update',
      rootNodeIds,
      graphRevision: nextGraph.revision,
    }).catch(() => undefined);
  }

  async requestNodeRecompute(graphId: string, nodeId: string): Promise<ComputationResult> {
    const graph = await this.requireGraph(graphId);
    const node = graph.nodes.find((candidate) => candidate.id === nodeId);
    if (!node) {
      throw new Error(`Node ${nodeId} not found`);
    }
    if (!isComputableNode(node)) {
      throw new Error(`Node ${nodeId} is not executable`);
    }

    await this.enqueueTask(graphId, {
      type: 'manual_node',
      rootNodeIds: [nodeId],
    });

    const result = await this.dataStore.getResult(graph.id, nodeId, node.version);
    if (!result) {
      const graphState = this.stateStore.getOrCreateGraphState(graphId);
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
      rootNodeIds: graph.nodes
        .filter((node) => isComputableNode(node))
        .map((node) => node.id),
    });

    const results = new Map<string, ComputationResult>();
    const graphState = this.stateStore.getOrCreateGraphState(graphId);
    for (const node of graph.nodes) {
      const result = await this.dataStore.getResult(graph.id, node.id, node.version);
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
    const state = this.stateStore.getOrCreateGraphState(graphId);

    this.stateStore.synchronizeNodeStates(graph, state);

    return {
      graphId,
      statusVersion: state.statusVersion,
      queueLength: state.queue.length + (state.isProcessing ? 1 : 0),
      workerConcurrency: clampRecomputeConcurrency(graph.recomputeConcurrency),
      nodeStates: { ...state.nodeStates },
    };
  }

  dropGraphState(graphId: string): void {
    this.stateStore.dropGraphState(graphId);
  }

  private async enqueueTask(
    graphId: string,
    taskInput: {
      type: 'graph_update' | 'manual_node' | 'manual_graph';
      rootNodeIds: string[];
      graphRevision?: number;
    }
  ): Promise<RecomputeTaskSummary> {
    const previewGraph = await this.dataStore.getGraph(graphId) as Graph | null;
    const state = this.stateStore.getOrCreateGraphState(graphId);

    let resolveTask!: (summary: RecomputeTaskSummary) => void;
    let rejectTask!: (error: Error) => void;
    const taskPromise = new Promise<RecomputeTaskSummary>((resolve, reject) => {
      resolveTask = resolve;
      rejectTask = reject;
    });

    let graphUpdateRevision = taskInput.graphRevision;
    if (taskInput.type === 'graph_update') {
      graphUpdateRevision = previewGraph?.revision ?? graphUpdateRevision;
      if (typeof graphUpdateRevision === 'number') {
        const latestScheduledGraphUpdateRevision = this.getLatestScheduledGraphUpdateRevision(state);
        if (latestScheduledGraphUpdateRevision >= graphUpdateRevision) {
          resolveTask({
            scheduledNodeIds: [],
            completedNodeIds: [],
          });
          return await taskPromise;
        }
      }

      this.dropPendingGraphUpdateTasks(state);
    }

    state.queue.push({
      ...taskInput,
      graphRevision: graphUpdateRevision,
      recomputeVersion:
        taskInput.type === 'manual_graph' || taskInput.type === 'manual_node'
          ? this.nextManualRecomputeVersion++
          : undefined,
      resolve: resolveTask,
      reject: rejectTask,
    });

    if (previewGraph) {
      this.stateStore.synchronizeNodeStates(previewGraph, state);
      const changedNodeIds = await this.refreshQueuedPendingNodes(previewGraph, state);
      this.publishNodeUpdates(previewGraph, changedNodeIds);
    }

    this.kickoffGraphQueue(graphId);
    return await taskPromise;
  }

  private kickoffGraphQueue(graphId: string): void {
    const state = this.stateStore.getOrCreateGraphState(graphId);
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
          state.activeTaskNodeIds = [];
          state.activeTaskGraphRevision = null;
          task.resolve({
            scheduledNodeIds: [],
            completedNodeIds: [],
          });
          continue;
        }

        this.stateStore.synchronizeNodeStates(graph, state);

        const scheduledNodeIds = await this.resolveTaskNodeIds(graph, task);
        state.activeTaskNodeIds = [...scheduledNodeIds];
        state.activeTaskGraphRevision = task.type === 'graph_update'
          ? (task.graphRevision ?? graph.revision)
          : null;
        const changedNodeIds = new Set<string>(this.stateStore.markNodesPending(state, scheduledNodeIds));
        for (const nodeId of await this.refreshQueuedPendingNodes(graph, state)) {
          changedNodeIds.add(nodeId);
        }
        this.publishNodeUpdates(graph, [...changedNodeIds]);

        const completedNodeIds = await this.executeTaskNodes(
          graph,
          state,
          scheduledNodeIds,
          task.recomputeVersion
        );

        this.applyDerivedStaleStates(graph, state);
        this.publishTaskCompleted(graph, scheduledNodeIds, completedNodeIds);
        state.activeTaskNodeIds = [];
        state.activeTaskGraphRevision = null;
        this.publishNodeUpdates(graph, await this.refreshQueuedPendingNodes(graph, state));

        task.resolve({
          scheduledNodeIds,
          completedNodeIds,
        });
      } catch (error) {
        state.activeTaskNodeIds = [];
        state.activeTaskGraphRevision = null;
        task.reject(error instanceof Error ? error : new Error(String(error)));
      }
    }
  }

  private async executeTaskNodes(
    graph: Graph,
    state: GraphRuntimeState,
    orderedNodeIds: string[],
    recomputeVersion?: number
  ): Promise<string[]> {
    if (orderedNodeIds.length === 0) {
      return [];
    }

    const nodeSet = new Set(orderedNodeIds);
    const nodeById = buildGraphNodeMap(graph.nodes);
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

    for (const connection of filterComputationalConnections(graph.connections, nodeById)) {
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
      this.stateStore.patchNodeState(state, nodeId, {
        isPending: false,
        isComputing: false,
        hasError: false,
        isStale: true,
        errorMessage: null,
      });
      this.publishNodeUpdates(graph, [nodeId]);
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

        running.set(nodeId, this.runSingleNode(graph, state, nodeId, recomputeVersion));
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
        this.stateStore.patchNodeState(state, nodeId, {
          isPending: false,
          isComputing: false,
          hasError: false,
          isStale: true,
          errorMessage: null,
        });
        this.publishNodeUpdates(graph, [nodeId]);
        completedNodeSet.add(nodeId);
        completedNodeIds.push(nodeId);
      }
    }

    return completedNodeIds;
  }

  private async runSingleNode(
    graph: Graph,
    state: GraphRuntimeState,
    nodeId: string,
    recomputeVersion?: number
  ): Promise<NodeRunOutcome> {
    this.stateStore.patchNodeState(state, nodeId, {
      isPending: false,
      isComputing: true,
      hasError: false,
      isStale: false,
      errorMessage: null,
    });
    this.publishNodeUpdates(graph, [nodeId]);

    try {
      const result = await this.graphEngine.computeNode(graph, nodeId, { recomputeVersion });
      const hasError = isErrorTextOutput(result.textOutput);

      this.stateStore.patchNodeState(state, nodeId, {
        isPending: false,
        isComputing: false,
        hasError,
        isStale: false,
        errorMessage: hasError ? result.textOutput ?? 'Execution error' : null,
        lastRunAt: result.timestamp,
      });
      this.publishNodeUpdates(graph, [nodeId]);

      return {
        nodeId,
        success: !hasError,
      };
    } catch (error) {
      this.stateStore.patchNodeState(state, nodeId, {
        isPending: false,
        isComputing: false,
        hasError: true,
        isStale: false,
        errorMessage: toErrorMessage(error),
        lastRunAt: Date.now(),
      });
      this.publishNodeUpdates(graph, [nodeId]);

      return {
        nodeId,
        success: false,
      };
    }
  }

  private applyDerivedStaleStates(graph: Graph, state: GraphRuntimeState): string[] {
    const staleNodeIds = collectStaleNodeIdsFromErrorStates(graph, state.nodeStates);
    const changedNodeIds: string[] = [];

    for (const node of graph.nodes) {
      const currentState = state.nodeStates[node.id];
      const shouldBeStale =
        staleNodeIds.has(node.id) &&
        !currentState.hasError &&
        !currentState.isPending &&
        !currentState.isComputing;

      if (currentState.isStale !== shouldBeStale) {
        if (this.stateStore.patchNodeState(state, node.id, {
          isStale: shouldBeStale,
        })) {
          changedNodeIds.push(node.id);
        }
      }
    }

    return changedNodeIds;
  }

  private async requireGraph(graphId: string): Promise<Graph> {
    const graph = await this.dataStore.getGraph(graphId) as Graph | null;
    if (!graph) {
      throw new Error('Graph not found');
    }
    return graph;
  }

  private publishNodeUpdates(graph: Graph, nodeIds: string[]): void {
    if (!this.eventBroker) {
      return;
    }

    for (const nodeId of [...new Set(nodeIds)]) {
      this.eventBroker.publish({
        type: 'runtime.node.updated',
        graphId: graph.id,
        revision: graph.revision,
        nodeId,
      });
    }
  }

  private publishTaskCompleted(
    graph: Graph,
    scheduledNodeIds: string[],
    completedNodeIds: string[]
  ): void {
    if (!this.eventBroker) {
      return;
    }

    this.eventBroker.publish({
      type: 'runtime.task.completed',
      graphId: graph.id,
      revision: graph.revision,
      scheduledNodeIds,
      completedNodeIds,
    });
  }

  private dropPendingGraphUpdateTasks(state: GraphRuntimeState): void {
    if (state.queue.length === 0) {
      return;
    }

    const retainedQueue: RecomputeTask[] = [];
    for (const task of state.queue) {
      if (task.type === 'graph_update') {
        task.resolve({
          scheduledNodeIds: [],
          completedNodeIds: [],
        });
        continue;
      }
      retainedQueue.push(task);
    }

    state.queue = retainedQueue;
  }

  private getLatestScheduledGraphUpdateRevision(state: GraphRuntimeState): number {
    let latestRevision = state.activeTaskGraphRevision ?? -1;

    for (const task of state.queue) {
      if (task.type !== 'graph_update') {
        continue;
      }

      latestRevision = Math.max(latestRevision, task.graphRevision ?? -1);
    }

    return latestRevision;
  }

  private async refreshQueuedPendingNodes(graph: Graph, state: GraphRuntimeState): Promise<string[]> {
    const changedNodeIds = new Set<string>();
    const activePendingNodeIds = new Set(
      state.activeTaskNodeIds.filter((nodeId) => state.nodeStates[nodeId]?.isPending)
    );

    for (const node of graph.nodes) {
      const currentState = state.nodeStates[node.id];
      if (!currentState?.isPending || activePendingNodeIds.has(node.id)) {
        continue;
      }

      if (this.stateStore.patchNodeState(state, node.id, { isPending: false })) {
        changedNodeIds.add(node.id);
      }
    }

    for (const queuedTask of state.queue) {
      const queuedNodeIds = await this.resolveTaskNodeIds(graph, queuedTask);
      for (const nodeId of this.stateStore.markNodesPending(state, queuedNodeIds)) {
        changedNodeIds.add(nodeId);
      }
    }

    for (const nodeId of this.applyDerivedStaleStates(graph, state)) {
      changedNodeIds.add(nodeId);
    }

    return [...changedNodeIds];
  }

  private async resolveTaskNodeIds(graph: Graph, task: RecomputeTask): Promise<string[]> {
    if (task.type !== 'graph_update') {
      return selectNodeIdsForTask(graph, task.type, task.rootNodeIds);
    }

    return await this.resolveGraphUpdateNodeIds(graph);
  }

  private async resolveGraphUpdateNodeIds(graph: Graph): Promise<string[]> {
    const latestResults = await this.dataStore.listLatestResultsForGraph(graph.id);
    const orderedNodeIds = selectNodeIdsForTask(
      graph,
      'manual_graph',
      graph.nodes.map((node) => node.id)
    );
    const nodeById = buildGraphNodeMap(graph.nodes);
    const dependencyIdsByNodeId = new Map<string, string[]>();

    for (const nodeId of orderedNodeIds) {
      dependencyIdsByNodeId.set(nodeId, []);
    }

    for (const connection of filterComputationalConnections(graph.connections, nodeById)) {
      dependencyIdsByNodeId.get(connection.targetNodeId)?.push(connection.sourceNodeId);
    }

    const staleNodeIds = new Set<string>();
    const scheduledNodeIds = new Set<string>();

    for (const nodeId of orderedNodeIds) {
      const node = nodeById.get(nodeId);
      if (!node) {
        continue;
      }

      const currentResult = latestResults[nodeId] ?? null;
      let needsRecompute = !currentResult || currentResult.version !== node.version;
      if (!needsRecompute && currentResult) {
        for (const dependencyNodeId of dependencyIdsByNodeId.get(nodeId) ?? []) {
          const dependencyResult = latestResults[dependencyNodeId] ?? null;
          if (
            staleNodeIds.has(dependencyNodeId) ||
            !dependencyResult ||
            dependencyResult.timestamp > currentResult.timestamp
          ) {
            needsRecompute = true;
            break;
          }
        }
      }

      if (!needsRecompute) {
        continue;
      }

      staleNodeIds.add(nodeId);
      if (node.config.config?.autoRecompute) {
        scheduledNodeIds.add(nodeId);
      }
    }

    return orderedNodeIds.filter((nodeId) => scheduledNodeIds.has(nodeId));
  }
}
