import axios from 'axios';
import type { ComputationResult, Graph } from '../types';
import type { BackendRecomputeStatus } from './graphStoreState';

export const graphApi = {
  async fetchGraph(graphId: string): Promise<Graph> {
    const response = await axios.get(`/api/graphs/${graphId}`);
    return response.data as Graph;
  },

  async createGraph(name: string): Promise<Graph> {
    const response = await axios.post('/api/graphs', { name });
    return response.data as Graph;
  },

  async deleteGraph(graphId: string): Promise<void> {
    await axios.delete(`/api/graphs/${graphId}`);
  },

  async fetchLatestGraph(): Promise<Graph> {
    const response = await axios.get('/api/graphs/latest');
    return response.data as Graph;
  },

  async listGraphs(): Promise<unknown> {
    const response = await axios.get('/api/graphs');
    return response.data;
  },

  async updateGraph(graphId: string, graph: Graph & { ifMatchUpdatedAt: number }): Promise<Graph> {
    const response = await axios.put(`/api/graphs/${graphId}`, graph);
    return response.data as Graph;
  },

  async fetchNodeResult(nodeId: string): Promise<unknown> {
    const response = await axios.get(`/api/nodes/${nodeId}/result`);
    return response.data;
  },

  async fetchRecomputeStatus(graphId: string): Promise<BackendRecomputeStatus> {
    const response = await axios.get(`/api/graphs/${graphId}/recompute-status`);
    return response.data as BackendRecomputeStatus;
  },

  async computeGraph(graphId: string, nodeId?: string): Promise<ComputationResult | ComputationResult[]> {
    const response = await axios.post(`/api/graphs/${graphId}/compute`, nodeId ? { nodeId } : {});
    return response.data as ComputationResult | ComputationResult[];
  },
};
