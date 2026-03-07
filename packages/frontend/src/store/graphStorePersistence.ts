import type { Graph } from '../types';
import {
  buildNodeGraphicsOutputMapForGraph,
  buildNodeStateMapForGraph,
  normalizeGraph,
  resolveErrorMessage,
} from './graphStoreState';
import type {
  NodeExecutionState,
  NodeGraphicsOutputMap,
} from './graphStoreTypes';

export interface GraphStorePersistenceState {
  graph: Graph | null;
  selectedNodeId: string | null;
  selectedDrawingId: string | null;
  isLoading: boolean;
  error: string | null;
  nodeExecutionStates: Record<string, NodeExecutionState>;
  nodeGraphicsOutputs: NodeGraphicsOutputMap;
}

export type GraphStorePersistenceStateUpdate = Partial<GraphStorePersistenceState>;

export type GraphStorePersistenceStateUpdater = (
  state: GraphStorePersistenceState
) => GraphStorePersistenceStateUpdate;

export type GraphStorePersistenceSetState = (
  partial: GraphStorePersistenceStateUpdate | GraphStorePersistenceStateUpdater
) => void;

type GraphSelectionMode = 'preserve' | 'reset' | 'reconcile';

interface GraphStateUpdateParams {
  graph: Graph;
  nodeExecutionStates: Record<string, NodeExecutionState>;
  nodeGraphicsOutputs: NodeGraphicsOutputMap;
  isLoading?: boolean;
  error?: string | null;
  selectionMode?: GraphSelectionMode;
  selectedNodeId?: string | null;
  selectedDrawingId?: string | null;
}

interface GraphPersistenceApi {
  fetchGraph(graphId: string): Promise<Graph>;
  updateGraph(graphId: string, graph: Graph & { ifMatchUpdatedAt: number }): Promise<Graph>;
}

interface CreateGraphUpdatePersistenceControllerParams {
  api: GraphPersistenceApi;
  getState: () => GraphStorePersistenceState;
  setState: GraphStorePersistenceSetState;
  syncPersistedGraph: (graph: Graph) => void;
}

export function buildGraphStateUpdate({
  graph,
  nodeExecutionStates,
  nodeGraphicsOutputs,
  isLoading = false,
  error = null,
  selectionMode = 'preserve',
  selectedNodeId,
  selectedDrawingId,
}: GraphStateUpdateParams): GraphStorePersistenceStateUpdate {
  const nextState: GraphStorePersistenceStateUpdate = {
    graph,
    isLoading,
    error,
    nodeExecutionStates: buildNodeStateMapForGraph(graph, nodeExecutionStates),
    nodeGraphicsOutputs: buildNodeGraphicsOutputMapForGraph(graph, nodeGraphicsOutputs),
  };

  if (selectionMode === 'reset') {
    return {
      ...nextState,
      selectedNodeId: null,
      selectedDrawingId: null,
    };
  }

  if (selectionMode === 'reconcile') {
    return {
      ...nextState,
      selectedNodeId:
        selectedNodeId && graph.nodes.some((node) => node.id === selectedNodeId)
          ? selectedNodeId
          : null,
      selectedDrawingId:
        selectedDrawingId &&
        graph.drawings?.some((drawing) => drawing.id === selectedDrawingId)
          ? selectedDrawingId
          : null,
    };
  }

  return nextState;
}

export function createGraphUpdatePersistenceController({
  api,
  getState,
  setState,
  syncPersistedGraph,
}: CreateGraphUpdatePersistenceControllerParams) {
  let latestUpdateRequestId = 0;

  const isLatestRequest = (requestId: number) => requestId === latestUpdateRequestId;

  return {
    async updateGraph(updates: Partial<Graph>): Promise<void> {
      const { graph, nodeExecutionStates, nodeGraphicsOutputs } = getState();
      if (!graph) {
        return;
      }

      const updatedGraph = normalizeGraph({ ...graph, ...updates } as Graph);
      const requestId = latestUpdateRequestId + 1;
      latestUpdateRequestId = requestId;
      const ifMatchUpdatedAt = graph.updatedAt;

      setState(buildGraphStateUpdate({
        graph: updatedGraph,
        nodeExecutionStates,
        nodeGraphicsOutputs,
        error: null,
        isLoading: false,
      }));

      try {
        const persistedGraph = normalizeGraph(await api.updateGraph(graph.id, {
          ...updatedGraph,
          ifMatchUpdatedAt,
        }));

        if (!isLatestRequest(requestId)) {
          return;
        }

        setState((state) =>
          buildGraphStateUpdate({
            graph: persistedGraph,
            selectedNodeId: state.selectedNodeId,
            selectedDrawingId: state.selectedDrawingId,
            nodeExecutionStates: state.nodeExecutionStates,
            nodeGraphicsOutputs: state.nodeGraphicsOutputs,
            error: null,
            isLoading: false,
            selectionMode: 'reconcile',
          })
        );
        syncPersistedGraph(persistedGraph);
      } catch (error: any) {
        if (!isLatestRequest(requestId)) {
          return;
        }

        if (error?.response?.status === 409) {
          try {
            const latestGraph = normalizeGraph(await api.fetchGraph(graph.id));
            if (!isLatestRequest(requestId)) {
              return;
            }

            setState((state) =>
              buildGraphStateUpdate({
                graph: latestGraph,
                selectedNodeId: state.selectedNodeId,
                selectedDrawingId: state.selectedDrawingId,
                nodeExecutionStates: state.nodeExecutionStates,
                nodeGraphicsOutputs: state.nodeGraphicsOutputs,
                error: 'Graph changed remotely. Reloaded latest graph state.',
                isLoading: false,
                selectionMode: 'reconcile',
              })
            );
            syncPersistedGraph(latestGraph);
            return;
          } catch (reloadError: any) {
            if (!isLatestRequest(requestId)) {
              return;
            }

            setState(buildGraphStateUpdate({
              graph,
              nodeExecutionStates,
              nodeGraphicsOutputs,
              error: resolveErrorMessage(
                reloadError,
                'Graph changed remotely and latest graph could not be reloaded'
              ),
              isLoading: false,
            }));
            return;
          }
        }

        setState(buildGraphStateUpdate({
          graph,
          nodeExecutionStates,
          nodeGraphicsOutputs,
          error: resolveErrorMessage(error, 'Failed to update graph'),
          isLoading: false,
        }));
      }
    },
  };
}
