import { create } from 'zustand';
import {
  Graph,
  GraphDrawing,
  DrawingPath,
  GraphNode,
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
import { clearGraphViewportTransform } from '../utils/uiPersistence';
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
  DEFAULT_DRAWING_COLOR,
  normalizeGraph,
  parseGraphSummariesResponse,
  resolveErrorMessage,
  type BackendRecomputeStatus,
} from './graphStoreState';
import { createGraphStoreUiController } from './graphStoreUi';
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
  PencilColor,
  PencilThickness,
} from './graphStoreTypes';

interface GraphStore extends GraphStorePersistenceState, GraphStoreComputationState {
  graphSummaries: GraphSummary[];
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
  const graphComputation = createGraphComputationController({
    api: graphApi,
    getState: () => get(),
    setState: (partial) => set(partial as Parameters<typeof set>[0]),
    startRecomputeStatusPolling: (graphId) => recomputeStatusPolling.start(graphId),
  });

  const recomputeStatusPolling = createRecomputeStatusPollController<BackendRecomputeStatus>({
    fetchStatus: graphApi.fetchRecomputeStatus,
    onStatus: (graphId, status) => {
      const currentGraph = get().graph;
      if (!currentGraph || currentGraph.id !== graphId) {
        return;
      }

      graphComputation.applyBackendRecomputeStatus(currentGraph, status);
    },
    shouldContinue: (graphId) => get().graph?.id === graphId,
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

  const syncPersistedGraph = (graph: Graph) => {
    upsertGraphSummary({
      id: graph.id,
      name: graph.name,
      updatedAt: graph.updatedAt,
    });
    saveCurrentGraphId(graph.id);
    recomputeStatusPolling.start(graph.id);
  };

  const graphPersistence = createGraphUpdatePersistenceController({
    api: graphApi,
    getState: () => get(),
    setState: (partial) => set(partial as Parameters<typeof set>[0]),
    syncPersistedGraph,
  });

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
    selectedNodeId: null,
    selectedNodeIds: [],
    selectedDrawingId: null,
    isLoading: false,
    error: null,
    resultRefreshKey: 0,
    nodeExecutionStates: {},
    nodeGraphicsOutputs: {},
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
          nodeExecutionStates: get().nodeExecutionStates,
          nodeGraphicsOutputs: get().nodeGraphicsOutputs,
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
          nodeExecutionStates: {},
          nodeGraphicsOutputs: {},
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
        clearGraphViewportTransform(id);

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
          nodeExecutionStates: get().nodeExecutionStates,
          nodeGraphicsOutputs: get().nodeGraphicsOutputs,
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

    updateGraph: graphPersistence.updateGraph,

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
