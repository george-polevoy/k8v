import { z } from 'zod';
import { filterConnections } from '../../domain/dist/index.js';
import { textResult } from './mcpHttp.js';
import { type Graph } from './graphModel.js';

type GetGraphFn = (backendUrl: string, graphId: string) => Promise<Graph>;

interface ConnectionToolRegistrarDeps {
  resolveBackendUrl: (backendUrl?: string) => string;
  getGraph: GetGraphFn;
}

export function registerConnectionTools(server: any, deps: ConnectionToolRegistrarDeps): void {
  const {
    resolveBackendUrl,
    getGraph,
  } = deps;

  server.registerTool(
    'connections_list',
    {
      description: 'List graph connections with optional node/target-port filtering.',
      inputSchema: {
        graphId: z.string(),
        nodeId: z.string().optional(),
        targetPort: z.string().optional(),
        backendUrl: z.string().optional(),
      },
    },
    async ({ graphId, nodeId, targetPort, backendUrl }) => {
      const resolvedBackendUrl = resolveBackendUrl(backendUrl);
      const graph = await getGraph(resolvedBackendUrl, graphId);
      const connections = filterConnections(graph.connections, { nodeId, targetPort });

      return textResult({
        graphId: graph.id,
        filters: {
          ...(nodeId?.trim() ? { nodeId: nodeId.trim() } : {}),
          ...(targetPort?.trim() ? { targetPort: targetPort.trim() } : {}),
        },
        count: connections.length,
        connections,
      });
    }
  );
}
