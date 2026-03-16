import axios from 'axios';
import type {
  Graph,
  GraphCommand,
  GraphRuntimeState,
  GraphSummary,
} from '../types';

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

  async listGraphs(): Promise<{ graphs: GraphSummary[] }> {
    const response = await axios.get('/api/graphs');
    return response.data as { graphs: GraphSummary[] };
  },

  async fetchRuntimeState(graphId: string): Promise<GraphRuntimeState> {
    const response = await axios.get(`/api/graphs/${graphId}/runtime-state`);
    return response.data as GraphRuntimeState;
  },

  async submitCommands(
    graphId: string,
    baseRevision: number,
    commands: GraphCommand[]
  ): Promise<{ graph: Graph; runtimeState: GraphRuntimeState }> {
    const response = await axios.post(`/api/graphs/${graphId}/commands`, {
      baseRevision,
      commands,
    });
    return response.data as { graph: Graph; runtimeState: GraphRuntimeState };
  },

  createEventsSource(graphId: string): EventSource {
    return new EventSource(`/api/graphs/${graphId}/events`);
  },
};
