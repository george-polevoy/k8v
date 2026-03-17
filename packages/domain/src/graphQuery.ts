import { z } from 'zod';

export const GRAPH_QUERY_NODE_FIELDS = [
  'id',
  'name',
  'type',
  'version',
  'position',
  'cardSize',
  'annotationText',
  'config',
  'inputNames',
  'outputNames',
] as const;

export const GRAPH_QUERY_CONNECTION_FIELDS = [
  'id',
  'sourceNodeId',
  'sourcePort',
  'sourceAnchor',
  'targetNodeId',
  'targetPort',
  'targetAnchor',
] as const;

export const GRAPH_QUERY_NODE_FIELD_SCHEMA = z.enum(GRAPH_QUERY_NODE_FIELDS);
export const GRAPH_QUERY_CONNECTION_FIELD_SCHEMA = z.enum(GRAPH_QUERY_CONNECTION_FIELDS);

const GraphQueryBaseSchema = z.object({
  nodeFields: z.array(GRAPH_QUERY_NODE_FIELD_SCHEMA).optional(),
  connectionFields: z.array(GRAPH_QUERY_CONNECTION_FIELD_SCHEMA).optional(),
});

export const GraphOverviewQuerySchema = GraphQueryBaseSchema.extend({
  operation: z.literal('overview'),
});

export const GraphStartingVerticesQuerySchema = GraphQueryBaseSchema.extend({
  operation: z.literal('starting_vertices'),
});

export const GraphTraverseBfsQuerySchema = GraphQueryBaseSchema.extend({
  operation: z.literal('traverse_bfs'),
  startNodeIds: z.array(z.string().trim().min(1)).min(1),
  depth: z.number().int().nonnegative().optional(),
});

export const GraphTraverseDfsQuerySchema = GraphQueryBaseSchema.extend({
  operation: z.literal('traverse_dfs'),
  startNodeIds: z.array(z.string().trim().min(1)).min(1),
  maxNodes: z.number().int().positive(),
});

export const GraphQueryRequestSchema = z.discriminatedUnion('operation', [
  GraphOverviewQuerySchema,
  GraphStartingVerticesQuerySchema,
  GraphTraverseBfsQuerySchema,
  GraphTraverseDfsQuerySchema,
]);

export type GraphQueryNodeField = (typeof GRAPH_QUERY_NODE_FIELDS)[number];
export type GraphQueryConnectionField = (typeof GRAPH_QUERY_CONNECTION_FIELDS)[number];
export type GraphQueryRequest = z.infer<typeof GraphQueryRequestSchema>;
