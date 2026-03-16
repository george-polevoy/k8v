import {
  applyGraphCommands,
  buildGraphCommandsFromGraphUpdate,
  type Graph,
  type GraphCommand,
} from '../types';
import { resolveSelectedGraphCameraId } from '../utils/cameras';
import {
  buildNodeGraphicsOutputMapForGraph,
  buildNodeResultMapForGraph,
  buildNodeStateMapForGraph,
  normalizeGraph,
  resolveErrorMessage,
} from './graphStoreState';
import type {
  NodeExecutionState,
  NodeGraphicsOutputMap,
  NodeResultMap,
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
  nodeResults: NodeResultMap;
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
  nodeResults: NodeResultMap;
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
  submitCommands(
    graphId: string,
    baseRevision: number,
    commands: GraphCommand[]
  ): Promise<{ graph: Graph }>;
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
  nodeResults,
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
    nodeResults: buildNodeResultMapForGraph(graph, nodeResults),
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
    commands: GraphCommand[]
  ): Promise<Graph> => {
    const nextGraph = normalizeGraph(applyGraphCommands(baseGraph, commands));
    if (commands.length === 0) {
      return nextGraph;
    }
    const response = await api.submitCommands(graphId, baseGraph.revision, commands);
    return normalizeGraph(response.graph);
  };

  const persistCommands = async (commands: GraphCommand[]): Promise<void> => {
    const { graph, nodeExecutionStates, nodeGraphicsOutputs, nodeResults, selectedCameraId } = getState();
    if (!graph || commands.length === 0) {
      return;
    }

    let updatedGraph: Graph;
    try {
      updatedGraph = normalizeGraph(applyGraphCommands(graph, commands));
    } catch (error: any) {
      setState(buildGraphStateUpdate({
        graph,
        selectedCameraId,
        nodeExecutionStates,
        nodeGraphicsOutputs,
        nodeResults,
        error: resolveErrorMessage(error, 'Failed to update graph'),
        isLoading: false,
      }));
      return;
    }

    const requestId = latestUpdateRequestId + 1;
    latestUpdateRequestId = requestId;
    pendingUpdateCount += 1;

    setState(buildGraphStateUpdate({
      graph: updatedGraph,
      selectedCameraId,
      nodeExecutionStates,
      nodeGraphicsOutputs,
      nodeResults,
      error: null,
      isLoading: false,
    }));

    try {
      const persistedGraph = await sendGraphUpdate(graph.id, graph, commands);

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
          nodeResults: state.nodeResults,
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
              selectedCameraId: state.selectedCameraId,
              selectedNodeId: state.selectedNodeId,
              selectedNodeIds: state.selectedNodeIds,
              selectedDrawingId: state.selectedDrawingId,
              nodeExecutionStates: state.nodeExecutionStates,
              nodeGraphicsOutputs: state.nodeGraphicsOutputs,
              nodeResults: state.nodeResults,
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
            nodeResults,
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
        nodeResults,
        error: resolveErrorMessage(error, 'Failed to update graph'),
        isLoading: false,
      }));
    } finally {
      pendingUpdateCount = Math.max(0, pendingUpdateCount - 1);
    }
  };

  return {
    hasPendingUpdates(): boolean {
      return pendingUpdateCount > 0;
    },

    async submitGraphCommands(commands: GraphCommand[]): Promise<void> {
      await persistCommands(commands);
    },

    async updateGraph(updates: Partial<Graph>): Promise<void> {
      const commands = buildGraphCommandsFromGraphUpdate(updates);
      await persistCommands(commands);
    },
  };
}
