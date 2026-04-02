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
  let pendingUpdateCount = 0;
  let processingQueue = false;
  let pendingUpdates: Array<{
    graphId: string;
    commands: GraphCommand[];
    resolve: () => void;
  }> = [];
  const persistedGraphs = new Map<string, Graph>();

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

  const hasPendingUpdatesForGraph = (graphId: string): boolean =>
    pendingUpdates.some((update) => update.graphId === graphId);

  const reapplyPendingCommands = (graph: Graph): Graph => {
    let nextGraph = graph;
    for (const pendingUpdate of pendingUpdates) {
      if (pendingUpdate.graphId !== graph.id) {
        continue;
      }
      nextGraph = normalizeGraph(applyGraphCommands(nextGraph, pendingUpdate.commands));
    }
    return nextGraph;
  };

  const reconcileCurrentGraph = (graph: Graph, error: string | null) => {
    setState((state) => {
      if (!state.graph || state.graph.id !== graph.id) {
        return {};
      }

      return buildGraphStateUpdate({
        graph: reapplyPendingCommands(graph),
        selectedCameraId: state.selectedCameraId,
        selectedNodeId: state.selectedNodeId,
        selectedNodeIds: state.selectedNodeIds,
        selectedDrawingId: state.selectedDrawingId,
        nodeExecutionStates: state.nodeExecutionStates,
        nodeGraphicsOutputs: state.nodeGraphicsOutputs,
        nodeResults: state.nodeResults,
        error,
        isLoading: false,
        selectionMode: 'reconcile',
      });
    });
  };

  const removePendingUpdatesForGraph = (graphId: string) => {
    const removedUpdates = pendingUpdates.filter((update) => update.graphId === graphId);
    if (removedUpdates.length === 0) {
      return removedUpdates;
    }

    pendingUpdates = pendingUpdates.filter((update) => update.graphId !== graphId);
    pendingUpdateCount = Math.max(0, pendingUpdateCount - removedUpdates.length);
    return removedUpdates;
  };

  const processPendingUpdates = async (): Promise<void> => {
    if (processingQueue) {
      return;
    }

    processingQueue = true;
    try {
      while (pendingUpdates.length > 0) {
        const pendingUpdate = pendingUpdates[0];
        const activeGraph = getState().graph;
        const baseGraph =
          persistedGraphs.get(pendingUpdate.graphId) ??
          (activeGraph?.id === pendingUpdate.graphId ? activeGraph : null);

        if (!baseGraph) {
          pendingUpdates.shift();
          pendingUpdateCount = Math.max(0, pendingUpdateCount - 1);
          pendingUpdate.resolve();
          continue;
        }

        try {
          const persistedGraph = await sendGraphUpdate(
            pendingUpdate.graphId,
            baseGraph,
            pendingUpdate.commands
          );
          pendingUpdates.shift();
          pendingUpdateCount = Math.max(0, pendingUpdateCount - 1);
          persistedGraphs.set(pendingUpdate.graphId, persistedGraph);
          reconcileCurrentGraph(persistedGraph, null);
          if (getState().graph?.id === pendingUpdate.graphId) {
            syncPersistedGraph(persistedGraph);
          }
          pendingUpdate.resolve();
          continue;
        } catch (error: any) {
          if (error?.response?.status === 409) {
            try {
              const latestGraph = normalizeGraph(await api.fetchGraph(pendingUpdate.graphId));
              persistedGraphs.set(pendingUpdate.graphId, latestGraph);
              const droppedUpdates = removePendingUpdatesForGraph(pendingUpdate.graphId);
              if (getState().graph?.id === pendingUpdate.graphId) {
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
              }
              for (const droppedUpdate of droppedUpdates) {
                droppedUpdate.resolve();
              }
              continue;
            } catch (reloadError: any) {
              const droppedUpdates = removePendingUpdatesForGraph(pendingUpdate.graphId);
              if (getState().graph?.id === pendingUpdate.graphId) {
                setState((state) =>
                  buildGraphStateUpdate({
                    graph: baseGraph,
                    selectedCameraId: state.selectedCameraId,
                    selectedNodeId: state.selectedNodeId,
                    selectedNodeIds: state.selectedNodeIds,
                    selectedDrawingId: state.selectedDrawingId,
                    nodeExecutionStates: state.nodeExecutionStates,
                    nodeGraphicsOutputs: state.nodeGraphicsOutputs,
                    nodeResults: state.nodeResults,
                    error: resolveErrorMessage(
                      reloadError,
                      'Graph changed remotely and latest graph could not be reloaded'
                    ),
                    isLoading: false,
                  })
                );
              }
              for (const droppedUpdate of droppedUpdates) {
                droppedUpdate.resolve();
              }
              continue;
            }
          }

          const droppedUpdates = removePendingUpdatesForGraph(pendingUpdate.graphId);
          if (getState().graph?.id === pendingUpdate.graphId) {
            reconcileCurrentGraph(
              baseGraph,
              resolveErrorMessage(error, 'Failed to update graph')
            );
          }
          for (const droppedUpdate of droppedUpdates) {
            droppedUpdate.resolve();
          }
        }
      }
    } finally {
      processingQueue = false;
      if (pendingUpdates.length > 0) {
        void processPendingUpdates();
      }
    }
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

    if (!hasPendingUpdatesForGraph(graph.id)) {
      persistedGraphs.set(graph.id, graph);
    }

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

    await new Promise<void>((resolve) => {
      pendingUpdates.push({
        graphId: graph.id,
        commands,
        resolve,
      });
      void processPendingUpdates();
    });
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
