import { create } from 'zustand';
import {
  DEFAULT_DRAWING_COLOR,
  Graph,
  GraphRuntimeState,
  GraphDrawing,
  DrawingPath,
  GraphNode,
  GraphCommand,
  Connection,
  Position,
} from '../types';
import { graphApi } from './graphApi';
import {
  clearCurrentGraphId,
  clearCurrentGraphIdIfMatches,
  readCurrentGraphId,
  saveCurrentGraphId,
} from './graphLocalStorage';
import {
  clearCurrentCameraId as clearWindowCurrentCameraId,
  readCurrentCameraId as readWindowCurrentCameraId,
  saveCurrentCameraId as saveWindowCurrentCameraId,
} from './graphCameraSessionStorage';
import { createRecomputeStatusPollController } from './recomputeStatusPolling';
import {
  buildGraphStateUpdate,
  createGraphUpdatePersistenceController,
  type GraphStorePersistenceState,
} from './graphStorePersistence';
import {
  createGraphComputationController,
  type GraphStoreComputationState,
} from './graphStoreComputation';
import { createGraphEditingController } from './graphStoreEditing';
import {
  normalizeGraph,
  parseGraphSummariesResponse,
  resolveErrorMessage,
} from './graphStoreState';
import { createGraphStoreUiController } from './graphStoreUi';
import { resolveSelectedGraphCameraId } from '../utils/cameras';
import type {
  GraphSummary,
  NodeGraphicsComputationDebug,
  PencilColor,
  PencilThickness,
} from './graphStoreTypes';

export type {
  GraphSummary,
  NodeExecutionState,
  NodeGraphicsComputationDebug,
  NodeGraphicsOutputMap,
  NodeResultMap,
  PencilColor,
  PencilThickness,
} from './graphStoreTypes';

interface GraphStore extends GraphStorePersistenceState, GraphStoreComputationState {
  graphSummaries: GraphSummary[];
  selectedCameraId: string | null;
  selectedNodeGraphicsDebug: NodeGraphicsComputationDebug | null;
  drawingEnabled: boolean;
  drawingColor: PencilColor;
  drawingThickness: PencilThickness;

  // Actions
  loadGraph: (id: string) => Promise<void>;
  loadLatestGraph: () => Promise<void>;
  refreshGraphSummaries: () => Promise<void>;
  createGraph: (name: string) => Promise<void>;
  deleteGraph: (id: string) => Promise<void>;
  submitGraphCommands: (commands: GraphCommand[]) => Promise<void>;
  updateGraph: (graph: Partial<Graph>) => Promise<void>;
  initializeGraph: () => Promise<void>;
  addNode: (node: GraphNode) => void;
  updateNode: (nodeId: string, updates: Partial<GraphNode>) => void;
  updateNodePosition: (nodeId: string, position: Position) => void;
  updateNodeCardSize: (nodeId: string, width: number, height: number) => void;
  deleteNode: (nodeId: string) => void;
  addConnection: (connection: Connection) => void;
  deleteConnection: (connectionId: string) => void;
  deleteConnections: (connectionIds: string[]) => void;
  selectCamera: (cameraId: string | null) => void;
  selectNode: (nodeId: string | null) => void;
  setNodeSelection: (nodeIds: string[]) => void;
  toggleNodeSelection: (nodeId: string) => void;
  selectDrawing: (drawingId: string | null) => void;
  setSelectedNodeGraphicsDebug: (debug: NodeGraphicsComputationDebug | null) => void;
  addDrawing: (drawing: GraphDrawing) => void;
  updateDrawing: (drawingId: string, updates: Partial<GraphDrawing>) => void;
  updateDrawingPosition: (drawingId: string, position: Position) => void;
  deleteDrawing: (drawingId: string) => void;
  addDrawingPath: (drawingId: string, path: DrawingPath) => void;
  requestCreateDrawing: () => void;
  setDrawingEnabled: (enabled: boolean) => void;
  setDrawingColor: (color: PencilColor) => void;
  setDrawingThickness: (thickness: PencilThickness) => void;
  computeNode: (nodeId: string) => Promise<void>;
  computeGraph: () => Promise<void>;
  drawingCreateRequestId: number;
}

