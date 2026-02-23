import { create } from 'zustand';
import { Graph, GraphDrawing, DrawingPath, GraphNode, Connection, Position, ComputationResult } from '../types';
import axios from 'axios';

export type PencilColor = 'white' | 'green' | 'red';
export type PencilThickness = 1 | 3 | 9;

export interface NodeExecutionState {
  isComputing: boolean;
  hasError: boolean;
  isStale: boolean;
  errorMessage: string | null;
  lastRunAt: number | null;
}

export type NodeGraphicsOutputMap = Record<string, string | null>;

export interface GraphSummary {
  id: string;
  name: string;
  updatedAt: number;
}

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

const DEFAULT_NODE_EXECUTION_STATE: NodeExecutionState = {
  isComputing: false,
  hasError: false,
  isStale: false,
  errorMessage: null,
  lastRunAt: null,
};

function isErrorTextOutput(textOutput: unknown): boolean {
  return typeof textOutput === 'string' && /^\s*error:/i.test(textOutput.trim());
}

function resolveErrorMessage(error: any, fallback: string): string {
  if (typeof error?.response?.data?.error === 'string' && error.response.data.error.trim()) {
    return error.response.data.error;
  }
  if (typeof error?.message === 'string' && error.message.trim()) {
    return error.message;
  }
  return fallback;
}

function getNodeExecutionStateFromResult(result: any): NodeExecutionState {
  const hasError = isErrorTextOutput(result?.textOutput);
  return {
    isComputing: false,
    hasError,
    isStale: false,
    errorMessage: hasError ? result.textOutput : null,
    lastRunAt: typeof result?.timestamp === 'number' ? result.timestamp : Date.now(),
  };
}

function normalizeGraph(graph: Graph): Graph {
  return {
    ...graph,
    pythonEnvs: Array.isArray(graph.pythonEnvs) ? graph.pythonEnvs : [],
    drawings: Array.isArray(graph.drawings) ? graph.drawings : [],
  };
}

function buildNodeStateMapForGraph(
  graph: Graph,
  previous: Record<string, NodeExecutionState>
): Record<string, NodeExecutionState> {
  const nextStates: Record<string, NodeExecutionState> = {};
  for (const node of graph.nodes) {
    nextStates[node.id] = {
      ...DEFAULT_NODE_EXECUTION_STATE,
      ...(previous[node.id] ?? {}),
    };
  }
  return nextStates;
}

function normalizeGraphicsOutput(graphicsOutput: unknown): string | null {
  if (typeof graphicsOutput !== 'string') {
    return null;
  }

  const trimmed = graphicsOutput.trim();
  if (!trimmed.startsWith('data:image/')) {
    return null;
  }

  return trimmed;
}

function buildNodeGraphicsOutputMapForGraph(
  graph: Graph,
  previous: NodeGraphicsOutputMap
): NodeGraphicsOutputMap {
  const nextGraphicsOutputs: NodeGraphicsOutputMap = {};
  for (const node of graph.nodes) {
    nextGraphicsOutputs[node.id] = previous[node.id] ?? null;
  }
  return nextGraphicsOutputs;
}

function buildOutgoingAdjacency(graph: Graph): Map<string, string[]> {
  const outgoing = new Map<string, string[]>();
  for (const node of graph.nodes) {
    outgoing.set(node.id, []);
  }
  for (const connection of graph.connections) {
    outgoing.get(connection.sourceNodeId)?.push(connection.targetNodeId);
  }
  return outgoing;
}

function buildIncomingAdjacency(graph: Graph): Map<string, string[]> {
  const incoming = new Map<string, string[]>();
  for (const node of graph.nodes) {
    incoming.set(node.id, []);
  }
  for (const connection of graph.connections) {
    incoming.get(connection.targetNodeId)?.push(connection.sourceNodeId);
  }
  return incoming;
}

function deriveStaleNodeExecutionStates(
  graph: Graph,
  states: Record<string, NodeExecutionState>
): Record<string, NodeExecutionState> {
  const nextStates = buildNodeStateMapForGraph(graph, states);
  for (const nodeId of Object.keys(nextStates)) {
    nextStates[nodeId] = {
      ...nextStates[nodeId],
      isStale: false,
    };
  }

  const outgoing = buildOutgoingAdjacency(graph);
  const queue: string[] = [];
  const visited = new Set<string>();

  for (const [nodeId, state] of Object.entries(nextStates)) {
    if (state.hasError) {
      queue.push(nodeId);
      visited.add(nodeId);
    }
  }

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }

    for (const downstreamId of outgoing.get(current) || []) {
      if (!nextStates[downstreamId]) {
        continue;
      }
      if (!nextStates[downstreamId].hasError) {
        nextStates[downstreamId] = {
          ...nextStates[downstreamId],
          isStale: true,
        };
      }
      if (!visited.has(downstreamId)) {
        visited.add(downstreamId);
        queue.push(downstreamId);
      }
    }
  }

  return nextStates;
}

