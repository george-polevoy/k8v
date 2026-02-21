import { create } from 'zustand';
import { Graph, GraphNode, Connection, Position, ComputationResult } from '../types';
import axios from 'axios';

export interface NodeExecutionState {
  isComputing: boolean;
  hasError: boolean;
  errorMessage: string | null;
  lastRunAt: number | null;
}

interface GraphStore {
  graph: Graph | null;
  selectedNodeId: string | null;
  isLoading: boolean;
  error: string | null;
  resultRefreshKey: number;
  nodeExecutionStates: Record<string, NodeExecutionState>;

  // Actions
  loadGraph: (id: string) => Promise<void>;
  loadLatestGraph: () => Promise<void>;
  createGraph: (name: string) => Promise<void>;
  updateGraph: (graph: Partial<Graph>) => Promise<void>;
  initializeGraph: () => Promise<void>;
  addNode: (node: GraphNode) => void;
  updateNode: (nodeId: string, updates: Partial<GraphNode>) => void;
  updateNodePosition: (nodeId: string, position: Position) => void;
  deleteNode: (nodeId: string) => void;
  addConnection: (connection: Connection) => void;
  deleteConnection: (connectionId: string) => void;
  deleteConnections: (connectionIds: string[]) => void;
  selectNode: (nodeId: string | null) => void;
  computeNode: (nodeId: string) => Promise<void>;
  computeGraph: () => Promise<void>;
}

const DEFAULT_NODE_EXECUTION_STATE: NodeExecutionState = {
  isComputing: false,
  hasError: false,
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
    errorMessage: hasError ? result.textOutput : null,
    lastRunAt: typeof result?.timestamp === 'number' ? result.timestamp : Date.now(),
  };
}

function buildNodeStateMapForGraph(
  graph: Graph,
  previous: Record<string, NodeExecutionState>
): Record<string, NodeExecutionState> {
  const nextStates: Record<string, NodeExecutionState> = {};
  for (const node of graph.nodes) {
    nextStates[node.id] = previous[node.id] ?? { ...DEFAULT_NODE_EXECUTION_STATE };
  }
  return nextStates;
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

  return nextGraph.nodes
    .filter((node) => getAutoRecomputeEnabled(node) && impacted.has(node.id))
    .map((node) => node.id);
}

export const useGraphStore = create<GraphStore>((set, get) => {
  let latestUpdateRequestId = 0;

  const hydrateNodeExecutionStates = async (graph: Graph) => {
    const nodeStateEntries = await Promise.all(graph.nodes.map(async (node) => {
      try {
        const response = await axios.get(`/api/nodes/${node.id}/result`);
        return [node.id, getNodeExecutionStateFromResult(response.data)] as const;
      } catch (error: any) {
        if (error?.response?.status === 404) {
          return [node.id, { ...DEFAULT_NODE_EXECUTION_STATE }] as const;
        }

        return [
          node.id,
          {
            ...DEFAULT_NODE_EXECUTION_STATE,
            hasError: true,
            errorMessage: `Error loading result: ${resolveErrorMessage(error, 'unknown error')}`,
          },
        ] as const;
      }
    }));

    set({ nodeExecutionStates: Object.fromEntries(nodeStateEntries) });
  };

  const mergeNodeExecutionState = (nodeId: string, patch: Partial<NodeExecutionState>) => {
    set((state) => ({
      nodeExecutionStates: {
        ...state.nodeExecutionStates,
        [nodeId]: {
          ...(state.nodeExecutionStates[nodeId] ?? DEFAULT_NODE_EXECUTION_STATE),
          ...patch,
        },
      },
    }));
  };

  const triggerAutoRecompute = async (nodeIds: string[]) => {
    for (const nodeId of nodeIds) {
      await get().computeNode(nodeId);
    }
  };

  return {
    graph: null,
    selectedNodeId: null,
    isLoading: false,
    error: null,
    resultRefreshKey: 0,
    nodeExecutionStates: {},

    loadGraph: async (id: string) => {
      set({ isLoading: true, error: null });
      try {
        const response = await axios.get(`/api/graphs/${id}`);
        const graph = response.data as Graph;
        set({
          graph,
          isLoading: false,
          nodeExecutionStates: buildNodeStateMapForGraph(graph, get().nodeExecutionStates),
        });
        await hydrateNodeExecutionStates(graph);
        try {
          localStorage.setItem('k8v-current-graph-id', id);
        } catch (storageError) {
          console.warn('Could not save to localStorage:', storageError);
        }
      } catch (error: any) {
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
        const newGraph = response.data as Graph;
        set({
          graph: newGraph,
          isLoading: false,
          error: null,
          nodeExecutionStates: buildNodeStateMapForGraph(newGraph, {}),
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

    loadLatestGraph: async () => {
      set({ isLoading: true, error: null });
      try {
        const response = await axios.get('/api/graphs/latest');
        const graph = response.data as Graph;
        set({
          graph,
          isLoading: false,
          nodeExecutionStates: buildNodeStateMapForGraph(graph, get().nodeExecutionStates),
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

    initializeGraph: async () => {
      console.log('Initializing graph...');
      set({ isLoading: true, error: null });
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
      const { graph, nodeExecutionStates } = get();
      if (!graph) return;

      const updatedGraph = { ...graph, ...updates } as Graph;
      const requestId = latestUpdateRequestId + 1;
      latestUpdateRequestId = requestId;

      set({
        graph: updatedGraph,
        isLoading: false,
        error: null,
        nodeExecutionStates: buildNodeStateMapForGraph(updatedGraph, nodeExecutionStates),
      });

      try {
        const response = await axios.put(`/api/graphs/${graph.id}`, updatedGraph);
        if (requestId !== latestUpdateRequestId) {
          return;
        }

        const persistedGraph = response.data as Graph;
        const autoRecomputeTargets = collectAutoRecomputeTargets(graph, persistedGraph);

        set((state) => ({
          graph: persistedGraph,
          isLoading: false,
          error: null,
          nodeExecutionStates: buildNodeStateMapForGraph(persistedGraph, state.nodeExecutionStates),
        }));

        try {
          localStorage.setItem('k8v-current-graph-id', persistedGraph.id);
        } catch (storageError) {
          console.warn('Could not save to localStorage:', storageError);
        }

        if (autoRecomputeTargets.length > 0) {
          void triggerAutoRecompute(autoRecomputeTargets);
        }
      } catch (error: any) {
        if (requestId !== latestUpdateRequestId) {
          return;
        }
        const serverMessage = resolveErrorMessage(error, 'Failed to update graph');
        set({
          graph,
          error: serverMessage,
          isLoading: false,
          nodeExecutionStates: buildNodeStateMapForGraph(graph, nodeExecutionStates),
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
      if (get().selectedNodeId === nodeId) return;
      set({ selectedNodeId: nodeId });
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
          nodeExecutionStates: nextStates,
        };
      });

      try {
        const response = await axios.post(`/api/graphs/${graph.id}/compute`, {});
        const results = Array.isArray(response.data) ? response.data : [];

        set((state) => {
          const nextStates = { ...state.nodeExecutionStates };
          for (const node of graph.nodes) {
            nextStates[node.id] = {
              ...(nextStates[node.id] ?? DEFAULT_NODE_EXECUTION_STATE),
              isComputing: false,
            };
          }
          for (const result of results) {
            if (result?.nodeId) {
              nextStates[result.nodeId] = getNodeExecutionStateFromResult(result);
            }
          }

          return {
            nodeExecutionStates: nextStates,
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
            nodeExecutionStates: nextStates,
            error: message,
            isLoading: false,
          };
        });
      }
    },
  };
});
