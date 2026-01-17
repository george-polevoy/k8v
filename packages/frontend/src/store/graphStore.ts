import { create } from 'zustand';
import { Graph, GraphNode, Connection } from '../types';
import axios from 'axios';

interface GraphStore {
  graph: Graph | null;
  selectedNodeId: string | null;
  isLoading: boolean;
  error: string | null;

  // Actions
  loadGraph: (id: string) => Promise<void>;
  loadLatestGraph: () => Promise<void>;
  createGraph: (name: string) => Promise<void>;
  updateGraph: (graph: Partial<Graph>) => Promise<void>;
  initializeGraph: () => Promise<void>;
  addNode: (node: GraphNode) => void;
  updateNode: (nodeId: string, updates: Partial<GraphNode>) => void;
  deleteNode: (nodeId: string) => void;
  addConnection: (connection: Connection) => void;
  deleteConnection: (connectionId: string) => void;
  selectNode: (nodeId: string | null) => void;
  computeNode: (nodeId: string) => Promise<void>;
  computeGraph: () => Promise<void>;
}

export const useGraphStore = create<GraphStore>((set, get) => ({
  graph: null,
  selectedNodeId: null,
  isLoading: false,
  error: null,

  loadGraph: async (id: string) => {
    set({ isLoading: true, error: null });
    try {
      const response = await axios.get(`/api/graphs/${id}`);
      set({ graph: response.data, isLoading: false });
      // Save graph ID to localStorage (with error handling)
      try {
        localStorage.setItem('k8v-current-graph-id', id);
      } catch (storageError) {
        console.warn('Could not save to localStorage:', storageError);
      }
    } catch (error: any) {
      set({ error: error.message, isLoading: false });
    }
  },

  createGraph: async (name: string) => {
    const currentLoading = get().isLoading;
    if (!currentLoading) {
      set({ isLoading: true, error: null });
    }
    try {
      const response = await axios.post('/api/graphs', { name });
      const newGraph = response.data;
      set({ graph: newGraph, isLoading: false, error: null });
      // Save graph ID to localStorage (with error handling for environments where it might not work)
      try {
        localStorage.setItem('k8v-current-graph-id', newGraph.id);
      } catch (storageError) {
        console.warn('Could not save to localStorage:', storageError);
        // Continue anyway - graph is still created
      }
      console.log('Graph created successfully:', newGraph.id);
    } catch (error: any) {
      console.error('Error creating graph:', error);
      set({ error: error.message, isLoading: false });
      throw error; // Re-throw so caller can handle it
    }
  },

  loadLatestGraph: async () => {
    set({ isLoading: true, error: null });
    try {
      const response = await axios.get('/api/graphs/latest');
      const graph = response.data;
      set({ graph, isLoading: false });
      // Save graph ID to localStorage (with error handling)
      try {
        localStorage.setItem('k8v-current-graph-id', graph.id);
      } catch (storageError) {
        console.warn('Could not save to localStorage:', storageError);
      }
    } catch (error: any) {
      // If no graphs exist, create a new one
      if (error.response?.status === 404) {
        set({ isLoading: false }); // Clear loading before creating
        await get().createGraph('Untitled Graph');
      } else {
        set({ error: error.message, isLoading: false });
        // Fallback: create new graph on other errors too
        await get().createGraph('Untitled Graph');
      }
    }
  },

  initializeGraph: async () => {
    console.log('Initializing graph...');
    set({ isLoading: true, error: null });
    try {
      // Try to access localStorage (might fail in some environments like Cursor's browser)
      let savedGraphId: string | null = null;
      try {
        savedGraphId = localStorage.getItem('k8v-current-graph-id');
        console.log('Saved graph ID:', savedGraphId);
      } catch (storageError) {
        console.warn('localStorage not available, skipping saved graph ID:', storageError);
        // Continue without localStorage
      }
      
      if (savedGraphId) {
        try {
          console.log('Attempting to load saved graph:', savedGraphId);
          await get().loadGraph(savedGraphId);
          console.log('Graph loaded successfully');
          set({ isLoading: false });
          return; // Successfully loaded
        } catch (error: any) {
          console.log('Failed to load saved graph:', error.message);
          // If graph not found, clear stale ID and try loading latest or create new
          if (error.response?.status === 404) {
            try {
              localStorage.removeItem('k8v-current-graph-id');
            } catch (e) {
              // Ignore localStorage errors
            }
            try {
              console.log('Trying to load latest graph...');
              await get().loadLatestGraph();
              set({ isLoading: false });
              return;
            } catch (latestError: any) {
              console.log('Failed to load latest, creating new graph...');
              // If latest also fails, create new
              await get().createGraph('Untitled Graph');
              set({ isLoading: false });
              return;
            }
          } else {
            console.log('Other error, creating new graph...');
            // Other error, clear stale ID and create new
            try {
              localStorage.removeItem('k8v-current-graph-id');
            } catch (e) {
              // Ignore localStorage errors
            }
            await get().createGraph('Untitled Graph');
            set({ isLoading: false });
            return;
          }
        }
      } else {
        // No saved graph ID, try to load latest or create new
        try {
          console.log('No saved graph ID, trying to load latest...');
          await get().loadLatestGraph();
          set({ isLoading: false });
        } catch (error: any) {
          console.log('Failed to load latest, creating new graph...', error.message);
          // If latest fails, create new
          await get().createGraph('Untitled Graph');
          set({ isLoading: false });
        }
      }
    } catch (error: any) {
      // Final fallback: create new graph
      console.error('Error initializing graph:', error);
      try {
        await get().createGraph('Untitled Graph');
      } catch (createError: any) {
        console.error('Failed to create graph:', createError);
        set({ error: `Failed to create graph: ${createError.message}`, isLoading: false });
      }
    }
  },

  updateGraph: async (updates: Partial<Graph>) => {
    const { graph } = get();
    if (!graph) return;

    set({ isLoading: false, error: null }); // Don't show loading for auto-saves
    try {
      const updatedGraph = { ...graph, ...updates };
      const response = await axios.put(`/api/graphs/${graph.id}`, updatedGraph);
      set({ graph: response.data, isLoading: false });
      // Ensure graph ID is saved
      localStorage.setItem('k8v-current-graph-id', response.data.id);
    } catch (error: any) {
      set({ error: error.message, isLoading: false });
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

  selectNode: (nodeId: string | null) => {
    set({ selectedNodeId: nodeId });
  },

  computeNode: async (nodeId: string) => {
    const { graph } = get();
    if (!graph) return;

    set({ isLoading: true, error: null });
    try {
      await axios.post(`/api/graphs/${graph.id}/compute`, { nodeId });
      set({ isLoading: false });
    } catch (error: any) {
      set({ error: error.message, isLoading: false });
    }
  },

  computeGraph: async () => {
    const { graph } = get();
    if (!graph) return;

    set({ isLoading: true, error: null });
    try {
      await axios.post(`/api/graphs/${graph.id}/compute`, {});
      set({ isLoading: false });
      // Update graph to trigger refresh in OutputPanel
      // The updatedAt timestamp will change, causing OutputPanel to refetch
      if (graph) {
        set({ graph: { ...graph, updatedAt: Date.now() } });
      }
    } catch (error: any) {
      set({ error: error.message, isLoading: false });
    }
  },
}));
