import type { Graph, GraphRuntimeState } from '../types';
import {
  buildNodeGraphicsOutputMapForGraph,
  buildNodeResultMapForGraph,
  buildNodeStateMapForGraph,
  DEFAULT_NODE_EXECUTION_STATE,
  normalizeBackendNodeExecutionState,
  normalizeComputationResult,
  normalizeGraphicsOutput,
  resolveErrorMessage,
} from './graphStoreState';
import type {
  NodeExecutionState,
  NodeGraphicsOutputMap,
  NodeResultMap,
} from './graphStoreTypes';

export interface GraphStoreComputationState {
  graph: Graph | null;
  selectedNodeId: string | null;
  isLoading: boolean;
  error: string | null;
  nodeExecutionStates: Record<string, NodeExecutionState>;
  nodeGraphicsOutputs: NodeGraphicsOutputMap;
  nodeResults: NodeResultMap;
}

export type GraphStoreComputationStateUpdate = Partial<GraphStoreComputationState>;

export type GraphStoreComputationStateUpdater = (
  state: GraphStoreComputationState
) => GraphStoreComputationStateUpdate;

export type GraphStoreComputationSetState = (
  partial: GraphStoreComputationStateUpdate | GraphStoreComputationStateUpdater
) => void;

interface GraphComputationApi {
  fetchRuntimeState(graphId: string): Promise<GraphRuntimeState>;
  submitCommands(
    graphId: string,
    baseRevision: number,
    commands: Array<{ kind: 'compute_node'; nodeId: string } | { kind: 'compute_graph' }>
  ): Promise<{ graph: Graph; runtimeState: GraphRuntimeState }>;
}

interface CreateGraphComputationControllerParams {
  api: GraphComputationApi;
  getState: () => GraphStoreComputationState;
  setState: GraphStoreComputationSetState;
  startRuntimeStatePolling: (graphId: string) => void;
}

export function createGraphComputationController({
  api,
  getState,
  setState,
  startRuntimeStatePolling,
}: CreateGraphComputationControllerParams) {
  const applyRuntimeStateSnapshot = (
    graph: Graph,
    runtimeState: GraphRuntimeState,
    scopedNodeIds?: string[]
  ) => {
    const scope = scopedNodeIds ? new Set(scopedNodeIds) : null;

    setState((state) => {
      if (!state.graph || state.graph.id !== graph.id) {
        return {};
      }

      const nextNodeStates = buildNodeStateMapForGraph(graph, state.nodeExecutionStates);
      const nextGraphicsOutputs = buildNodeGraphicsOutputMapForGraph(graph, state.nodeGraphicsOutputs);
      const nextNodeResults = buildNodeResultMapForGraph(graph, state.nodeResults);

      for (const node of graph.nodes) {
        if (scope && !scope.has(node.id)) {
          continue;
        }

        nextNodeStates[node.id] = normalizeBackendNodeExecutionState(
          runtimeState.nodeStates[node.id],
          nextNodeStates[node.id] ?? DEFAULT_NODE_EXECUTION_STATE
        );
        nextNodeResults[node.id] = normalizeComputationResult(runtimeState.results[node.id] ?? null);
        nextGraphicsOutputs[node.id] = normalizeGraphicsOutput(
          nextNodeResults[node.id]?.graphics ?? null
        );
      }

      return {
        nodeExecutionStates: nextNodeStates,
        nodeGraphicsOutputs: nextGraphicsOutputs,
        nodeResults: nextNodeResults,
      };
    });
  };

  const hydrateNodeExecutionStates = async (graph: Graph) => {
    try {
      const runtimeState = await api.fetchRuntimeState(graph.id);
      applyRuntimeStateSnapshot(graph, runtimeState);
    } catch (error: any) {
      setState({
        error: `Error loading runtime state: ${resolveErrorMessage(error, 'unknown error')}`,
      });
    }
  };

  const computeNode = async (nodeId: string) => {
    const { graph } = getState();
    if (!graph) {
      return;
    }

    setState((state) => ({
      nodeExecutionStates: {
        ...state.nodeExecutionStates,
        [nodeId]: {
          ...(state.nodeExecutionStates[nodeId] ?? DEFAULT_NODE_EXECUTION_STATE),
          isPending: true,
          isComputing: false,
          hasError: false,
          isStale: false,
          errorMessage: null,
        },
      },
      error: null,
    }));

    try {
      const response = await api.submitCommands(graph.id, graph.revision, [{ kind: 'compute_node', nodeId }]);
      const activeGraph = getState().graph;
      if (!activeGraph || activeGraph.id !== graph.id) {
        return;
      }

      applyRuntimeStateSnapshot(activeGraph, response.runtimeState, [nodeId]);
      startRuntimeStatePolling(graph.id);
    } catch (error: any) {
      const message = resolveErrorMessage(error, 'Failed to compute node');
      setState((state) => ({
        nodeExecutionStates: {
          ...state.nodeExecutionStates,
          [nodeId]: {
            ...(state.nodeExecutionStates[nodeId] ?? DEFAULT_NODE_EXECUTION_STATE),
            isPending: false,
            isComputing: false,
            hasError: true,
            isStale: false,
            errorMessage: message,
            lastRunAt: Date.now(),
          },
        },
        error: message,
      }));
    }
  };

  const computeGraph = async () => {
    const { graph } = getState();
    if (!graph) {
      return;
    }

    setState((state) => {
      const nextStates = buildNodeStateMapForGraph(graph, state.nodeExecutionStates);
      for (const node of graph.nodes) {
        nextStates[node.id] = {
          ...(nextStates[node.id] ?? DEFAULT_NODE_EXECUTION_STATE),
          isPending: true,
          isComputing: false,
          hasError: false,
          isStale: false,
          errorMessage: null,
        };
      }
      return {
        isLoading: true,
        error: null,
        nodeExecutionStates: nextStates,
      };
    });

    try {
      const response = await api.submitCommands(graph.id, graph.revision, [{ kind: 'compute_graph' }]);
      const activeGraph = getState().graph;
      if (!activeGraph || activeGraph.id !== graph.id) {
        return;
      }

      applyRuntimeStateSnapshot(activeGraph, response.runtimeState);
      setState({
        isLoading: false,
        error: null,
      });
      startRuntimeStatePolling(graph.id);
    } catch (error: any) {
      const message = resolveErrorMessage(error, 'Failed to compute graph');
      setState((state) => {
        const activeGraph = state.graph;
        if (!activeGraph || activeGraph.id !== graph.id) {
          return {
            error: message,
            isLoading: false,
          };
        }

        const nextStates = buildNodeStateMapForGraph(activeGraph, state.nodeExecutionStates);
        for (const node of activeGraph.nodes) {
          nextStates[node.id] = {
            ...(nextStates[node.id] ?? DEFAULT_NODE_EXECUTION_STATE),
            isPending: false,
            isComputing: false,
          };
        }
        return {
          nodeExecutionStates: nextStates,
          error: message,
          isLoading: false,
        };
      });
    }
  };

  return {
    applyRuntimeStateSnapshot,
    computeGraph,
    computeNode,
    hydrateNodeExecutionStates,
  };
}