function hasErroredAncestor(
  nodeId: string,
  incoming: Map<string, string[]>,
  states: Record<string, NodeExecutionState>
): boolean {
  const queue = [...(incoming.get(nodeId) || [])];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || visited.has(current)) {
      continue;
    }
    visited.add(current);
    if (states[current]?.hasError) {
      return true;
    }
    for (const parentId of incoming.get(current) || []) {
      if (!visited.has(parentId)) {
        queue.push(parentId);
      }
    }
  }

  return false;
}

function connectionSignature(connection: Connection): string {
  return [
    connection.id,
    connection.sourceNodeId,
    connection.sourcePort,
    connection.targetNodeId,
    connection.targetPort,
  ].join('|');
}

function getAutoRecomputeEnabled(node: GraphNode): boolean {
  return Boolean(node.config.config?.autoRecompute);
}

function collectAutoRecomputeTargets(previousGraph: Graph, nextGraph: Graph): string[] {
  const previousNodeMap = new Map(previousGraph.nodes.map((node) => [node.id, node]));
  const nextNodeMap = new Map(nextGraph.nodes.map((node) => [node.id, node]));
  const roots = new Set<string>();

  for (const node of nextGraph.nodes) {
    const previousNode = previousNodeMap.get(node.id);
    if (!previousNode || previousNode.version !== node.version) {
      roots.add(node.id);
    }
  }

  const previousSignatures = new Set(previousGraph.connections.map(connectionSignature));
  const nextSignatures = new Set(nextGraph.connections.map(connectionSignature));
  const connectionsChanged =
    previousSignatures.size !== nextSignatures.size ||
    [...previousSignatures].some((signature) => !nextSignatures.has(signature));

  if (connectionsChanged) {
    for (const connection of nextGraph.connections) {
      const signature = connectionSignature(connection);
      if (!previousSignatures.has(signature)) {
        roots.add(connection.sourceNodeId);
        roots.add(connection.targetNodeId);
      }
    }

    for (const connection of previousGraph.connections) {
      const signature = connectionSignature(connection);
      if (!nextSignatures.has(signature)) {
        if (nextNodeMap.has(connection.sourceNodeId)) {
          roots.add(connection.sourceNodeId);
        }
        if (nextNodeMap.has(connection.targetNodeId)) {
          roots.add(connection.targetNodeId);
        }
      }
    }
  }

  if (roots.size === 0) {
    return [];
  }

  const outgoing = new Map<string, string[]>();
  for (const node of nextGraph.nodes) {
    outgoing.set(node.id, []);
  }
  for (const connection of nextGraph.connections) {
    const neighbors = outgoing.get(connection.sourceNodeId);
    if (neighbors) {
      neighbors.push(connection.targetNodeId);
    }
  }

  const impacted = new Set<string>();
  const queue = [...roots];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || impacted.has(current)) {
      continue;
    }
    impacted.add(current);

    const neighbors = outgoing.get(current) || [];
    for (const neighbor of neighbors) {
      if (!impacted.has(neighbor)) {
        queue.push(neighbor);
      }
    }
  }

  const targets = nextGraph.nodes
    .filter((node) => getAutoRecomputeEnabled(node) && impacted.has(node.id))
    .map((node) => node.id);

  if (targets.length <= 1) {
    return targets;
  }

  const targetSet = new Set(targets);
  const nodeOrder = new Map(nextGraph.nodes.map((node, index) => [node.id, index]));
  const inDegree = new Map<string, number>(targets.map((nodeId) => [nodeId, 0]));
  const outgoingTargets = new Map<string, string[]>(targets.map((nodeId) => [nodeId, []]));

  for (const connection of nextGraph.connections) {
    if (!targetSet.has(connection.sourceNodeId) || !targetSet.has(connection.targetNodeId)) {
      continue;
    }
    outgoingTargets.get(connection.sourceNodeId)?.push(connection.targetNodeId);
    inDegree.set(connection.targetNodeId, (inDegree.get(connection.targetNodeId) || 0) + 1);
  }

  const topoQueue = targets.filter((nodeId) => (inDegree.get(nodeId) || 0) === 0);
  topoQueue.sort((left, right) => (nodeOrder.get(left) || 0) - (nodeOrder.get(right) || 0));

  const ordered: string[] = [];
  while (topoQueue.length > 0) {
    const nodeId = topoQueue.shift()!;
    ordered.push(nodeId);

    for (const targetNodeId of outgoingTargets.get(nodeId) || []) {
      const nextDegree = (inDegree.get(targetNodeId) || 0) - 1;
      inDegree.set(targetNodeId, nextDegree);
      if (nextDegree === 0) {
        topoQueue.push(targetNodeId);
      }
    }
    topoQueue.sort((left, right) => (nodeOrder.get(left) || 0) - (nodeOrder.get(right) || 0));
  }

  // Fallback for defensive handling of malformed/cyclic target subsets.
  if (ordered.length !== targets.length) {
    return targets;
  }

  return ordered;
}

