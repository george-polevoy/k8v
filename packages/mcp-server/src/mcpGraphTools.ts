import { z } from 'zod';
import {
  GraphCommand,
  GRAPH_QUERY_CONNECTION_FIELDS,
  GRAPH_QUERY_NODE_FIELDS,
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

type RequestJsonFn = typeof requestJson;
type GetGraphFn = typeof getGraph;
type SubmitGraphCommandsFn = typeof submitGraphCommands;

interface GraphToolRegistrarDeps {
  resolveBackendUrl: (backendUrl?: string) => string;
  requestJson?: RequestJsonFn;
  getGraph?: GetGraphFn;
  submitGraphCommands?: SubmitGraphCommandsFn;
}

const GraphCommandArgumentSchema = z.object({
  kind: z.string().min(1).describe('GraphCommand kind, such as node_add_annotation or connection_add.'),
}).passthrough().describe(
  'One GraphCommand object. Pass a structured object with a `kind` field and any required command fields; do not pass a JSON string.'
);

const GraphCommandArgumentListSchema = z.array(GraphCommandArgumentSchema).min(1).describe(
  'Ordered GraphCommand objects to apply. Each item must be a structured object, not a string.'
);

export function registerGraphTools(server: any, deps: GraphToolRegistrarDeps): void {
  const {
    resolveBackendUrl,
    requestJson: requestJsonImpl = requestJson,
    getGraph: getGraphImpl = getGraph,
    submitGraphCommands: submitGraphCommandsImpl = submitGraphCommands,
  } = deps;

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
      const response = await requestJsonImpl<{ graphs: Array<{ id: string; name: string; updated_at: number }> }>(
        resolvedBackendUrl,
        '/api/graphs'
      );
      return textResult(response);
    }
  );

  server.registerTool(
    'graph_get',
    {
      description:
        'Get a graph by id, or the latest graph when graphId is omitted. ' +
        'Nodes use a flat exhaustive `config` keyed by top-level `type`; see k8v://docs/node-config-schema.json.',
      inputSchema: {
        graphId: z.string().optional(),
        backendUrl: z.string().optional(),
      },
    },
    async ({ graphId, backendUrl }) => {
      const resolvedBackendUrl = resolveBackendUrl(backendUrl);
      const graph = graphId
        ? await getGraphImpl(resolvedBackendUrl, graphId)
        : normalizeGraph(await requestJsonImpl<Graph>(resolvedBackendUrl, '/api/graphs/latest'));

      return textResult(graph);
    }
  );

  server.registerTool(
    'graph_query',
    {
      description:
        'Run lightweight graph queries (overview, BFS/DFS traversal, starting vertices) and return only requested fields. ' +
        'For schema details and examples, read k8v://docs/mcp-overview.md, k8v://docs/node-config-schema.json, and k8v://docs/annotation-workflows.md.',
      inputSchema: {
        graphId: z.string(),
        operation: z.enum(['overview', 'starting_vertices', 'traverse_bfs', 'traverse_dfs']),
        startNodeIds: z.array(z.string()).optional(),
        depth: z.number().int().nonnegative().optional(),
        maxNodes: z.number().int().positive().optional(),
        nodeFields: z.array(z.enum(GRAPH_QUERY_NODE_FIELDS)).optional(),
        connectionFields: z.array(z.enum(GRAPH_QUERY_CONNECTION_FIELDS)).optional(),
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

      const result = await requestJsonImpl<unknown>(
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
      const graph = normalizeGraph(await requestJsonImpl<Graph>(resolvedBackendUrl, '/api/graphs', {
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
        'Apply an ordered GraphCommand[] batch to one graph. Pass `commands` as structured objects in the MCP arguments; do not stringify each command. ' +
        'This is the only MCP graph mutation tool. ' +
        'See k8v://docs/node-config-schema.json, k8v://docs/graph-command-schema.json, and k8v://docs/annotation-workflows.md for command shapes and examples.',
      inputSchema: {
        graphId: z.string(),
        baseRevision: z.number().int().nonnegative().optional(),
        commands: GraphCommandArgumentListSchema,
        noRecompute: z.boolean().optional(),
        backendUrl: z.string().optional(),
      },
    },
    async ({ graphId, baseRevision, commands, noRecompute, backendUrl }) => {
      const resolvedBackendUrl = resolveBackendUrl(backendUrl);
      const parsedCommands = z.array(GraphCommand).min(1).parse(commands);
      const resolvedBaseRevision = typeof baseRevision === 'number'
        ? baseRevision
        : (await getGraphImpl(resolvedBackendUrl, graphId)).revision ?? 0;
      const response = await submitGraphCommandsImpl(
        resolvedBackendUrl,
        graphId,
        resolvedBaseRevision,
        parsedCommands,
        {
          noRecompute,
        }
      );

      return textResult({
        graphId,
        baseRevision: resolvedBaseRevision,
        commandCount: parsedCommands.length,
        ...response,
      });
    }
  );
}
