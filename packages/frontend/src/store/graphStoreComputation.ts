import type {
  ComputationResult,
  Graph,
} from '../types';
import {
  buildNodeGraphicsOutputMapForGraph,
  buildNodeStateMapForGraph,
  DEFAULT_NODE_EXECUTION_STATE,
  getNodeExecutionStateFromResult,
  normalizeBackendNodeExecutionState,
  normalizeGraphicsOutput,
  resolveErrorMessage,
  type BackendRecomputeStatus,
} from './graphStoreState';
import type {
  NodeExecutionState,
  NodeGraphicsOutputMap,
} from './graphStoreTypes';

export interface GraphStoreComputationState {
  graph: Graph | null;
  selectedNodeId: string | null;
  isLoading: boolean;
  error: string | null;
  resultRefreshKey: number;
  nodeExecutionStates: Record<string, NodeExecutionState>;
  nodeGraphicsOutputs: NodeGraphicsOutputMap;
}

export type GraphStoreComputationStateUpdate = Partial<GraphStoreComputationState>;

export type GraphStoreComputationStateUpdater = (
  state: GraphStoreComputationState
) => GraphStoreComputationStateUpdate;

export type GraphStoreComputationSetState = (
  partial: GraphStoreComputationStateUpdate | GraphStoreComputationStateUpdater
) => void;

interface GraphComputationApi {
  fetchNodeResult(nodeId: string): Promise<unknown>;
  computeGraph(graphId: string, nodeId?: string): Promise<ComputationResult | ComputationResult[]>;
}

interface CreateGraphComputationControllerParams {
  api: GraphComputationApi;
  getState: () => GraphStoreComputationState;
  setState: GraphStoreComputationSetState;
  startRecomputeStatusPolling: (graphId: string) => void;
}

