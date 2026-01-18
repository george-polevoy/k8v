import { Graph, GraphNode, Connection, ComputationResult, NodeType } from '../types/index.js';
import { DataStore } from './DataStore.js';
import { NodeExecutor } from './NodeExecutor.js';

/**
 * Graph computation engine with deterministic recomputation
 */
export class GraphEngine {
  private dataStore: DataStore;
  private nodeExecutor: NodeExecutor;
  private computationCache: Map<string, ComputationResult> = new Map();

  constructor(dataStore: DataStore, nodeExecutor: NodeExecutor) {
    this.dataStore = dataStore;
    this.nodeExecutor = nodeExecutor;
  }

  /**
   * Compute a node and all its dependencies
   */
  async computeNode(graph: Graph, nodeId: string): Promise<ComputationResult> {
    const node = graph.nodes.find(n => n.id === nodeId);
    if (!node) {
      throw new Error(`Node ${nodeId} not found`);
    }

    // Check if recomputation is needed
    if (this.needsRecomputation(graph, node)) {
      // Compute dependencies first
      const dependencies = this.getDependencies(graph, nodeId);
      for (const depNodeId of dependencies) {
        await this.computeNode(graph, depNodeId);
      }

      // Get inputs from connected nodes
      const inputs = await this.getNodeInputs(graph, nodeId);

      // Execute node
      const result = await this.nodeExecutor.execute(node, inputs);

      // Store result
      await this.dataStore.storeResult(nodeId, result);
      this.computationCache.set(nodeId, result);

      // Update node version to mark as computed
      node.lastComputed = Date.now();

      return result;
    }

    // Return cached result
    const cached = this.computationCache.get(nodeId);
    if (cached) {
      return cached;
    }

    // Load from store
    const stored = await this.dataStore.getResult(nodeId);
    if (stored) {
      this.computationCache.set(nodeId, stored);
      return stored;
    }

    // If no cache, recompute
    return this.computeNode(graph, nodeId);
  }

  /**
   * Check if a node needs recomputation
   */
  private needsRecomputation(graph: Graph, node: GraphNode): boolean {
    // Check if node itself changed
    const cached = this.computationCache.get(node.id);
    if (!cached || cached.version !== node.version) {
      return true;
    }

    // Check if any input changed
    const dependencies = this.getDependencies(graph, node.id);
    for (const depNodeId of dependencies) {
      const depNode = graph.nodes.find(n => n.id === depNodeId);
      if (!depNode) continue;

      const depResult = this.computationCache.get(depNodeId);
      if (!depResult || depResult.version !== depNode.version) {
        return true;
      }
    }

    return false;
  }

  /**
   * Get all nodes that this node depends on
   */
  private getDependencies(graph: Graph, nodeId: string): string[] {
    const connections = graph.connections.filter(c => c.targetNodeId === nodeId);
    return connections.map(c => c.sourceNodeId);
  }

  /**
   * Get inputs for a node from connected nodes
   */
  private async getNodeInputs(graph: Graph, nodeId: string): Promise<Record<string, any>> {
    const inputs: Record<string, any> = {};
    const connections = graph.connections.filter(c => c.targetNodeId === nodeId);

    for (const connection of connections) {
      const sourceResult = await this.dataStore.getResult(connection.sourceNodeId);
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
  }
}
