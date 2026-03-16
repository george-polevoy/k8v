import { requestJson } from './mcpHttp.js';
import {
  type GraphCommand,
} from '../../domain/dist/index.js';
import {
  type Graph,
  normalizeGraph,
} from './graphModel.js';

export interface SubmitGraphCommandsOptions {
  noRecompute?: boolean;
}

function buildGraphCommandEndpoint(graphId: string, options?: SubmitGraphCommandsOptions): string {
  const params = new URLSearchParams();
  if (options?.noRecompute) {
    params.set('noRecompute', 'true');
  }
  const query = params.toString();
  return `/api/graphs/${encodeURIComponent(graphId)}/commands${query ? `?${query}` : ''}`;
}

export async function getGraph(backendUrl: string, graphId: string): Promise<Graph> {
  const graph = await requestJson<Graph>(backendUrl, `/api/graphs/${encodeURIComponent(graphId)}`);
  return normalizeGraph(graph);
}

export async function submitGraphCommands(
  backendUrl: string,
  graphId: string,
  baseRevision: number,
  commands: GraphCommand[],
  options?: SubmitGraphCommandsOptions
): Promise<{ graph: Graph; runtimeState?: unknown }> {
  const response = await requestJson<{ graph: Graph; runtimeState?: unknown }>(
    backendUrl,
    buildGraphCommandEndpoint(graphId, options),
    {
      method: 'POST',
      body: JSON.stringify({
        baseRevision,
        commands,
      }),
    }
  );

  return {
    ...response,
    graph: normalizeGraph(response.graph),
  };
}
