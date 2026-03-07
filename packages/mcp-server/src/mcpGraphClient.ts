import { requestJson } from './mcpHttp.js';
import {
  type Connection,
  type Graph,
  normalizeGraph,
} from './graphModel.js';

export interface UpdateGraphRequestOptions {
  noRecompute?: boolean;
}

export type UpdateGraphFn = (
  backendUrl: string,
  graphId: string,
  mutate: (graph: Graph) => Graph
) => Promise<Graph>;

export type UpdateGraphConnectionsFn = (
  backendUrl: string,
  graphId: string,
  mutateConnections: (graph: Graph) => Connection[],
  options?: UpdateGraphRequestOptions
) => Promise<Graph>;

export type UpdateGraphConnectionsWithResultFn = <TResult>(
  backendUrl: string,
  graphId: string,
  mutateConnections: (graph: Graph) => { connections: Connection[]; result: TResult },
  options?: UpdateGraphRequestOptions
) => Promise<{ graph: Graph; result: TResult }>;

export async function getGraph(backendUrl: string, graphId: string): Promise<Graph> {
  const graph = await requestJson<Graph>(backendUrl, `/api/graphs/${encodeURIComponent(graphId)}`);
  return normalizeGraph(graph);
}

function buildGraphUpdateEndpoint(graphId: string, options?: UpdateGraphRequestOptions): string {
  const params = new URLSearchParams();
  if (options?.noRecompute) {
    params.set('noRecompute', 'true');
  }
  const query = params.toString();
  return `/api/graphs/${encodeURIComponent(graphId)}${query ? `?${query}` : ''}`;
}

export const updateGraph: UpdateGraphFn = async (
  backendUrl,
  graphId,
  mutate
) => {
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const currentGraph = await getGraph(backendUrl, graphId);
    const nextGraph = normalizeGraph(mutate(structuredClone(currentGraph)));
    const body = {
      ...nextGraph,
      id: graphId,
      updatedAt: Date.now(),
      ifMatchUpdatedAt: currentGraph.updatedAt,
    };

    try {
      const persisted = await requestJson<Graph>(backendUrl, buildGraphUpdateEndpoint(graphId), {
        method: 'PUT',
        body: JSON.stringify(body),
      });
      return normalizeGraph(persisted);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempt < maxAttempts && /reload and retry/i.test(message)) {
        continue;
      }
      throw error;
    }
  }

  throw new Error(`Failed to update graph ${graphId} after ${maxAttempts} attempts`);
};

export const updateGraphConnectionsWithResult: UpdateGraphConnectionsWithResultFn = async (
  backendUrl,
  graphId,
  mutateConnections,
  options
) => {
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const currentGraph = await getGraph(backendUrl, graphId);
    const mutation = mutateConnections(structuredClone(currentGraph));

    const body = {
      connections: mutation.connections,
      ifMatchUpdatedAt: currentGraph.updatedAt,
    };

    try {
      const persisted = await requestJson<Graph>(
        backendUrl,
        buildGraphUpdateEndpoint(graphId, options),
        {
          method: 'PUT',
          body: JSON.stringify(body),
        }
      );
      return {
        graph: normalizeGraph(persisted),
        result: mutation.result,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempt < maxAttempts && /reload and retry/i.test(message)) {
        continue;
      }
      throw error;
    }
  }

  throw new Error(`Failed to update graph ${graphId} after ${maxAttempts} attempts`);
};

export const updateGraphConnections: UpdateGraphConnectionsFn = async (
  backendUrl,
  graphId,
  mutateConnections,
  options
) => {
  const result = await updateGraphConnectionsWithResult(
    backendUrl,
    graphId,
    (graph) => ({
      connections: mutateConnections(graph),
      result: undefined,
    }),
    options
  );
  return result.graph;
};
