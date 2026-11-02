import { Graph, GraphNode, ComputationResult } from '../types/index.js';
import { DataStore } from './DataStore.js';
import { NodeExecutor } from './NodeExecutor.js';
import {
  buildGraphNodeMap,
  filterComputationalConnections,
} from './annotationConnections.js';

interface ComputeNodeOptions {
  recomputeVersion?: number;
  forceNodeIds?: ReadonlySet<string>;
}

/**
 * Graph computation engine with deterministic recomputation
 */
export class GraphEngine {
  private dataStore: DataStore;
  private nodeExecutor: NodeExecutor;
  private computationCache: Map<string, ComputationResult> = new Map();
  private manualRecomputeVersionByNodeId: Map<string, number> = new Map();
  private inFlightComputations: Map<string, Promise<ComputationResult>> = new Map();

  constructor(dataStore: DataStore, nodeExecutor: NodeExecutor) {
    this.dataStore = dataStore;
    this.nodeExecutor = nodeExecutor;
  }

  /**
   * Compute a node and all its dependencies
   */
  async computeNode(
    graph: Graph,
    nodeId: string,
    options: ComputeNodeOptions = {}
  ): Promise<ComputationResult> {
    const hasManualRecomputeVersion =
      typeof options.recomputeVersion === 'number' &&
      Number.isFinite(options.recomputeVersion);
    const forceNodeIds =
      options.forceNodeIds ??
      (hasManualRecomputeVersion ? new Set([nodeId]) : undefined);

    return await this.computeNodeWithContext(graph, nodeId, {
      ...options,
      forceNodeIds,
    });
  }

  private async computeNodeWithContext(
    graph: Graph,
    nodeId: string,
    options: ComputeNodeOptions
  ): Promise<ComputationResult> {
    const node = graph.nodes.find(n => n.id === nodeId);
    if (!node) {
      throw new Error(`Node ${nodeId} not found`);
    }

    const inFlightKey = this.makeInFlightKey(graph, node, options);
    const existingComputation = this.inFlightComputations.get(inFlightKey);
    if (existingComputation) {
      return await existingComputation;
    }

    const computation = this.computeNodeOnce(graph, node, options);
    this.inFlightComputations.set(inFlightKey, computation);
    try {
      return await computation;
    } finally {
      if (this.inFlightComputations.get(inFlightKey) === computation) {
        this.inFlightComputations.delete(inFlightKey);
      }
    }
  }

  private async computeNodeOnce(
    graph: Graph,
    node: GraphNode,
    options: ComputeNodeOptions
  ): Promise<ComputationResult> {
    const nodeId = node.id;

    // Compute dependencies first so recomputation checks can use fresh dependency results.
    const dependencies = this.getDependencies(graph, nodeId);
    for (const depNodeId of dependencies) {
      await this.computeNodeWithContext(graph, depNodeId, options);
    }

    const currentResult = await this.getCachedOrStoredResult(graph.id, nodeId);

    // Check if recomputation is needed
    if (await this.needsRecomputation(graph, node, currentResult, options)) {
      // Get inputs from connected nodes
      const inputs = await this.getNodeInputs(graph, nodeId);

      // Execute node
      const executedResult = await this.nodeExecutor.execute(node, inputs, graph);

      // Store result
      await this.dataStore.storeResult(graph.id, nodeId, executedResult);
      const storedResult = await this.dataStore.getResult(graph.id, nodeId, executedResult.version);
      const result = storedResult ?? {
        ...executedResult,
        graphicsOutput: undefined,
      };
      this.computationCache.set(this.makeCacheKey(graph.id, nodeId), result);
      if (
        typeof options.recomputeVersion === 'number' &&
        Number.isFinite(options.recomputeVersion) &&
        options.forceNodeIds?.has(nodeId)
      ) {
        this.manualRecomputeVersionByNodeId.set(this.makeCacheKey(graph.id, nodeId), options.recomputeVersion);
      }

      // Update node version to mark as computed
      node.lastComputed = Date.now();

      return result;
    }

    if (currentResult) {
      return currentResult;
    }

    throw new Error(`No computation result available for node ${nodeId}`);
  }

  /**
   * Check if a node needs recomputation
   */
  private async needsRecomputation(
    graph: Graph,
    node: GraphNode,
    currentResult: ComputationResult | null,
    options: ComputeNodeOptions
  ): Promise<boolean> {
    if (
      typeof options.recomputeVersion === 'number' &&
      Number.isFinite(options.recomputeVersion) &&
      options.forceNodeIds?.has(node.id)
    ) {
      const lastManualRecomputeVersion = this.manualRecomputeVersionByNodeId.get(
        this.makeCacheKey(graph.id, node.id)
      );
      if (lastManualRecomputeVersion !== options.recomputeVersion) {
        return true;
      }
    }

    // Check if node has never been computed or node definition changed.
    if (!currentResult || currentResult.version !== node.version) {
      return true;
    }

    // If any dependency was computed more recently, inputs may have changed.
    const dependencies = this.getDependencies(graph, node.id);
    for (const depNodeId of dependencies) {
      const depResult = await this.getCachedOrStoredResult(graph.id, depNodeId);
      if (!depResult || depResult.timestamp > currentResult.timestamp) {
        return true;
      }
    }

    return false;
  }