export function createGraphComputationController({
  api,
  getState,
  setState,
  startRecomputeStatusPolling,
}: CreateGraphComputationControllerParams) {
  const areNodeExecutionStatesEqual = (
    left: NodeExecutionState,
    right: NodeExecutionState
  ): boolean => (
    left.isPending === right.isPending &&
    left.isComputing === right.isComputing &&
    left.hasError === right.hasError &&
    left.isStale === right.isStale &&
    left.errorMessage === right.errorMessage &&
    left.lastRunAt === right.lastRunAt
  );

  const refreshNodeResultSnapshots = async (graphId: string, nodeIds: string[]) => {
    const uniqueNodeIds = [...new Set(nodeIds)];
    if (uniqueNodeIds.length === 0) {
      return;
    }

    const snapshots = await Promise.all(uniqueNodeIds.map(async (nodeId) => {
      try {
        const response = await api.fetchNodeResult(nodeId);
        return {
          nodeId,
          executionState: getNodeExecutionStateFromResult(response),
          graphicsOutput: normalizeGraphicsOutput((response as { graphics?: unknown })?.graphics),
        };
      } catch (error: any) {
        if (error?.response?.status === 404) {
          return {
            nodeId,
            executionState: null,
            graphicsOutput: null,
          };
        }

        return {
          nodeId,
          executionState: null,
          graphicsOutput: null,
        };
      }
    }));

    setState((state) => {
      if (!state.graph || state.graph.id !== graphId) {
        return {};
      }

      const nextNodeStates = { ...state.nodeExecutionStates };
      const nextGraphicsOutputs = { ...state.nodeGraphicsOutputs };

      for (const snapshot of snapshots) {
        if (snapshot.executionState) {
          const currentState = nextNodeStates[snapshot.nodeId] ?? { ...DEFAULT_NODE_EXECUTION_STATE };
          nextNodeStates[snapshot.nodeId] = {
            ...currentState,
            hasError: snapshot.executionState.hasError,
            errorMessage: snapshot.executionState.errorMessage,
            lastRunAt: snapshot.executionState.lastRunAt,
          };
        }
        nextGraphicsOutputs[snapshot.nodeId] = snapshot.graphicsOutput;
      }

      return {
        nodeExecutionStates: nextNodeStates,
        nodeGraphicsOutputs: nextGraphicsOutputs,
      };
    });
  };

  const hydrateNodeExecutionStates = async (graph: Graph) => {
    const nodeStateEntries = await Promise.all(graph.nodes.map(async (node) => {
      try {
        const response = await api.fetchNodeResult(node.id);
        return {
          nodeId: node.id,
          executionState: getNodeExecutionStateFromResult(response),
          graphicsOutput: normalizeGraphicsOutput((response as { graphics?: unknown })?.graphics),
        };
      } catch (error: any) {
        if (error?.response?.status === 404) {
          return {
            nodeId: node.id,
            executionState: { ...DEFAULT_NODE_EXECUTION_STATE },
            graphicsOutput: null,
          };
        }

        return {
          nodeId: node.id,
          executionState: {
            ...DEFAULT_NODE_EXECUTION_STATE,
            hasError: true,
            errorMessage: `Error loading result: ${resolveErrorMessage(error, 'unknown error')}`,
          },
          graphicsOutput: null,
        };
      }
    }));

    const hydratedStates: Record<string, NodeExecutionState> = {};
    const hydratedGraphicsOutputs = buildNodeGraphicsOutputMapForGraph(graph, {});
    for (const entry of nodeStateEntries) {
      hydratedStates[entry.nodeId] = entry.executionState;
      hydratedGraphicsOutputs[entry.nodeId] = entry.graphicsOutput;
    }

    setState({
      nodeExecutionStates: buildNodeStateMapForGraph(graph, hydratedStates),
      nodeGraphicsOutputs: hydratedGraphicsOutputs,
    });
  };

  const applyBackendRecomputeStatus = (graph: Graph, status: BackendRecomputeStatus) => {
    const state = getState();
    if (!state.graph || state.graph.id !== graph.id) {
      return;
    }

    const backendStates = status?.nodeStates ?? {};
    const completedNodeIds: string[] = [];
    let didNodeStateChange = false;
    const nextNodeStates = buildNodeStateMapForGraph(graph, state.nodeExecutionStates);

    for (const node of graph.nodes) {
      const previousState = nextNodeStates[node.id];
      const backendState = normalizeBackendNodeExecutionState(backendStates[node.id], previousState);

      if (!areNodeExecutionStatesEqual(previousState, backendState)) {
        didNodeStateChange = true;
      }

      nextNodeStates[node.id] = backendState;

      const wasRunning = previousState.isPending || previousState.isComputing;
      const isRunning = backendState.isPending || backendState.isComputing;
      if (wasRunning && !isRunning) {
        completedNodeIds.push(node.id);
      }
    }

    const shouldRefreshSelectedNode = Boolean(
      state.selectedNodeId && completedNodeIds.includes(state.selectedNodeId)
    );

    if (!didNodeStateChange && !shouldRefreshSelectedNode) {
      return;
    }

    setState({
      nodeExecutionStates: nextNodeStates,
      resultRefreshKey: shouldRefreshSelectedNode ? Date.now() : state.resultRefreshKey,
    });

    if (completedNodeIds.length > 0) {
      void refreshNodeResultSnapshots(graph.id, completedNodeIds);
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
      const result = await api.computeGraph(graph.id, nodeId) as ComputationResult;
      const activeGraph = getState().graph;
      if (!activeGraph || activeGraph.id !== graph.id) {
        return;
      }

      setState((state) => {
        const nextNodeStates = buildNodeStateMapForGraph(activeGraph, state.nodeExecutionStates);
        if (result?.nodeId) {
          const currentState = nextNodeStates[result.nodeId] ?? { ...DEFAULT_NODE_EXECUTION_STATE };
          nextNodeStates[result.nodeId] = {
            ...currentState,
            ...getNodeExecutionStateFromResult(result),
            isPending: false,
            isComputing: false,
          };
        }

        return {
          nodeExecutionStates: nextNodeStates,
          nodeGraphicsOutputs: {
            ...state.nodeGraphicsOutputs,
            [nodeId]: normalizeGraphicsOutput(result?.graphics),
          },
          resultRefreshKey: state.selectedNodeId === nodeId ? Date.now() : state.resultRefreshKey,
        };
      });

      startRecomputeStatusPolling(graph.id);
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
      const response = await api.computeGraph(graph.id);
      const results = Array.isArray(response) ? response : [];
      const activeGraph = getState().graph;
      if (!activeGraph || activeGraph.id !== graph.id) {
        return;
      }

      setState((state) => {
        const nextStates = buildNodeStateMapForGraph(activeGraph, state.nodeExecutionStates);
        const nextGraphicsOutputs = buildNodeGraphicsOutputMapForGraph(
          activeGraph,
          state.nodeGraphicsOutputs
        );
        for (const node of activeGraph.nodes) {
          nextStates[node.id] = {
            ...(nextStates[node.id] ?? DEFAULT_NODE_EXECUTION_STATE),
            isPending: false,
            isComputing: false,
          };
        }
        for (const result of results) {
          if (result?.nodeId) {
            nextStates[result.nodeId] = {
              ...(nextStates[result.nodeId] ?? DEFAULT_NODE_EXECUTION_STATE),
              ...getNodeExecutionStateFromResult(result),
              isPending: false,
              isComputing: false,
            };
            nextGraphicsOutputs[result.nodeId] = normalizeGraphicsOutput(result.graphics);
          }
        }
        const shouldRefreshSelectedNode = Boolean(
          state.selectedNodeId && results.some((result) => result?.nodeId === state.selectedNodeId)
        );

        return {
          nodeExecutionStates: nextStates,
          nodeGraphicsOutputs: nextGraphicsOutputs,
          isLoading: false,
          error: null,
          resultRefreshKey: shouldRefreshSelectedNode ? Date.now() : state.resultRefreshKey,
        };
      });
      startRecomputeStatusPolling(graph.id);
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
    applyBackendRecomputeStatus,
    computeGraph,
    computeNode,
    hydrateNodeExecutionStates,
  };
}
