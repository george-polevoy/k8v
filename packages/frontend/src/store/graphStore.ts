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
      // Save graph ID to localStorage
      localStorage.setItem('k8v-current-graph-id', id);
    } catch (error: any) {
      set({ error: error.message, isLoading: false });
    }
  },

  createGraph: async (name: string) => {
    set({ isLoading: true, error: null });
    try {
      const response = await axios.post('/api/graphs', { name });
      const newGraph = response.data;
      set({ graph: newGraph, isLoading: false });
      // Save graph ID to localStorage
      localStorage.setItem('k8v-current-graph-id', newGraph.id);
    } catch (error: any) {
      set({ error: error.message, isLoading: false });
    }
  },

  loadLatestGraph: async () => {
    set({ isLoading: true, error: null });
    try {
      const response = await axios.get('/api/graphs/latest');
      const graph = response.data;
      set({ graph, isLoading: false });
      // Save graph ID to localStorage
      localStorage.setItem('k8v-current-graph-id', graph.id);
    } catch (error: any) {
      // If no graphs exist, create a new one
      if (error.response?.status === 404) {
        await get().createGraph('Untitled Graph');
      } else {
        set({ error: error.message, isLoading: false });
      }
    }
  },

  initializeGraph: async () => {
    // Check localStorage for saved graph ID
    const savedGraphId = localStorage.getItem('k8v-current-graph-id');
    
    if (savedGraphId) {
      try {
        await get().loadGraph(savedGraphId);
      } catch (error: any) {
        // If graph not found, try loading latest or create new
        if (error.response?.status === 404) {
          await get().loadLatestGraph();
        } else {
          // Fallback: create new graph
          await get().createGraph('Untitled Graph');
        }
      }
    } else {
      // No saved graph ID, try to load latest or create new
      await get().loadLatestGraph();
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
    } catch (error: any) {
      set({ error: error.message, isLoading: false });
    }
  },
}));
