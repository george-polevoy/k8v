import { z } from 'zod';

// Data schema for type inference
export const DataSchema = z.object({
  type: z.enum(['string', 'number', 'boolean', 'object', 'array', 'null']),
  properties: z.record(z.any()).optional(),
  items: z.any().optional(),
  required: z.array(z.string()).optional(),
});

export type DataSchema = z.infer<typeof DataSchema>;

// Node input/output definition
export const PortDefinition = z.object({
  name: z.string(),
  schema: DataSchema,
  description: z.string().optional(),
});

export type PortDefinition = z.infer<typeof PortDefinition>;

// Node metadata
export const NodeMetadata = z.object({
  name: z.string(),
  description: z.string().optional(),
  inputs: z.array(PortDefinition),
  outputs: z.array(PortDefinition),
  category: z.string().optional(),
  version: z.string().optional(),
});

export type NodeMetadata = z.infer<typeof NodeMetadata>;

// Node types
export enum NodeType {
  INLINE_CODE = 'inline_code',
  LIBRARY = 'library',
  SUBGRAPH = 'subgraph',
  EXTERNAL_INPUT = 'external_input',
  EXTERNAL_OUTPUT = 'external_output',
}

// Node configuration
export const NodeConfig = z.object({
  type: z.nativeEnum(NodeType),
  code: z.string().optional(), // For inline code nodes
  libraryId: z.string().optional(), // For library nodes
  subgraphId: z.string().optional(), // For subgraph nodes
  config: z.record(z.any()).optional(), // Additional configuration
});

export type NodeConfig = z.infer<typeof NodeConfig>;

// Graph node
export const GraphNode = z.object({
  id: z.string(),
  type: z.nativeEnum(NodeType),
  position: z.object({
    x: z.number(),
    y: z.number(),
  }),
  metadata: NodeMetadata,
  config: NodeConfig,
  version: z.string(), // For change detection
  lastComputed: z.number().optional(), // Timestamp
});

export type GraphNode = z.infer<typeof GraphNode>;

// Connection between nodes
export const Connection = z.object({
  id: z.string(),
  sourceNodeId: z.string(),
  sourcePort: z.string(),
  targetNodeId: z.string(),
  targetPort: z.string(),
});

export type Connection = z.infer<typeof Connection>;

// Graph structure
export const Graph = z.object({
  id: z.string(),
  name: z.string(),
  nodes: z.array(GraphNode),
  connections: z.array(Connection),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export type Graph = z.infer<typeof Graph>;

// Computation result
export const ComputationResult = z.object({
  nodeId: z.string(),
  outputs: z.record(z.any()),
  schema: z.record(DataSchema),
  timestamp: z.number(),
  version: z.string(),
  textOutput: z.string().optional(), // Captured stdout/stderr
  graphicsOutput: z.string().optional(), // Base64 encoded image or data URL
});

export type ComputationResult = z.infer<typeof ComputationResult>;

// Library node manifest
export const LibraryManifest = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  metadata: NodeMetadata,
  version: z.string(),
  createdAt: z.number(),
});

export type LibraryManifest = z.infer<typeof LibraryManifest>;
