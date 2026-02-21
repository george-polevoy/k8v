export interface Position {
  x: number;
  y: number;
}

export type DrawingColor = 'white' | 'green' | 'red';

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

export type RuntimeId = 'javascript_vm' | 'python_process';

export interface NodeConfig {
  type: NodeType;
  code?: string;
  libraryId?: string;
  subgraphId?: string;
  runtime?: RuntimeId | string;
  pythonEnv?: string;
  config?: Record<string, any>;
}

export interface PythonEnvironment {
  name: string;
  pythonPath: string;
  cwd: string;
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

export interface DrawingPath {
  id: string;
  color: DrawingColor;
  thickness: number;
  // Path points are local to drawing.position
  points: Position[];
}

export interface GraphDrawing {
  id: string;
  name: string;
  position: Position;
  paths: DrawingPath[];
}

export interface Graph {
  id: string;
  name: string;
  nodes: GraphNode[];
  connections: Connection[];
  pythonEnvs?: PythonEnvironment[];
  drawings?: GraphDrawing[];
  createdAt: number;
  updatedAt: number;
}

export interface ComputationResult {
  nodeId: string;
  outputs: Record<string, any>;
  schema: Record<string, DataSchema>;
  timestamp: number;
  version: string;
  textOutput?: string; // Captured stdout/stderr
  graphicsOutput?: string; // Base64 encoded image or data URL
}

export interface LibraryManifest {
  id: string;
  name: string;
  description?: string;
  metadata: NodeMetadata;
  version: string;
  createdAt: number;
}
