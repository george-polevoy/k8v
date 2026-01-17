export interface Position {
  x: number;
  y: number;
}

export interface PortDefinition {
  name: string;
  schema: DataSchema;
  description?: string;
}

export interface DataSchema {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'null';
  properties?: Record<string, DataSchema>;
  items?: DataSchema;
  required?: string[];
}

export interface NodeMetadata {
  name: string;
  description?: string;
  inputs: PortDefinition[];
  outputs: PortDefinition[];
  category?: string;
  version?: string;
}

export enum NodeType {
  INLINE_CODE = 'inline_code',
  LIBRARY = 'library',
  SUBGRAPH = 'subgraph',
  EXTERNAL_INPUT = 'external_input',
  EXTERNAL_OUTPUT = 'external_output',
}

export interface NodeConfig {
  type: NodeType;
  code?: string;
  libraryId?: string;
  subgraphId?: string;
  config?: Record<string, any>;
}

export interface GraphNode {
  id: string;
  type: NodeType;
  position: Position;
  metadata: NodeMetadata;
  config: NodeConfig;
  version: string;
  lastComputed?: number;
}

export interface Connection {
  id: string;
  sourceNodeId: string;
  sourcePort: string;
  targetNodeId: string;
  targetPort: string;
}

export interface Graph {
  id: string;
  name: string;
  nodes: GraphNode[];
  connections: Connection[];
  createdAt: number;
  updatedAt: number;
}

export interface ComputationResult {
  nodeId: string;
  outputs: Record<string, any>;
  schema: Record<string, DataSchema>;
  timestamp: number;
  version: string;
}

export interface LibraryManifest {
  id: string;
  name: string;
  description?: string;
  metadata: NodeMetadata;
  version: string;
  createdAt: number;
}
