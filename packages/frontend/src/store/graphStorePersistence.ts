import type { Graph } from '../types';
import { resolveSelectedGraphCameraId } from '../utils/cameras';
import {
  buildNodeGraphicsOutputMapForGraph,
  buildNodeStateMapForGraph,
  normalizeGraph,
  resolveErrorMessage,
} from './graphStoreState';
import {
  applyGraphUpdatePayload,
  deriveGraphUpdatePayload,
  rebaseGraphUpdate,
  type GraphUpdatePayload,
} from './graphUpdateRebase';
import type {
  NodeExecutionState,
  NodeGraphicsOutputMap,
} from './graphStoreTypes';

export interface GraphStorePersistenceState {
  graph: Graph | null;
  selectedCameraId: string | null;
  selectedNodeId: string | null;
  selectedNodeIds: string[];
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
  selectedCameraId?: string | null;
  selectedNodeId?: string | null;
  selectedNodeIds?: string[];
  selectedDrawingId?: string | null;
}

interface GraphPersistenceApi {
  fetchGraph(graphId: string): Promise<Graph>;
  updateGraph(graphId: string, graph: GraphUpdatePayload & { ifMatchUpdatedAt: number }): Promise<Graph>;
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
  selectedNodeIds,
  selectedDrawingId,
  selectedCameraId,
}: GraphStateUpdateParams): GraphStorePersistenceStateUpdate {
  const reconciledSelectedCameraId = resolveSelectedGraphCameraId(
    graph.cameras,
    selectedCameraId
  );
  const nextState: GraphStorePersistenceStateUpdate = {
    graph,
    selectedCameraId: reconciledSelectedCameraId,
    isLoading,
    error,
    nodeExecutionStates: buildNodeStateMapForGraph(graph, nodeExecutionStates),
    nodeGraphicsOutputs: buildNodeGraphicsOutputMapForGraph(graph, nodeGraphicsOutputs),
  };

  if (selectionMode === 'reset') {
    return {
      ...nextState,
      selectedNodeId: null,
      selectedNodeIds: [],
      selectedDrawingId: null,
    };
  }

  if (selectionMode === 'reconcile') {
    const reconciledNodeIds = Array.from(new Set(
      (selectedNodeIds ?? (selectedNodeId ? [selectedNodeId] : []))
        .filter((nodeId) => graph.nodes.some((node) => node.id === nodeId))
    ));
    return {
      ...nextState,
      selectedNodeId: reconciledNodeIds.length === 1 ? reconciledNodeIds[0] : null,
      selectedNodeIds: reconciledNodeIds,
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
  let pendingUpdateCount = 0;

  const isLatestRequest = (requestId: number) => requestId === latestUpdateRequestId;

  const sendGraphUpdate = async (
    graphId: string,
    baseGraph: Graph,
    updates: GraphUpdatePayload
  ): Promise<Graph> => {
    const payload = {
      ...updates,
      ifMatchUpdatedAt: baseGraph.updatedAt,
    };
    return normalizeGraph(await api.updateGraph(graphId, payload));
  };

  return {
    hasPendingUpdates(): boolean {
      return pendingUpdateCount > 0;
    },

    async updateGraph(updates: Partial<Graph>): Promise<void> {
      const { graph, nodeExecutionStates, nodeGraphicsOutputs, selectedCameraId } = getState();
      if (!graph) {
        return;
      }

      const updatePayload = deriveGraphUpdatePayload(graph, updates);
      if (Object.keys(updatePayload).length === 0) {
        return;
      }

      const updatedGraph = applyGraphUpdatePayload(graph, updatePayload);
      const requestId = latestUpdateRequestId + 1;
      latestUpdateRequestId = requestId;
      pendingUpdateCount += 1;

      setState(buildGraphStateUpdate({
        graph: updatedGraph,
        selectedCameraId,
        nodeExecutionStates,
        nodeGraphicsOutputs,
        error: null,
        isLoading: false,
      }));

      try {
        const persistedGraph = await sendGraphUpdate(graph.id, graph, updatePayload);

        if (!isLatestRequest(requestId)) {
          return;
        }

        setState((state) =>
          buildGraphStateUpdate({
            graph: persistedGraph,
            selectedCameraId: state.selectedCameraId,
            selectedNodeId: state.selectedNodeId,
            selectedNodeIds: state.selectedNodeIds,
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

            const rebased = rebaseGraphUpdate(graph, updatePayload, latestGraph);
            if (rebased.ok) {
              const rebasedGraph = applyGraphUpdatePayload(latestGraph, rebased.updates);
              setState((state) =>
                buildGraphStateUpdate({
                  graph: rebasedGraph,
                  selectedCameraId: state.selectedCameraId,
                  selectedNodeId: state.selectedNodeId,
                  selectedNodeIds: state.selectedNodeIds,
                  selectedDrawingId: state.selectedDrawingId,
                  nodeExecutionStates: state.nodeExecutionStates,
                  nodeGraphicsOutputs: state.nodeGraphicsOutputs,
                  error: null,
                  isLoading: false,
                  selectionMode: 'reconcile',
                })
              );

              const persistedGraph = await sendGraphUpdate(graph.id, latestGraph, rebased.updates);
              if (!isLatestRequest(requestId)) {
                return;
              }

              setState((state) =>
                buildGraphStateUpdate({
                  graph: persistedGraph,
                  selectedCameraId: state.selectedCameraId,
                  selectedNodeId: state.selectedNodeId,
                  selectedNodeIds: state.selectedNodeIds,
                  selectedDrawingId: state.selectedDrawingId,
                  nodeExecutionStates: state.nodeExecutionStates,
                  nodeGraphicsOutputs: state.nodeGraphicsOutputs,
                  error: null,
                  isLoading: false,
                  selectionMode: 'reconcile',
                })
              );
              syncPersistedGraph(persistedGraph);
              return;
            }

            setState((state) =>
              buildGraphStateUpdate({
                graph: latestGraph,
                selectedCameraId: state.selectedCameraId,
                selectedNodeId: state.selectedNodeId,
                selectedNodeIds: state.selectedNodeIds,
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
              selectedCameraId,
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
          selectedCameraId,
          nodeExecutionStates,
          nodeGraphicsOutputs,
          error: resolveErrorMessage(error, 'Failed to update graph'),
          isLoading: false,
        }));
      } finally {
        pendingUpdateCount = Math.max(0, pendingUpdateCount - 1);
      }
    },
  };
}
