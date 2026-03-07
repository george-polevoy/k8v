import { create } from 'zustand';
import {
  Graph,
  GraphDrawing,
  DrawingPath,
  GraphNode,
  Connection,
  Position,
  ComputationResult,
} from '../types';
import { normalizeHexColor } from '../utils/color';
import {
  DEFAULT_GRAPH_PROJECTION_ID,
  withNodeCardSizeInProjection,
  withNodePositionInProjection,
} from '../utils/projections';
import { graphApi } from './graphApi';
import {
  clearCurrentGraphId,
  clearCurrentGraphIdIfMatches,
  readCurrentGraphId,
  saveCurrentGraphId,
} from './graphLocalStorage';
import { createRecomputeStatusPollController } from './recomputeStatusPolling';
import {
  buildNodeGraphicsOutputMapForGraph,
  buildNodeStateMapForGraph,
  DEFAULT_DRAWING_COLOR,
  DEFAULT_NODE_EXECUTION_STATE,
  getNodeExecutionStateFromResult,
  normalizeBackendNodeExecutionState,
  normalizeGraph,
  normalizeGraphicsOutput,
  parseGraphSummariesResponse,
  resolveErrorMessage,
  type BackendRecomputeStatus,
} from './graphStoreState';
import type {
  GraphSummary,
  NodeExecutionState,
  NodeGraphicsComputationDebug,
  NodeGraphicsOutputMap,
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

interface GraphStore {
  graph: Graph | null;
  graphSummaries: GraphSummary[];
  selectedNodeId: string | null;
  selectedDrawingId: string | null;
  isLoading: boolean;
  error: string | null;
  resultRefreshKey: number;
  nodeExecutionStates: Record<string, NodeExecutionState>;
  nodeGraphicsOutputs: NodeGraphicsOutputMap;
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
  let latestUpdateRequestId = 0;

  const hydrateNodeExecutionStates = async (graph: Graph) => {
    const nodeStateEntries = await Promise.all(graph.nodes.map(async (node) => {
      try {
        const response = await graphApi.fetchNodeResult(node.id);
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

    set({
      nodeExecutionStates: buildNodeStateMapForGraph(graph, hydratedStates),
      nodeGraphicsOutputs: hydratedGraphicsOutputs,
    });
  };

  const refreshNodeResultSnapshots = async (graphId: string, nodeIds: string[]) => {
    const uniqueNodeIds = [...new Set(nodeIds)];
    if (uniqueNodeIds.length === 0) {
      return;
    }

    const snapshots = await Promise.all(uniqueNodeIds.map(async (nodeId) => {
      try {
        const response = await graphApi.fetchNodeResult(nodeId);
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

    set((state) => {
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

  const applyBackendRecomputeStatus = (graph: Graph, status: BackendRecomputeStatus) => {
    const backendStates = status?.nodeStates ?? {};
    const completedNodeIds: string[] = [];

    set((state) => {
      if (!state.graph || state.graph.id !== graph.id) {
        return {};
      }

      const nextNodeStates = buildNodeStateMapForGraph(graph, state.nodeExecutionStates);
      for (const node of graph.nodes) {
        const previousState = nextNodeStates[node.id];
        const backendState = normalizeBackendNodeExecutionState(backendStates[node.id], previousState);
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

      return {
        nodeExecutionStates: nextNodeStates,
        resultRefreshKey: shouldRefreshSelectedNode ? Date.now() : state.resultRefreshKey,
      };
    });

    if (completedNodeIds.length > 0) {
      void refreshNodeResultSnapshots(graph.id, completedNodeIds);
    }
  };

  const recomputeStatusPolling = createRecomputeStatusPollController<BackendRecomputeStatus>({
    fetchStatus: graphApi.fetchRecomputeStatus,
    onStatus: (graphId, status) => {
      const currentGraph = get().graph;
      if (!currentGraph || currentGraph.id !== graphId) {
        return;
      }

      applyBackendRecomputeStatus(currentGraph, status);
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

  return {
    graph: null,
    graphSummaries: [],
    selectedNodeId: null,
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
        set({
          graph,
          selectedNodeId: null,
          selectedDrawingId: null,
          isLoading: false,
          nodeExecutionStates: buildNodeStateMapForGraph(graph, get().nodeExecutionStates),
          nodeGraphicsOutputs: buildNodeGraphicsOutputMapForGraph(graph, get().nodeGraphicsOutputs),
        });
        upsertGraphSummary({
          id: graph.id,
          name: graph.name,
          updatedAt: graph.updatedAt,
        });
        await hydrateNodeExecutionStates(graph);
        recomputeStatusPolling.start(graph.id);
        saveCurrentGraphId(graph.id);
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
        set({
          graph: newGraph,
          selectedNodeId: null,
          selectedDrawingId: null,
          isLoading: false,
          error: null,
          nodeExecutionStates: buildNodeStateMapForGraph(newGraph, {}),
          nodeGraphicsOutputs: buildNodeGraphicsOutputMapForGraph(newGraph, {}),
        });
        upsertGraphSummary({
          id: newGraph.id,
          name: newGraph.name,
          updatedAt: newGraph.updatedAt,
        });
        recomputeStatusPolling.start(newGraph.id);
        saveCurrentGraphId(newGraph.id);
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
        set({
          graph,
          selectedNodeId: null,
          selectedDrawingId: null,
          isLoading: false,
          nodeExecutionStates: buildNodeStateMapForGraph(graph, get().nodeExecutionStates),
          nodeGraphicsOutputs: buildNodeGraphicsOutputMapForGraph(graph, get().nodeGraphicsOutputs),
        });
        upsertGraphSummary({
          id: graph.id,
          name: graph.name,
          updatedAt: graph.updatedAt,
        });
        await hydrateNodeExecutionStates(graph);
        recomputeStatusPolling.start(graph.id);
        saveCurrentGraphId(graph.id);
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

    updateGraph: async (updates: Partial<Graph>) => {
      const { graph, nodeExecutionStates, nodeGraphicsOutputs } = get();
      if (!graph) return;

      const updatedGraph = normalizeGraph({ ...graph, ...updates } as Graph);
      const requestId = latestUpdateRequestId + 1;
      latestUpdateRequestId = requestId;
      const ifMatchUpdatedAt = graph.updatedAt;

      set({
        graph: updatedGraph,
        isLoading: false,
        error: null,
        nodeExecutionStates: buildNodeStateMapForGraph(updatedGraph, nodeExecutionStates),
        nodeGraphicsOutputs: buildNodeGraphicsOutputMapForGraph(updatedGraph, nodeGraphicsOutputs),
      });

      try {
        const persistedGraph = normalizeGraph(await graphApi.updateGraph(graph.id, {
          ...updatedGraph,
          ifMatchUpdatedAt,
        }));
        if (requestId !== latestUpdateRequestId) {
          return;
        }

        set((state) => ({
          graph: persistedGraph,
          selectedNodeId:
            state.selectedNodeId && persistedGraph.nodes.some((node) => node.id === state.selectedNodeId)
              ? state.selectedNodeId
              : null,
          selectedDrawingId:
            state.selectedDrawingId &&
            persistedGraph.drawings?.some((drawing) => drawing.id === state.selectedDrawingId)
              ? state.selectedDrawingId
              : null,
          isLoading: false,
          error: null,
          nodeExecutionStates: buildNodeStateMapForGraph(
            persistedGraph,
            state.nodeExecutionStates
          ),
          nodeGraphicsOutputs: buildNodeGraphicsOutputMapForGraph(
            persistedGraph,
            state.nodeGraphicsOutputs
          ),
        }));
        upsertGraphSummary({
          id: persistedGraph.id,
          name: persistedGraph.name,
          updatedAt: persistedGraph.updatedAt,
        });
        saveCurrentGraphId(persistedGraph.id);
        recomputeStatusPolling.start(persistedGraph.id);
      } catch (error: any) {
        if (requestId !== latestUpdateRequestId) {
          return;
        }

        if (error?.response?.status === 409) {
          try {
            const latestGraph = normalizeGraph(await graphApi.fetchGraph(graph.id));
            if (requestId !== latestUpdateRequestId) {
              return;
            }
            set((state) => ({
              graph: latestGraph,
              selectedNodeId:
                state.selectedNodeId && latestGraph.nodes.some((node) => node.id === state.selectedNodeId)
                  ? state.selectedNodeId
                  : null,
              selectedDrawingId:
                state.selectedDrawingId &&
                latestGraph.drawings?.some((drawing) => drawing.id === state.selectedDrawingId)
                  ? state.selectedDrawingId
                  : null,
              error: 'Graph changed remotely. Reloaded latest graph state.',
              isLoading: false,
              nodeExecutionStates: buildNodeStateMapForGraph(
                latestGraph,
                state.nodeExecutionStates
              ),
              nodeGraphicsOutputs: buildNodeGraphicsOutputMapForGraph(
                latestGraph,
                state.nodeGraphicsOutputs
              ),
            }));

            upsertGraphSummary({
              id: latestGraph.id,
              name: latestGraph.name,
              updatedAt: latestGraph.updatedAt,
            });
            saveCurrentGraphId(latestGraph.id);
            recomputeStatusPolling.start(latestGraph.id);
            return;
          } catch (reloadError: any) {
            if (requestId !== latestUpdateRequestId) {
              return;
            }
            const reloadMessage = resolveErrorMessage(
              reloadError,
              'Graph changed remotely and latest graph could not be reloaded'
            );
            set({
              graph,
              error: reloadMessage,
              isLoading: false,
              nodeExecutionStates: buildNodeStateMapForGraph(graph, nodeExecutionStates),
              nodeGraphicsOutputs: buildNodeGraphicsOutputMapForGraph(graph, nodeGraphicsOutputs),
            });
            return;
          }
        }

        const serverMessage = resolveErrorMessage(error, 'Failed to update graph');
        set({
          graph,
          error: serverMessage,
          isLoading: false,
          nodeExecutionStates: buildNodeStateMapForGraph(graph, nodeExecutionStates),
          nodeGraphicsOutputs: buildNodeGraphicsOutputMapForGraph(graph, nodeGraphicsOutputs),
        });
      }
    },

    addNode: (node: GraphNode) => {
      const { graph } = get();
      if (!graph) return;

      const updatedGraph = {
        ...graph,
        nodes: [...graph.nodes, node],
        updatedAt: Date.now(),
      };
      get().updateGraph(updatedGraph);
    },

    updateNode: (nodeId: string, updates: Partial<GraphNode>) => {
      const { graph } = get();
      if (!graph) return;

      const updatedNodes = graph.nodes.map((node) =>
        node.id === nodeId ? { ...node, ...updates, version: Date.now().toString() } : node
      );

      const updatedGraph = {
        ...graph,
        nodes: updatedNodes,
        updatedAt: Date.now(),
      };
      get().updateGraph(updatedGraph);
    },

    updateNodePosition: (nodeId: string, position: Position) => {
      const { graph } = get();
      if (!graph) return;

      const activeProjectionId = graph.activeProjectionId ?? DEFAULT_GRAPH_PROJECTION_ID;
      const updatedNodes = graph.nodes.map((node) =>
        node.id === nodeId ? { ...node, position } : node
      );
      const updatedProjections = (graph.projections ?? []).map((projection) =>
        projection.id === activeProjectionId
          ? withNodePositionInProjection(projection, nodeId, position)
          : projection
      );

      const updatedGraph = {
        ...graph,
        nodes: updatedNodes,
        projections: updatedProjections,
        updatedAt: Date.now(),
      };
      get().updateGraph(updatedGraph);
    },

    updateNodeCardSize: (nodeId: string, width: number, height: number) => {
      const { graph } = get();
      if (!graph) return;

      const updatedNodes = graph.nodes.map((node) => {
        if (node.id !== nodeId) {
          return node;
        }

        return {
          ...node,
          config: {
            ...node.config,
            config: {
              ...(node.config.config ?? {}),
              cardWidth: width,
              cardHeight: height,
            },
          },
        };
      });
      const activeProjectionId = graph.activeProjectionId ?? DEFAULT_GRAPH_PROJECTION_ID;
      const updatedProjections = (graph.projections ?? []).map((projection) =>
        projection.id === activeProjectionId
          ? withNodeCardSizeInProjection(projection, nodeId, { width, height })
          : projection
      );

      const updatedGraph = {
        ...graph,
        nodes: updatedNodes,
        projections: updatedProjections,
        updatedAt: Date.now(),
      };
      get().updateGraph(updatedGraph);
    },

    deleteNode: (nodeId: string) => {
      const { graph } = get();
      if (!graph) return;

      const updatedNodes = graph.nodes.filter((node) => node.id !== nodeId);
      const updatedConnections = graph.connections.filter(
        (conn) => conn.sourceNodeId !== nodeId && conn.targetNodeId !== nodeId
      );

      const updatedGraph = {
        ...graph,
        nodes: updatedNodes,
        connections: updatedConnections,
        updatedAt: Date.now(),
      };
      get().updateGraph(updatedGraph);
    },

    addConnection: (connection: Connection) => {
      const { graph } = get();
      if (!graph) return;

      const updatedGraph = {
        ...graph,
        connections: [...graph.connections, connection],
        updatedAt: Date.now(),
      };
      get().updateGraph(updatedGraph);
    },

    deleteConnection: (connectionId: string) => {
      const { graph } = get();
      if (!graph) return;

      const updatedGraph = {
        ...graph,
        connections: graph.connections.filter((conn) => conn.id !== connectionId),
        updatedAt: Date.now(),
      };
      get().updateGraph(updatedGraph);
    },

    deleteConnections: (connectionIds: string[]) => {
      const { graph } = get();
      if (!graph) return;

      const connectionIdSet = new Set(connectionIds);
      const validConnections = graph.connections.filter((conn) => connectionIdSet.has(conn.id));

      if (validConnections.length === 0) {
        console.warn('No valid connections found to delete:', connectionIds);
        return;
      }

      if (validConnections.length !== connectionIds.length) {
        console.warn(
          `Some connection IDs were not found. Requested: ${connectionIds.length}, Found: ${validConnections.length}`
        );
      }

      const updatedGraph = {
        ...graph,
        connections: graph.connections.filter((conn) => !connectionIdSet.has(conn.id)),
        updatedAt: Date.now(),
      };

      get().updateGraph(updatedGraph);
    },

    selectNode: (nodeId: string | null) => {
      if (get().selectedNodeId === nodeId && get().selectedDrawingId === null) return;
      set({ selectedNodeId: nodeId, selectedDrawingId: null, selectedNodeGraphicsDebug: null });
    },

    selectDrawing: (drawingId: string | null) => {
      if (get().selectedDrawingId === drawingId && get().selectedNodeId === null) return;
      set({ selectedDrawingId: drawingId, selectedNodeId: null, selectedNodeGraphicsDebug: null });
    },

    setSelectedNodeGraphicsDebug: (debug: NodeGraphicsComputationDebug | null) => {
      set({ selectedNodeGraphicsDebug: debug });
    },

    addDrawing: (drawing: GraphDrawing) => {
      const { graph } = get();
      if (!graph) return;

      const updatedGraph = {
        ...graph,
        drawings: [...(graph.drawings ?? []), drawing],
        updatedAt: Date.now(),
      };
      void get().updateGraph(updatedGraph);
    },

    updateDrawing: (drawingId: string, updates: Partial<GraphDrawing>) => {
      const { graph } = get();
      if (!graph) return;

      const updatedGraph = {
        ...graph,
        drawings: (graph.drawings ?? []).map((drawing) =>
          drawing.id === drawingId
            ? {
                ...drawing,
                ...updates,
              }
            : drawing
        ),
        updatedAt: Date.now(),
      };
      void get().updateGraph(updatedGraph);
    },

    updateDrawingPosition: (drawingId: string, position: Position) => {
      const { graph } = get();
      if (!graph) return;

      const updatedGraph = {
        ...graph,
        drawings: (graph.drawings ?? []).map((drawing) =>
          drawing.id === drawingId
            ? {
                ...drawing,
                position,
              }
            : drawing
        ),
        updatedAt: Date.now(),
      };
      void get().updateGraph(updatedGraph);
    },

    deleteDrawing: (drawingId: string) => {
      const { graph, selectedDrawingId } = get();
      if (!graph) return;

      const updatedGraph = {
        ...graph,
        drawings: (graph.drawings ?? []).filter((drawing) => drawing.id !== drawingId),
        updatedAt: Date.now(),
      };

      if (selectedDrawingId === drawingId) {
        set({ selectedDrawingId: null });
      }

      void get().updateGraph(updatedGraph);
    },

    addDrawingPath: (drawingId: string, path: DrawingPath) => {
      const { graph } = get();
      if (!graph) return;

      const updatedGraph = {
        ...graph,
        drawings: (graph.drawings ?? []).map((drawing) =>
          drawing.id === drawingId
            ? {
                ...drawing,
                paths: [...drawing.paths, path],
              }
            : drawing
        ),
        updatedAt: Date.now(),
      };
      void get().updateGraph(updatedGraph);
    },

    requestCreateDrawing: () => {
      set((state) => ({
        drawingCreateRequestId: state.drawingCreateRequestId + 1,
      }));
    },

    setDrawingEnabled: (enabled: boolean) => {
      set({ drawingEnabled: enabled });
    },

    setDrawingColor: (color: PencilColor) => {
      set({ drawingColor: normalizeHexColor(color, DEFAULT_DRAWING_COLOR) });
    },

    setDrawingThickness: (thickness: PencilThickness) => {
      set({ drawingThickness: thickness });
    },

    computeNode: async (nodeId: string) => {
      const { graph } = get();
      if (!graph) return;

      set((state) => ({
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
        const result = await graphApi.computeGraph(graph.id, nodeId) as ComputationResult;
        const activeGraph = get().graph;
        if (!activeGraph || activeGraph.id !== graph.id) {
          return;
        }

        set((state) => {
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

        recomputeStatusPolling.start(graph.id);
      } catch (error: any) {
        const message = resolveErrorMessage(error, 'Failed to compute node');
        set((state) => ({
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
    },

    computeGraph: async () => {
      const { graph } = get();
      if (!graph) return;

      set((state) => {
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
        const response = await graphApi.computeGraph(graph.id);
        const results = Array.isArray(response) ? response : [];
        const activeGraph = get().graph;
        if (!activeGraph || activeGraph.id !== graph.id) {
          return;
        }

        set((state) => {
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
        recomputeStatusPolling.start(graph.id);
      } catch (error: any) {
        const message = resolveErrorMessage(error, 'Failed to compute graph');
        set((state) => {
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
    },
  };
});
