import { z } from 'zod';
import {
  GraphCommand,
  GraphQueryRequestSchema,
  type GraphQueryRequest,
} from '../../domain/dist/index.js';
import { requestJson, textResult } from './mcpHttp.js';
import {
  type Graph,
  normalizeGraph,
} from './graphModel.js';
import {
  getGraph,
  submitGraphCommands,
} from './mcpGraphClient.js';

interface GraphToolRegistrarDeps {
  resolveBackendUrl: (backendUrl?: string) => string;
}

export function registerGraphTools(server: any, deps: GraphToolRegistrarDeps): void {
  const { resolveBackendUrl } = deps;

  server.registerTool(
    'graph_list',
    {
      description: 'List available graphs.',
      inputSchema: {
        backendUrl: z.string().optional(),
      },
    },
    async ({ backendUrl }) => {
      const resolvedBackendUrl = resolveBackendUrl(backendUrl);
      const response = await requestJson<{ graphs: Array<{ id: string; name: string; updated_at: number }> }>(
        resolvedBackendUrl,
        '/api/graphs'
      );
      return textResult(response);
    }
  );

  server.registerTool(
    'graph_get',
    {
      description: 'Get a graph by id, or the latest graph when graphId is omitted.',
      inputSchema: {
        graphId: z.string().optional(),
        backendUrl: z.string().optional(),
      },
    },
    async ({ graphId, backendUrl }) => {
      const resolvedBackendUrl = resolveBackendUrl(backendUrl);
      const graph = graphId
        ? await getGraph(resolvedBackendUrl, graphId)
        : normalizeGraph(await requestJson<Graph>(resolvedBackendUrl, '/api/graphs/latest'));

      return textResult(graph);
    }
  );

  server.registerTool(
    'graph_query',
    {
      description:
        'Run lightweight graph queries (overview, BFS/DFS traversal, starting vertices) and return only requested fields.',
      inputSchema: {
        graphId: z.string(),
        operation: z.enum(['overview', 'starting_vertices', 'traverse_bfs', 'traverse_dfs']),
        startNodeIds: z.array(z.string()).optional(),
        depth: z.number().int().nonnegative().optional(),
        maxNodes: z.number().int().positive().optional(),
        nodeFields: z.array(z.enum(['id', 'name', 'type', 'version', 'inputNames', 'outputNames'])).optional(),
        connectionFields: z.array(z.enum([
          'id',
          'sourceNodeId',
          'sourcePort',
          'sourceAnchor',
          'targetNodeId',
          'targetPort',
          'targetAnchor',
        ])).optional(),
        backendUrl: z.string().optional(),
      },
    },
    async ({
      graphId,
      operation,
      startNodeIds,
      depth,
      maxNodes,
      nodeFields,
      connectionFields,
      backendUrl,
    }) => {
      const resolvedBackendUrl = resolveBackendUrl(backendUrl);
      const parsedQuery = GraphQueryRequestSchema.parse({
        operation,
        startNodeIds,
        depth,
        maxNodes,
        nodeFields,
        connectionFields,
      }) as GraphQueryRequest;

      const result = await requestJson<unknown>(
        resolvedBackendUrl,
        `/api/graphs/${encodeURIComponent(graphId)}/query`,
        {
          method: 'POST',
          body: JSON.stringify(parsedQuery),
        }
      );

      return textResult(result);
    }
  );

  server.registerTool(
    'graph_create',
    {
      description: 'Create a new empty graph.',
      inputSchema: {
        name: z.string().optional(),
        backendUrl: z.string().optional(),
      },
    },
    async ({ name, backendUrl }) => {
      const resolvedBackendUrl = resolveBackendUrl(backendUrl);
      const graph = normalizeGraph(await requestJson<Graph>(resolvedBackendUrl, '/api/graphs', {
        method: 'POST',
        body: JSON.stringify({ name: name ?? 'Untitled Graph' }),
      }));

      return textResult(graph);
    }
  );

  server.registerTool(
    'bulk_edit',
    {
      description:
        'Apply an ordered graph command batch to one graph. This is the only MCP graph mutation tool.',
      inputSchema: {
        graphId: z.string(),
        baseRevision: z.number().int().nonnegative().optional(),
        commands: z.array(GraphCommand).min(1),
        noRecompute: z.boolean().optional(),
        backendUrl: z.string().optional(),
      },
    },
    async ({ graphId, baseRevision, commands, noRecompute, backendUrl }) => {
      const resolvedBackendUrl = resolveBackendUrl(backendUrl);
      const resolvedBaseRevision = typeof baseRevision === 'number'
        ? baseRevision
        : (await getGraph(resolvedBackendUrl, graphId)).revision ?? 0;
      const response = await submitGraphCommands(
        resolvedBackendUrl,
        graphId,
        resolvedBaseRevision,
        commands,
        {
          noRecompute,
        }
      );

      return textResult({
        graphId,
        baseRevision: resolvedBaseRevision,
        commandCount: commands.length,
        ...response,
      });
    }
  );
}