export const useGraphStore = create<GraphStore>((set, get) => {
  let remoteSyncInFlight = false;
  let graphEventsSource: EventSource | null = null;
  const lastAppliedRuntimeStateMeta = new Map<string, {
    revision: number;
    statusVersion: number;
  }>();
  const RUNTIME_STATE_POLL_IDLE_INTERVAL_MS = 1_500;
  const RUNTIME_STATE_POLL_HIDDEN_INTERVAL_MS = 5_000;

  const hasActiveBackendRecompute = (runtimeState: GraphRuntimeState): boolean => {
    if (typeof runtimeState.queueLength === 'number' && runtimeState.queueLength > 0) {
      return true;
    }

    for (const nodeState of Object.values(runtimeState.nodeStates ?? {})) {
      if (nodeState?.isPending || nodeState?.isComputing) {
        return true;
      }
    }

    return false;
  };

  const graphComputation = createGraphComputationController({
    api: graphApi,
    getState: () => get(),
    setState: (partial) => set(partial as Parameters<typeof set>[0]),
    startRuntimeStatePolling: (graphId) => runtimeStatePolling.start(graphId),
  });

  const runtimeStatePolling = createRecomputeStatusPollController<GraphRuntimeState>({
    fetchStatus: graphApi.fetchRuntimeState,
    onStatus: (graphId, runtimeState) => {
      const currentGraph = get().graph;
      if (!currentGraph || currentGraph.id !== graphId) {
        return;
      }

      const revision = typeof runtimeState.revision === 'number'
        ? runtimeState.revision
        : currentGraph.revision;
      const statusVersion = typeof runtimeState.statusVersion === 'number'
        ? runtimeState.statusVersion
        : null;
      const previousStatusMeta = statusVersion === null
        ? null
        : lastAppliedRuntimeStateMeta.get(graphId);
      const isRepeatedStatus = Boolean(
        previousStatusMeta &&
        statusVersion !== null &&
        previousStatusMeta.statusVersion === statusVersion &&
        previousStatusMeta.revision === revision
      );

      if (revision > currentGraph.revision && !graphPersistence.hasPendingUpdates()) {
        void syncCurrentGraphFromRemote(graphId);
        return;
      }

      if (isRepeatedStatus) {
        return;
      }

      graphComputation.applyRuntimeStateSnapshot(currentGraph, runtimeState);

      if (statusVersion !== null) {
        lastAppliedRuntimeStateMeta.set(graphId, {
          revision,
          statusVersion,
        });
      }
    },
    shouldContinue: (graphId) => get().graph?.id === graphId,
    resolveNextPollDelayMs: (runtimeState) => {
      if (hasActiveBackendRecompute(runtimeState)) {
        return 400;
      }

      if (
        typeof document !== 'undefined' &&
        document.visibilityState === 'hidden'
      ) {
        return RUNTIME_STATE_POLL_HIDDEN_INTERVAL_MS;
      }

      return RUNTIME_STATE_POLL_IDLE_INTERVAL_MS;
    },
  });

  const upsertGraphSummary = (summary: GraphSummary) => {
    set((state) => {
      const next = state.graphSummaries.filter((item) => item.id !== summary.id);
      next.push(summary);
      next.sort((left, right) => right.updatedAt - left.updatedAt);
      return { graphSummaries: next };
    });
  };

  const removeGraphSummary = (graphId: string) => {
    set((state) => ({
      graphSummaries: state.graphSummaries.filter((item) => item.id !== graphId),
    }));
  };

  const stopGraphRealtime = () => {
    if (graphEventsSource) {
      graphEventsSource.close();
      graphEventsSource = null;
    }
  };

  const startGraphRealtime = (graphId: string) => {
    if (typeof EventSource === 'undefined') {
      runtimeStatePolling.start(graphId);
      return;
    }

    stopGraphRealtime();
    graphEventsSource = graphApi.createEventsSource(graphId);

    graphEventsSource.addEventListener('graph.revised', () => {
      void syncCurrentGraphFromRemote(graphId);
    });

    const refreshRuntime = () => {
      const currentGraph = get().graph;
      if (currentGraph && currentGraph.id === graphId) {
        void graphComputation.hydrateNodeExecutionStates(currentGraph);
      }
    };

    graphEventsSource.addEventListener('runtime.node.updated', refreshRuntime);
    graphEventsSource.addEventListener('runtime.task.completed', refreshRuntime);
    graphEventsSource.onerror = () => {
      stopGraphRealtime();
      runtimeStatePolling.start(graphId);
    };
  };

  const syncPersistedGraph = (graph: Graph) => {
    upsertGraphSummary({
      id: graph.id,
      name: graph.name,
      revision: graph.revision,
      updatedAt: graph.updatedAt,
    });
    saveCurrentGraphId(graph.id);
    const selectedCameraId = resolveSelectedGraphCameraId(graph.cameras, get().selectedCameraId);
    saveWindowCurrentCameraId(graph.id, selectedCameraId);
    startGraphRealtime(graph.id);
  };

  const graphPersistence = createGraphUpdatePersistenceController({
    api: graphApi,
    getState: () => get(),
    setState: (partial) => set(partial as Parameters<typeof set>[0]),
    syncPersistedGraph,
  });

  const syncCurrentGraphFromRemote = async (graphId: string): Promise<void> => {
    if (remoteSyncInFlight) {
      return;
    }

    remoteSyncInFlight = true;
    try {
      const latestGraph = normalizeGraph(await graphApi.fetchGraph(graphId));
      const state = get();
      const currentGraph = state.graph;
      if (!currentGraph || currentGraph.id !== graphId) {
        return;
      }
      if (graphPersistence.hasPendingUpdates()) {
        return;
      }
      if (currentGraph.updatedAt >= latestGraph.updatedAt) {
        return;
      }

      set((currentState) => buildGraphStateUpdate({
        graph: latestGraph,
        selectedCameraId: currentState.selectedCameraId,
        selectedNodeId: currentState.selectedNodeId,
        selectedNodeIds: currentState.selectedNodeIds,
        selectedDrawingId: currentState.selectedDrawingId,
        nodeExecutionStates: currentState.nodeExecutionStates,
        nodeGraphicsOutputs: currentState.nodeGraphicsOutputs,
        nodeResults: currentState.nodeResults,
        error: null,
        isLoading: false,
        selectionMode: 'reconcile',
      }));
      await graphComputation.hydrateNodeExecutionStates(latestGraph);

      if (get().graph?.id !== graphId) {
        return;
      }
      syncPersistedGraph(latestGraph);
    } catch (error: any) {
      if (error?.response?.status === 404) {
        removeGraphSummary(graphId);
      }
    } finally {
      remoteSyncInFlight = false;
    }
  };

  const graphEditing = createGraphEditingController({
    getState: () => get(),
    setState: (partial) => set(partial as Parameters<typeof set>[0]),
  });

  const graphUi = createGraphStoreUiController({
    getState: () => get(),
    setState: (partial) => set(partial as Parameters<typeof set>[0]),
  });

  return {
    graph: null,
    graphSummaries: [],
    selectedCameraId: null,
    selectedNodeId: null,
    selectedNodeIds: [],
    selectedDrawingId: null,
    isLoading: false,
    error: null,
    nodeExecutionStates: {},
    nodeGraphicsOutputs: {},
    nodeResults: {},
    selectedNodeGraphicsDebug: null,
    drawingEnabled: false,
    drawingColor: DEFAULT_DRAWING_COLOR,
    drawingThickness: 3,
    drawingCreateRequestId: 0,

    loadGraph: async (id: string) => {
      set({ isLoading: true, error: null });
      try {
        const graph = normalizeGraph(await graphApi.fetchGraph(id));
        set(buildGraphStateUpdate({
          graph,
          selectedCameraId: readWindowCurrentCameraId(graph.id),
          nodeExecutionStates: get().nodeExecutionStates,
          nodeGraphicsOutputs: get().nodeGraphicsOutputs,
          nodeResults: get().nodeResults,
          error: null,
          isLoading: false,
          selectionMode: 'reset',
        }));
        await graphComputation.hydrateNodeExecutionStates(graph);
        syncPersistedGraph(graph);
      } catch (error: any) {
        if (error?.response?.status === 404) {
          removeGraphSummary(id);
        }
        set({ error: resolveErrorMessage(error, 'Failed to load graph'), isLoading: false });
        throw error;
      }
    },

    createGraph: async (name: string) => {
      const currentLoading = get().isLoading;
      if (!currentLoading) {
        set({ isLoading: true, error: null });
      }
      try {
        const newGraph = normalizeGraph(await graphApi.createGraph(name));
        set(buildGraphStateUpdate({
          graph: newGraph,
          selectedCameraId: readWindowCurrentCameraId(newGraph.id),
          nodeExecutionStates: {},
          nodeGraphicsOutputs: {},
          nodeResults: {},
          error: null,
          isLoading: false,
          selectionMode: 'reset',
        }));
        syncPersistedGraph(newGraph);
        console.log('Graph created successfully:', newGraph.id);
      } catch (error: any) {
        console.error('Error creating graph:', error);
        set({ error: resolveErrorMessage(error, 'Failed to create graph'), isLoading: false });
        throw error;
      }
    },

    deleteGraph: async (id: string) => {
      const currentGraphId = get().graph?.id ?? null;
      const deletingCurrentGraph = currentGraphId === id;
      set({ isLoading: deletingCurrentGraph, error: null });

      try {
        await graphApi.deleteGraph(id);
        removeGraphSummary(id);
        clearCurrentGraphIdIfMatches(id);
        clearWindowCurrentCameraId(id);
        if (currentGraphId === id) {
          stopGraphRealtime();
        }

        if (deletingCurrentGraph) {
          await get().loadLatestGraph();
        } else {
          set({ isLoading: false, error: null });
        }

        await get().refreshGraphSummaries();
      } catch (error: any) {
        set({ error: resolveErrorMessage(error, 'Failed to delete graph'), isLoading: false });
        throw error;
      }
    },

    loadLatestGraph: async () => {
      set({ isLoading: true, error: null });
      try {
        const graph = normalizeGraph(await graphApi.fetchLatestGraph());
        set(buildGraphStateUpdate({
          graph,
          selectedCameraId: readWindowCurrentCameraId(graph.id),
          nodeExecutionStates: get().nodeExecutionStates,
          nodeGraphicsOutputs: get().nodeGraphicsOutputs,
          nodeResults: get().nodeResults,
          error: null,
          isLoading: false,
          selectionMode: 'reset',
        }));
        await graphComputation.hydrateNodeExecutionStates(graph);
        syncPersistedGraph(graph);
      } catch (error: any) {
        if (error.response?.status === 404) {
          set({ isLoading: false });
          await get().createGraph('Untitled Graph');
        } else {
          set({ error: resolveErrorMessage(error, 'Failed to load latest graph'), isLoading: false });
          await get().createGraph('Untitled Graph');
        }
      }
    },

    refreshGraphSummaries: async () => {
      try {
        const nextSummaries = parseGraphSummariesResponse(await graphApi.listGraphs());
        set({ graphSummaries: nextSummaries });
      } catch (error: any) {
        set({ error: resolveErrorMessage(error, 'Failed to list graphs') });
      }
    },

    initializeGraph: async () => {
      console.log('Initializing graph...');
      set({ isLoading: true, error: null });
      await get().refreshGraphSummaries();
      try {
        const savedGraphId = readCurrentGraphId();
        console.log('Saved graph ID:', savedGraphId);

        if (savedGraphId) {
          try {
            console.log('Attempting to load saved graph:', savedGraphId);
            await get().loadGraph(savedGraphId);
            console.log('Graph loaded successfully');
            set({ isLoading: false });
            return;
          } catch (error: any) {
            console.log('Failed to load saved graph:', error.message);
            if (error.response?.status === 404) {
              clearCurrentGraphId();
              try {
                console.log('Trying to load latest graph...');
                await get().loadLatestGraph();
                set({ isLoading: false });
                return;
              } catch {
                console.log('Failed to load latest, creating new graph...');
                await get().createGraph('Untitled Graph');
                set({ isLoading: false });
                return;
              }
            }

            console.log('Other error, creating new graph...');
            clearCurrentGraphId();
            await get().createGraph('Untitled Graph');
            set({ isLoading: false });
            return;
          }
        }

        try {
          console.log('No saved graph ID, trying to load latest...');
          await get().loadLatestGraph();
          set({ isLoading: false });
        } catch (error: any) {
          console.log('Failed to load latest, creating new graph...', error.message);
          await get().createGraph('Untitled Graph');
          set({ isLoading: false });
        }
      } catch (error: any) {
        console.error('Error initializing graph:', error);
        try {
          await get().createGraph('Untitled Graph');
        } catch (createError: any) {
          console.error('Failed to create graph:', createError);
          set({
            error: `Failed to create graph: ${resolveErrorMessage(createError, 'unknown error')}`,
            isLoading: false,
          });
        }
      }
    },

    submitGraphCommands: graphPersistence.submitGraphCommands,
    updateGraph: graphPersistence.updateGraph,

    selectCamera: (cameraId) => {
      const graph = get().graph;
      const graphId = graph?.id;
      const resolvedCameraId = graph
        ? resolveSelectedGraphCameraId(graph.cameras, cameraId)
        : null;
      graphUi.selectCamera(resolvedCameraId);
      if (!graphId || !resolvedCameraId) {
        if (graphId && !resolvedCameraId) {
          clearWindowCurrentCameraId(graphId);
        }
        return;
      }
      saveWindowCurrentCameraId(graphId, resolvedCameraId);
    },
    addNode: graphEditing.addNode,
    updateNode: graphEditing.updateNode,
    updateNodePosition: graphEditing.updateNodePosition,
    updateNodeCardSize: graphEditing.updateNodeCardSize,
    deleteNode: graphEditing.deleteNode,
    addConnection: graphEditing.addConnection,
    deleteConnection: graphEditing.deleteConnection,
    deleteConnections: graphEditing.deleteConnections,
    selectNode: graphUi.selectNode,
    setNodeSelection: graphUi.setNodeSelection,
    toggleNodeSelection: graphUi.toggleNodeSelection,
    selectDrawing: graphUi.selectDrawing,
    setSelectedNodeGraphicsDebug: graphUi.setSelectedNodeGraphicsDebug,
    addDrawing: graphEditing.addDrawing,
    updateDrawing: graphEditing.updateDrawing,
    updateDrawingPosition: graphEditing.updateDrawingPosition,
    deleteDrawing: graphEditing.deleteDrawing,
    addDrawingPath: graphEditing.addDrawingPath,
    requestCreateDrawing: graphUi.requestCreateDrawing,
    setDrawingEnabled: graphUi.setDrawingEnabled,
    setDrawingColor: graphUi.setDrawingColor,
    setDrawingThickness: graphUi.setDrawingThickness,

    computeNode: graphComputation.computeNode,

    computeGraph: graphComputation.computeGraph,
  };
});