export const useGraphStore = create<GraphStore>((set, get) => {
  let latestUpdateRequestId = 0;
  let autoRecomputeDrainRunning = false;
  let pendingAutoRecomputeBatch: string[] | null = null;

  const withDerivedExecutionState = (
    graph: Graph | null,
    states: Record<string, NodeExecutionState>
  ): Record<string, NodeExecutionState> => {
    if (!graph) {
      return states;
    }
    return deriveStaleNodeExecutionStates(graph, states);
  };

  const hydrateNodeExecutionStates = async (graph: Graph) => {
    const nodeStateEntries = await Promise.all(graph.nodes.map(async (node) => {
      try {
        const response = await axios.get(`/api/nodes/${node.id}/result`);
        return {
          nodeId: node.id,
          executionState: getNodeExecutionStateFromResult(response.data),
          graphicsOutput: normalizeGraphicsOutput(response.data?.graphicsOutput),
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
      nodeExecutionStates: withDerivedExecutionState(graph, hydratedStates),
      nodeGraphicsOutputs: hydratedGraphicsOutputs,
    });
  };

  const mergeNodeExecutionState = (nodeId: string, patch: Partial<NodeExecutionState>) => {
    set((state) => ({
      nodeExecutionStates: withDerivedExecutionState(state.graph, {
        ...state.nodeExecutionStates,
        [nodeId]: {
          ...(state.nodeExecutionStates[nodeId] ?? DEFAULT_NODE_EXECUTION_STATE),
          ...patch,
        },
      }),
    }));
  };

  const runAutoRecomputeDrain = async () => {
    if (autoRecomputeDrainRunning) {
      return;
    }

    autoRecomputeDrainRunning = true;
    try {
      while (pendingAutoRecomputeBatch && pendingAutoRecomputeBatch.length > 0) {
        const batch = pendingAutoRecomputeBatch;
        pendingAutoRecomputeBatch = null;

        const currentGraph = get().graph;
        if (!currentGraph) {
          continue;
        }

        const nodeMap = new Map(currentGraph.nodes.map((node) => [node.id, node]));
        const incoming = buildIncomingAdjacency(currentGraph);
        const validNodeIds = batch.filter((nodeId) => {
          const node = nodeMap.get(nodeId);
          return Boolean(node && getAutoRecomputeEnabled(node));
        });

        for (const nodeId of validNodeIds) {
          const currentNodeStates = get().nodeExecutionStates;
          if (hasErroredAncestor(nodeId, incoming, currentNodeStates)) {
            continue;
          }
          await get().computeNode(nodeId);
        }
      }
    } finally {
      autoRecomputeDrainRunning = false;
      if (pendingAutoRecomputeBatch && pendingAutoRecomputeBatch.length > 0) {
        void runAutoRecomputeDrain();
      }
    }
  };

  const triggerAutoRecompute = (nodeIds: string[]) => {
    if (nodeIds.length === 0) {
      return;
    }

    // Single-slot queue: keep only the latest undrained impacted batch.
    pendingAutoRecomputeBatch = [...new Set(nodeIds)];
    void runAutoRecomputeDrain();
  };

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
    drawingEnabled: false,
    drawingColor: 'white',
    drawingThickness: 3,
    drawingCreateRequestId: 0,

    loadGraph: async (id: string) => {
      set({ isLoading: true, error: null });
      try {
        const response = await axios.get(`/api/graphs/${id}`);
        const graph = normalizeGraph(response.data as Graph);
        set({
          graph,
          selectedNodeId: null,
          selectedDrawingId: null,
          isLoading: false,
          nodeExecutionStates: withDerivedExecutionState(
            graph,
            buildNodeStateMapForGraph(graph, get().nodeExecutionStates)
          ),
          nodeGraphicsOutputs: buildNodeGraphicsOutputMapForGraph(graph, get().nodeGraphicsOutputs),
        });
        upsertGraphSummary({
          id: graph.id,
          name: graph.name,
          updatedAt: graph.updatedAt,
        });
        await hydrateNodeExecutionStates(graph);
        try {
          localStorage.setItem('k8v-current-graph-id', id);
        } catch (storageError) {
          console.warn('Could not save to localStorage:', storageError);
        }
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
        const response = await axios.post('/api/graphs', { name });
        const newGraph = normalizeGraph(response.data as Graph);
        set({
          graph: newGraph,
          selectedNodeId: null,
          selectedDrawingId: null,
          isLoading: false,
          error: null,
          nodeExecutionStates: withDerivedExecutionState(
            newGraph,
            buildNodeStateMapForGraph(newGraph, {})
          ),
          nodeGraphicsOutputs: buildNodeGraphicsOutputMapForGraph(newGraph, {}),
        });
        upsertGraphSummary({
          id: newGraph.id,
          name: newGraph.name,
          updatedAt: newGraph.updatedAt,
        });
        try {
          localStorage.setItem('k8v-current-graph-id', newGraph.id);
        } catch (storageError) {
          console.warn('Could not save to localStorage:', storageError);
        }
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
        await axios.delete(`/api/graphs/${id}`);
        removeGraphSummary(id);

        try {
          if (localStorage.getItem('k8v-current-graph-id') === id) {
            localStorage.removeItem('k8v-current-graph-id');
          }
        } catch (storageError) {
          console.warn('Could not update localStorage after graph deletion:', storageError);
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
        const response = await axios.get('/api/graphs/latest');
        const graph = normalizeGraph(response.data as Graph);
        set({
          graph,
          selectedNodeId: null,
          selectedDrawingId: null,
          isLoading: false,
          nodeExecutionStates: withDerivedExecutionState(
            graph,
            buildNodeStateMapForGraph(graph, get().nodeExecutionStates)
          ),
          nodeGraphicsOutputs: buildNodeGraphicsOutputMapForGraph(graph, get().nodeGraphicsOutputs),
        });
        upsertGraphSummary({
          id: graph.id,
          name: graph.name,
          updatedAt: graph.updatedAt,
        });
        await hydrateNodeExecutionStates(graph);
        try {
          localStorage.setItem('k8v-current-graph-id', graph.id);
        } catch (storageError) {
          console.warn('Could not save to localStorage:', storageError);
        }
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
        const response = await axios.get('/api/graphs');
        const nextSummaries = Array.isArray(response.data?.graphs)
          ? (response.data.graphs as GraphSummary[])
              .filter((summary) =>
                summary &&
                typeof summary.id === 'string' &&
                typeof summary.name === 'string' &&
                typeof summary.updatedAt === 'number'
              )
              .sort((left, right) => right.updatedAt - left.updatedAt)
          : [];
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
        let savedGraphId: string | null = null;
        try {
          savedGraphId = localStorage.getItem('k8v-current-graph-id');
          console.log('Saved graph ID:', savedGraphId);
        } catch (storageError) {
          console.warn('localStorage not available, skipping saved graph ID:', storageError);
        }

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
              try {
                localStorage.removeItem('k8v-current-graph-id');
              } catch {
                // Ignore localStorage errors
              }
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
            try {
              localStorage.removeItem('k8v-current-graph-id');
            } catch {
              // Ignore localStorage errors
            }
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

      set({
        graph: updatedGraph,
        isLoading: false,
        error: null,
        nodeExecutionStates: withDerivedExecutionState(
          updatedGraph,
          buildNodeStateMapForGraph(updatedGraph, nodeExecutionStates)
        ),
        nodeGraphicsOutputs: buildNodeGraphicsOutputMapForGraph(updatedGraph, nodeGraphicsOutputs),
      });

      try {
        const response = await axios.put(`/api/graphs/${graph.id}`, updatedGraph);
        if (requestId !== latestUpdateRequestId) {
          return;
        }

        const persistedGraph = normalizeGraph(response.data as Graph);
        const autoRecomputeTargets = collectAutoRecomputeTargets(graph, persistedGraph);

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
          nodeExecutionStates: withDerivedExecutionState(
            persistedGraph,
            buildNodeStateMapForGraph(persistedGraph, state.nodeExecutionStates)
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

        try {
          localStorage.setItem('k8v-current-graph-id', persistedGraph.id);
        } catch (storageError) {
          console.warn('Could not save to localStorage:', storageError);
        }

        triggerAutoRecompute(autoRecomputeTargets);
      } catch (error: any) {
        if (requestId !== latestUpdateRequestId) {
          return;
        }
        const serverMessage = resolveErrorMessage(error, 'Failed to update graph');
        set({
          graph,
          error: serverMessage,
          isLoading: false,
          nodeExecutionStates: withDerivedExecutionState(
            graph,
            buildNodeStateMapForGraph(graph, nodeExecutionStates)
          ),
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

      const updatedNodes = graph.nodes.map((node) =>
        node.id === nodeId ? { ...node, position } : node
      );

      const updatedGraph = {
        ...graph,
        nodes: updatedNodes,
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

      const updatedGraph = {
        ...graph,
        nodes: updatedNodes,
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
      set({ selectedNodeId: nodeId, selectedDrawingId: null });
    },

    selectDrawing: (drawingId: string | null) => {
      if (get().selectedDrawingId === drawingId && get().selectedNodeId === null) return;
      set({ selectedDrawingId: drawingId, selectedNodeId: null });
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
      set({ drawingColor: color });
    },

    setDrawingThickness: (thickness: PencilThickness) => {
      set({ drawingThickness: thickness });
    },

    computeNode: async (nodeId: string) => {
      const { graph } = get();
      if (!graph) return;

      mergeNodeExecutionState(nodeId, {
        isComputing: true,
        hasError: false,
        errorMessage: null,
      });

      try {
        const response = await axios.post(`/api/graphs/${graph.id}/compute`, { nodeId });
        const result = response.data as ComputationResult;
        const nextState = getNodeExecutionStateFromResult(result);

        mergeNodeExecutionState(nodeId, nextState);
        set((state) => ({
          nodeGraphicsOutputs: {
            ...state.nodeGraphicsOutputs,
            [nodeId]: normalizeGraphicsOutput(result?.graphicsOutput),
          },
        }));
        set({ resultRefreshKey: Date.now() });
      } catch (error: any) {
        const message = resolveErrorMessage(error, 'Failed to compute node');
        mergeNodeExecutionState(nodeId, {
          isComputing: false,
          hasError: true,
          errorMessage: message,
          lastRunAt: Date.now(),
        });
        set({ error: message });
      }
    },

    computeGraph: async () => {
      const { graph } = get();
      if (!graph) return;

      set((state) => {
        const nextStates = { ...state.nodeExecutionStates };
        for (const node of graph.nodes) {
          nextStates[node.id] = {
            ...(nextStates[node.id] ?? DEFAULT_NODE_EXECUTION_STATE),
            isComputing: true,
            hasError: false,
            errorMessage: null,
          };
        }
        return {
          isLoading: true,
          error: null,
          nodeExecutionStates: withDerivedExecutionState(graph, nextStates),
        };
      });

      try {
        const response = await axios.post(`/api/graphs/${graph.id}/compute`, {});
        const results = Array.isArray(response.data) ? response.data : [];

        set((state) => {
          const nextStates = { ...state.nodeExecutionStates };
          const nextGraphicsOutputs = buildNodeGraphicsOutputMapForGraph(
            graph,
            state.nodeGraphicsOutputs
          );
          for (const node of graph.nodes) {
            nextStates[node.id] = {
              ...(nextStates[node.id] ?? DEFAULT_NODE_EXECUTION_STATE),
              isComputing: false,
            };
          }
          for (const result of results) {
            if (result?.nodeId) {
              nextStates[result.nodeId] = getNodeExecutionStateFromResult(result);
              nextGraphicsOutputs[result.nodeId] = normalizeGraphicsOutput(result.graphicsOutput);
            }
          }

          return {
            nodeExecutionStates: withDerivedExecutionState(graph, nextStates),
            nodeGraphicsOutputs: nextGraphicsOutputs,
            isLoading: false,
            error: null,
            resultRefreshKey: Date.now(),
          };
        });
      } catch (error: any) {
        const message = resolveErrorMessage(error, 'Failed to compute graph');
        set((state) => {
          const nextStates = { ...state.nodeExecutionStates };
          for (const node of graph.nodes) {
            nextStates[node.id] = {
              ...(nextStates[node.id] ?? DEFAULT_NODE_EXECUTION_STATE),
              isComputing: false,
            };
          }
          return {
            nodeExecutionStates: withDerivedExecutionState(graph, nextStates),
            error: message,
            isLoading: false,
          };
        });
      }
    },
  };
});
