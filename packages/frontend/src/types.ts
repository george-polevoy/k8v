export interface Position {
  x: number;
  y: number;
}

export type DrawingColor = string;
export type CanvasBackgroundMode = 'solid' | 'gradient';

export interface CanvasBackgroundSettings {
  mode: CanvasBackgroundMode;
  baseColor: string;
}

export interface GraphConnectionStrokeSettings {
  foregroundColor: string;
  backgroundColor: string;
  foregroundWidth: number;
  backgroundWidth: number;
}

export interface ProjectionNodeCardSize {
  width: number;
  height: number;
}

export interface GraphProjection {
  id: string;
  name: string;
  nodePositions: Record<string, Position>;
  nodeCardSizes: Record<string, ProjectionNodeCardSize>;
  canvasBackground?: CanvasBackgroundSettings;
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
  SUBGRAPH = 'subgraph',
  NUMERIC_INPUT = 'numeric_input',
  ANNOTATION = 'annotation',
}

export type RuntimeId = 'javascript_vm' | 'python_process';

export interface NodeConfig {
  type: NodeType;
  code?: string;
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

export type ConnectionAnchorSide = 'top' | 'right' | 'bottom' | 'left';

export interface ConnectionAnchor {
  side: ConnectionAnchorSide;
  offset: number;
}

export interface Connection {
  id: string;
  sourceNodeId: string;
  sourcePort: string;
  sourceAnchor?: ConnectionAnchor;
  targetNodeId: string;
  targetPort: string;
  targetAnchor?: ConnectionAnchor;
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
  recomputeConcurrency?: number;
  executionTimeoutMs?: number;
  canvasBackground?: CanvasBackgroundSettings;
  connectionStroke?: GraphConnectionStrokeSettings;
  projections?: GraphProjection[];
  activeProjectionId?: string;
  pythonEnvs?: PythonEnvironment[];
  drawings?: GraphDrawing[];
  createdAt: number;
  updatedAt: number;
}

export interface GraphicsMipLevel {
  level: number;
  width: number;
  height: number;
  pixelCount: number;
}

export interface GraphicsArtifact {
  id: string;
  mimeType: string;
  levels: GraphicsMipLevel[];
}

export interface ComputationResult {
  nodeId: string;
  outputs: Record<string, any>;
  schema: Record<string, DataSchema>;
  timestamp: number;
  version: string;
  textOutput?: string; // Captured stdout/stderr
  graphics?: GraphicsArtifact;
}

export interface LibraryManifest {
  id: string;
  name: string;
  description?: string;
  metadata: NodeMetadata;
  version: string;
  createdAt: number;
}