  /**
   * Get all nodes that this node depends on
   */
  private getDependencies(graph: Graph, nodeId: string): string[] {
    const connections = filterComputationalConnections(
      graph.connections,
      buildGraphNodeMap(graph.nodes)
    ).filter((connection) => connection.targetNodeId === nodeId);
    return connections.map(c => c.sourceNodeId);
  }

  /**
   * Get inputs for a node from connected nodes
   */
  private async getNodeInputs(graph: Graph, nodeId: string): Promise<Record<string, any>> {
    const inputs: Record<string, any> = {};
    const connections = filterComputationalConnections(
      graph.connections,
      buildGraphNodeMap(graph.nodes)
    ).filter((connection) => connection.targetNodeId === nodeId);

    const connectedPorts = new Set(connections.map((connection) => connection.targetPort));
    const node = graph.nodes.find((candidate) => candidate.id === nodeId);
    for (const input of node?.metadata.inputs ?? []) {
      if (!connectedPorts.has(input.name) && input.defaultValue !== undefined) {
        inputs[input.name] = structuredClone(input.defaultValue);
      }
    }

    for (const connection of connections) {
      const sourceResult = await this.dataStore.getResult(graph.id, connection.sourceNodeId);
      if (sourceResult) {
        if (sourceResult.outputs[connection.sourcePort] !== undefined) {
          inputs[connection.targetPort] = sourceResult.outputs[connection.sourcePort];
        }
      }
    }

    return inputs;
  }

  /**
   * Compute entire graph (all nodes)
   */
  async computeGraph(graph: Graph): Promise<Map<string, ComputationResult>> {
    const results = new Map<string, ComputationResult>();

    // Topological sort to compute in correct order
    const sortedNodes = this.topologicalSort(graph);

    for (const nodeId of sortedNodes) {
      const result = await this.computeNode(graph, nodeId);
      results.set(nodeId, result);
    }

    return results;
  }

  /**
   * Topological sort of nodes for correct computation order
   */
  private topologicalSort(graph: Graph): string[] {
    const visited = new Set<string>();
    const visiting = new Set<string>();
    const result: string[] = [];

    const visit = (nodeId: string) => {
      if (visiting.has(nodeId)) {
        throw new Error(`Circular dependency detected involving node ${nodeId}`);
      }
      if (visited.has(nodeId)) {
        return;
      }

      visiting.add(nodeId);
      const dependencies = this.getDependencies(graph, nodeId);
      for (const dep of dependencies) {
        visit(dep);
      }
      visiting.delete(nodeId);
      visited.add(nodeId);
      result.push(nodeId);
    };

    for (const node of graph.nodes) {
      if (!visited.has(node.id)) {
        visit(node.id);
      }
    }

    return result;
  }

  /**
   * Clear computation cache
   */
  clearCache(): void {
    this.computationCache.clear();
    this.manualRecomputeVersionByNodeId.clear();
    this.inFlightComputations.clear();
  }

  async disposeGraphExecutionResources(graphId: string): Promise<void> {
    await this.nodeExecutor.disposeGraphExecutionResources(graphId);
  }

  async dispose(): Promise<void> {
    await this.nodeExecutor.dispose();
  }

  private async getCachedOrStoredResult(graphId: string, nodeId: string): Promise<ComputationResult | null> {
    const cacheKey = this.makeCacheKey(graphId, nodeId);
    const cached = this.computationCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const stored = await this.dataStore.getResult(graphId, nodeId);
    if (stored) {
      this.computationCache.set(cacheKey, stored);
      return stored;
    }

    return null;
  }

  private makeCacheKey(graphId: string, nodeId: string): string {
    return `${graphId}:${nodeId}`;
  }

  private makeInFlightKey(
    graph: Graph,
    node: GraphNode,
    options: ComputeNodeOptions
  ): string {
    const recomputeVersion =
      typeof options.recomputeVersion === 'number' &&
      Number.isFinite(options.recomputeVersion)
        ? options.recomputeVersion
        : 'automatic';
    const forceMode = options.forceNodeIds?.has(node.id) ? 'forced' : 'stale-only';
    return JSON.stringify([
      graph.id,
      graph.revision,
      node.id,
      node.version,
      recomputeVersion,
      forceMode,
    ]);
  }
}
