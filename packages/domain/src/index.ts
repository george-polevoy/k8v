import { z } from 'zod';
import { normalizeDrawingColor } from './graphDrawing.js';

export const DataSchema = z.object({
  type: z.enum(['string', 'number', 'boolean', 'object', 'array', 'null']),
  properties: z.record(z.any()).optional(),
  items: z.any().optional(),
  required: z.array(z.string()).optional(),
});

export type DataSchema = z.infer<typeof DataSchema>;

export const PortDefinition = z.object({
  name: z.string(),
  schema: DataSchema,
  description: z.string().optional(),
});

export type PortDefinition = z.infer<typeof PortDefinition>;

export const NodeMetadata = z.object({
  name: z.string(),
  description: z.string().optional(),
  inputs: z.array(PortDefinition),
  outputs: z.array(PortDefinition),
  category: z.string().optional(),
  version: z.string().optional(),
});

export type NodeMetadata = z.infer<typeof NodeMetadata>;

export enum NodeType {
  INLINE_CODE = 'inline_code',
  SUBGRAPH = 'subgraph',
  NUMERIC_INPUT = 'numeric_input',
  ANNOTATION = 'annotation',
}

export const RuntimeId = z.enum(['javascript_vm', 'python_process']);
export type RuntimeId = z.infer<typeof RuntimeId>;

export const PythonEnvironment = z.object({
  name: z.string().trim().min(1),
  pythonPath: z.string().trim().min(1),
  cwd: z.string().trim().min(1),
});

export type PythonEnvironment = z.infer<typeof PythonEnvironment>;

export const GraphAlgoInjectionAbi = z.literal('json_v1');
export type GraphAlgoInjectionAbi = z.infer<typeof GraphAlgoInjectionAbi>;

export const GraphAlgoInjection = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  artifactId: z.string().trim().min(1),
  entrypoint: z.string().trim().min(1),
  abi: GraphAlgoInjectionAbi,
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});

export type GraphAlgoInjection = z.infer<typeof GraphAlgoInjection>;

export const DrawingColor = z
  .string()
  .trim()
  .min(1)
  .transform((value) => normalizeDrawingColor(value));

export type DrawingColor = z.infer<typeof DrawingColor>;

export const DrawingPoint = z.object({
  x: z.number(),
  y: z.number(),
});

export type DrawingPoint = z.infer<typeof DrawingPoint>;

export const DrawingPath = z.object({
  id: z.string(),
  color: DrawingColor,
  thickness: z.number().positive(),
  points: z.array(DrawingPoint),
});

export type DrawingPath = z.infer<typeof DrawingPath>;

export const GraphDrawing = z.object({
  id: z.string(),
  name: z.string().trim().min(1),
  position: DrawingPoint,
  paths: z.array(DrawingPath).default([]),
});

export type GraphDrawing = z.infer<typeof GraphDrawing>;

export const CanvasBackgroundMode = z.enum(['solid', 'gradient']);
export type CanvasBackgroundMode = z.infer<typeof CanvasBackgroundMode>;

export const CanvasBackground = z.object({
  mode: CanvasBackgroundMode,
  baseColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});

export type CanvasBackground = z.infer<typeof CanvasBackground>;

export const DEFAULT_CANVAS_BACKGROUND: CanvasBackground = {
  mode: 'gradient',
  baseColor: '#1d437e',
};

export const GraphConnectionStroke = z.object({
  foregroundColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  backgroundColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  foregroundWidth: z.number().finite().positive(),
  backgroundWidth: z.number().finite().positive(),
});

export type GraphConnectionStroke = z.infer<typeof GraphConnectionStroke>;

export const DEFAULT_GRAPH_CONNECTION_STROKE: GraphConnectionStroke = {
  foregroundColor: '#334155',
  backgroundColor: '#cbd5e1',
  foregroundWidth: 1,
  backgroundWidth: 2,
};

export const DEFAULT_GRAPH_PROJECTION_ID = 'default';
export const DEFAULT_GRAPH_PROJECTION_NAME = 'Default';
export const DEFAULT_GRAPH_CAMERA_ID = 'default-camera';
export const DEFAULT_GRAPH_CAMERA_NAME = 'Default Camera';
export const DEFAULT_GRAPH_EXECUTION_TIMEOUT_MS = 30_000;

export const GraphProjection = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  nodePositions: z.record(DrawingPoint).default({}),
  nodeCardSizes: z.record(
    z.object({
      width: z.number().positive(),
      height: z.number().positive(),
    })
  ).default({}),
  canvasBackground: CanvasBackground.optional(),
});

export type GraphProjection = z.infer<typeof GraphProjection>;

export const GraphCameraViewport = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  scale: z.number().finite().positive(),
});

export type GraphCameraViewport = z.infer<typeof GraphCameraViewport>;

export const GraphCameraWindowAxisHorizontal = z.object({
  edge: z.enum(['left', 'right']),
  ratio: z.number().finite().min(0).max(1),
});

export const GraphCameraWindowAxisVertical = z.object({
  edge: z.enum(['top', 'bottom']),
  ratio: z.number().finite().min(0).max(1),
});

export const GraphCameraWindowPosition = z.object({
  horizontal: GraphCameraWindowAxisHorizontal,
  vertical: GraphCameraWindowAxisVertical,
});

export type GraphCameraWindowPosition = z.infer<typeof GraphCameraWindowPosition>;

export const GraphCamera = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  viewport: GraphCameraViewport.optional(),
  floatingWindows: z.record(GraphCameraWindowPosition).default({}),
});

export type GraphCamera = z.infer<typeof GraphCamera>;

export const NodeConfig = z.object({
  type: z.nativeEnum(NodeType),
  code: z.string().optional(),
  subgraphId: z.string().optional(),
  runtime: z.string().min(1).optional(),
  pythonEnv: z.string().trim().min(1).optional(),
  config: z.record(z.unknown()).optional(),
});

export type NodeConfig = z.infer<typeof NodeConfig>;

export const GraphNode = z.object({
  id: z.string(),
  type: z.nativeEnum(NodeType),
  position: DrawingPoint,
  metadata: NodeMetadata,
  config: NodeConfig,
  version: z.string(),
  lastComputed: z.number().optional(),
});

export type GraphNode = z.infer<typeof GraphNode>;

export const ConnectionAnchorSide = z.enum(['top', 'right', 'bottom', 'left']);
export type ConnectionAnchorSide = z.infer<typeof ConnectionAnchorSide>;

export const ConnectionAnchor = z.object({
  side: ConnectionAnchorSide,
  offset: z.number().finite().min(0).max(1),
});

export type ConnectionAnchor = z.infer<typeof ConnectionAnchor>;

export const Connection = z.object({
  id: z.string(),
  sourceNodeId: z.string(),
  sourcePort: z.string(),
  sourceAnchor: ConnectionAnchor.optional(),
  targetNodeId: z.string(),
  targetPort: z.string(),
  targetAnchor: ConnectionAnchor.optional(),
});

export type Connection = z.infer<typeof Connection>;

export const Graph = z.object({
  id: z.string(),
  name: z.string(),
  revision: z.number().int().nonnegative(),
  nodes: z.array(GraphNode),
  connections: z.array(Connection),
  recomputeConcurrency: z.number().int().min(1).max(32).optional(),
  executionTimeoutMs: z.number().finite().positive().optional(),
  canvasBackground: CanvasBackground.optional(),
  connectionStroke: GraphConnectionStroke.optional(),
  projections: z.array(GraphProjection).optional(),
  activeProjectionId: z.string().trim().min(1).optional(),
  cameras: z.array(GraphCamera).optional(),
  pythonEnvs: z.array(PythonEnvironment).default([]),
  algoInjections: z.array(GraphAlgoInjection).default([]),
  drawings: z.array(GraphDrawing).default([]),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export type Graph = z.infer<typeof Graph>;

export const GraphSummary = z.object({
  id: z.string(),
  name: z.string(),
  revision: z.number().int().nonnegative(),
  updatedAt: z.number(),
});

export type GraphSummary = z.infer<typeof GraphSummary>;

export const GraphicsMipLevel = z.object({
  level: z.number().int().nonnegative(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  pixelCount: z.number().int().positive(),
});

export type GraphicsMipLevel = z.infer<typeof GraphicsMipLevel>;

export const GraphicsArtifact = z.object({
  id: z.string(),
  mimeType: z.string(),
  levels: z.array(GraphicsMipLevel).min(1),
});

export type GraphicsArtifact = z.infer<typeof GraphicsArtifact>;

export const ComputationResult = z.object({
  nodeId: z.string(),
  outputs: z.record(z.unknown()),
  schema: z.record(DataSchema),
  timestamp: z.number(),
  version: z.string(),
  textOutput: z.string().optional(),
  graphicsOutput: z.string().optional(),
  graphics: GraphicsArtifact.optional(),
});

export type ComputationResult = z.infer<typeof ComputationResult>;

export const NodeExecutionState = z.object({
  isPending: z.boolean(),
  isComputing: z.boolean(),
  hasError: z.boolean(),
  isStale: z.boolean(),
  errorMessage: z.string().nullable(),
  lastRunAt: z.number().nullable(),
});

export type NodeExecutionState = z.infer<typeof NodeExecutionState>;

export const GraphRuntimeState = z.object({
  graphId: z.string(),
  revision: z.number().int().nonnegative(),
  statusVersion: z.number().int().nonnegative(),
  queueLength: z.number().int().nonnegative(),
  workerConcurrency: z.number().int().positive(),
  nodeStates: z.record(NodeExecutionState),
  results: z.record(z.union([ComputationResult, z.null()])),
});

export type GraphRuntimeState = z.infer<typeof GraphRuntimeState>;

const ReplaceNodesCommand = z.object({
  kind: z.literal('replace_nodes'),
  nodes: z.array(GraphNode),
});

const ReplaceConnectionsCommand = z.object({
  kind: z.literal('replace_connections'),
  connections: z.array(Connection),
});

const ReplaceDrawingsCommand = z.object({
  kind: z.literal('replace_drawings'),
  drawings: z.array(GraphDrawing),
});

const ReplaceProjectionsCommand = z.object({
  kind: z.literal('replace_projections'),
  projections: z.array(GraphProjection),
});

const ReplaceCamerasCommand = z.object({
  kind: z.literal('replace_cameras'),
  cameras: z.array(GraphCamera),
});

const ReplacePythonEnvsCommand = z.object({
  kind: z.literal('replace_python_envs'),
  pythonEnvs: z.array(PythonEnvironment),
});

const SetGraphNameCommand = z.object({
  kind: z.literal('set_graph_name'),
  name: z.string().trim().min(1),
});

const SetRecomputeConcurrencyCommand = z.object({
  kind: z.literal('set_recompute_concurrency'),
  recomputeConcurrency: z.number().int().min(1).max(32),
});

const SetExecutionTimeoutCommand = z.object({
  kind: z.literal('set_execution_timeout'),
  executionTimeoutMs: z.number().finite().positive(),
});

const SetConnectionStrokeCommand = z.object({
  kind: z.literal('set_connection_stroke'),
  connectionStroke: GraphConnectionStroke,
});

const SetCanvasBackgroundCommand = z.object({
  kind: z.literal('set_canvas_background'),
  canvasBackground: CanvasBackground,
});

const SetActiveProjectionCommand = z.object({
  kind: z.literal('set_active_projection'),
  activeProjectionId: z.string().trim().min(1),
});

const GraphProjectionAddCommand = z.object({
  kind: z.literal('graph_projection_add'),
  projectionId: z.string().trim().min(1).optional(),
  name: z.string().trim().min(1).optional(),
  sourceProjectionId: z.string().trim().min(1).optional(),
  activate: z.boolean().optional(),
});

const GraphProjectionSelectCommand = z.object({
  kind: z.literal('graph_projection_select'),
  projectionId: z.string().trim().min(1),
});

const GraphPythonEnvAddCommand = z.object({
  kind: z.literal('graph_python_env_add'),
  name: z.string().trim().min(1),
  pythonPath: z.string().trim().min(1),
  cwd: z.string().trim().min(1),
});

const GraphPythonEnvEditCommand = z.object({
  kind: z.literal('graph_python_env_edit'),
  envName: z.string().trim().min(1),
  name: z.string().trim().min(1).optional(),
  pythonPath: z.string().trim().min(1).optional(),
  cwd: z.string().trim().min(1).optional(),
});

const GraphPythonEnvDeleteCommand = z.object({
  kind: z.literal('graph_python_env_delete'),
  envName: z.string().trim().min(1),
});

const NodeAddInlineCommand = z.object({
  kind: z.literal('node_add_inline'),
  nodeId: z.string().trim().min(1).optional(),
  name: z.string().optional(),
  x: z.number(),
  y: z.number(),
  cardWidth: z.number().finite().positive().optional(),
  cardHeight: z.number().finite().positive().optional(),
  inputNames: z.array(z.string()).optional(),
  outputNames: z.array(z.string()).optional(),
  code: z.string().optional(),
  runtime: z.string().optional(),
  pythonEnv: z.string().optional(),
  autoRecompute: z.boolean().optional(),
});

const NodeAddNumericInputCommand = z.object({
  kind: z.literal('node_add_numeric_input'),
  nodeId: z.string().trim().min(1).optional(),
  name: z.string().optional(),
  x: z.number(),
  y: z.number(),
  cardWidth: z.number().finite().positive().optional(),
  cardHeight: z.number().finite().positive().optional(),
  value: z.number().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  step: z.number().optional(),
  autoRecompute: z.boolean().optional(),
});

const NodeAddAnnotationCommand = z.object({
  kind: z.literal('node_add_annotation'),
  nodeId: z.string().trim().min(1).optional(),
  name: z.string().optional(),
  x: z.number(),
  y: z.number(),
  cardWidth: z.number().finite().positive().optional(),
  cardHeight: z.number().finite().positive().optional(),
  text: z.string().optional(),
  backgroundColor: z.string().optional(),
  borderColor: z.string().optional(),
  fontColor: z.string().optional(),
  fontSize: z.number().optional(),
});

const NodeMoveCommand = z.object({
  kind: z.literal('node_move'),
  nodeId: z.string(),
  x: z.number(),
  y: z.number(),
});

const NodeSetNameCommand = z.object({
  kind: z.literal('node_set_name'),
  nodeId: z.string(),
  name: z.string(),
});

const NodeSetCodeCommand = z.object({
  kind: z.literal('node_set_code'),
  nodeId: z.string(),
  code: z.string(),
  outputNames: z.array(z.string()).optional(),
  runtime: z.string().optional(),
  pythonEnv: z.string().optional(),
});

const NodeSetAnnotationCommand = z.object({
  kind: z.literal('node_set_annotation'),
  nodeId: z.string(),
  text: z.string().optional(),
  backgroundColor: z.string().optional(),
  borderColor: z.string().optional(),
  fontColor: z.string().optional(),
  fontSize: z.number().optional(),
});

const NodeSetAutoRecomputeCommand = z.object({
  kind: z.literal('node_set_auto_recompute'),
  nodeId: z.string(),
  enabled: z.boolean(),
});

const NodeAddInputCommand = z.object({
  kind: z.literal('node_add_input'),
  nodeId: z.string(),
  inputName: z.string(),
});

const NodeDeleteInputCommand = z.object({
  kind: z.literal('node_delete_input'),
  nodeId: z.string(),
  inputName: z.string(),
});

const NodeMoveInputCommand = z.object({
  kind: z.literal('node_move_input'),
  nodeId: z.string(),
  inputName: z.string(),
  direction: z.enum(['up', 'down']),
});

const NodeRenameInputCommand = z.object({
  kind: z.literal('node_rename_input'),
  nodeId: z.string(),
  oldName: z.string(),
  newName: z.string(),
});

const NodeDeleteCommand = z.object({
  kind: z.literal('node_delete'),
  nodeId: z.string(),
});

const ConnectionAddCommand = z.object({
  kind: z.literal('connection_add'),
  connectionId: z.string().optional(),
  sourceNodeId: z.string(),
  sourcePort: z.string(),
  sourceAnchor: ConnectionAnchor.optional(),
  targetNodeId: z.string(),
  targetPort: z.string(),
  targetAnchor: ConnectionAnchor.optional(),
});

const ConnectionSetCommand = z.object({
  kind: z.literal('connection_set'),
  connectionId: z.string().optional(),
  sourceNodeId: z.string(),
  sourcePort: z.string(),
  sourceAnchor: ConnectionAnchor.optional(),
  targetNodeId: z.string(),
  targetPort: z.string(),
  targetAnchor: ConnectionAnchor.optional(),
});

const ConnectionReplaceCommand = z.object({
  kind: z.literal('connection_replace'),
  connectionId: z.string().optional(),
  sourceNodeId: z.string(),
  sourcePort: z.string(),
  sourceAnchor: ConnectionAnchor.optional(),
  targetNodeId: z.string(),
  targetPort: z.string(),
  targetAnchor: ConnectionAnchor.optional(),
});

const ConnectionDeleteCommand = z.object({
  kind: z.literal('connection_delete'),
  connectionId: z.string(),
});

const DrawingCreateCommand = z.object({
  kind: z.literal('drawing_create'),
  drawingId: z.string().trim().min(1).optional(),
  name: z.string().optional(),
  x: z.number().optional(),
  y: z.number().optional(),
});

const DrawingAddPathCommand = z.object({
  kind: z.literal('drawing_add_path'),
  drawingId: z.string(),
  points: z.array(DrawingPoint).min(1),
  color: z.string().optional(),
  thickness: z.number().positive().optional(),
  pathId: z.string().optional(),
  coordinateSpace: z.enum(['world', 'local']).optional(),
});

const DrawingMoveCommand = z.object({
  kind: z.literal('drawing_move'),
  drawingId: z.string(),
  x: z.number(),
  y: z.number(),
});

const DrawingSetNameCommand = z.object({
  kind: z.literal('drawing_set_name'),
  drawingId: z.string(),
  name: z.string(),
});

const DrawingDeleteCommand = z.object({
  kind: z.literal('drawing_delete'),
  drawingId: z.string(),
});

const ComputeNodeCommand = z.object({
  kind: z.literal('compute_node'),
  nodeId: z.string(),
});

const ComputeGraphCommand = z.object({
  kind: z.literal('compute_graph'),
});

export const GraphCommand = z.discriminatedUnion('kind', [
  ReplaceNodesCommand,
  ReplaceConnectionsCommand,
  ReplaceDrawingsCommand,
  ReplaceProjectionsCommand,
  ReplaceCamerasCommand,
  ReplacePythonEnvsCommand,
  SetGraphNameCommand,
  SetRecomputeConcurrencyCommand,
  SetExecutionTimeoutCommand,
  SetConnectionStrokeCommand,
  SetCanvasBackgroundCommand,
  SetActiveProjectionCommand,
  GraphProjectionAddCommand,
  GraphProjectionSelectCommand,
  GraphPythonEnvAddCommand,
  GraphPythonEnvEditCommand,
  GraphPythonEnvDeleteCommand,
  NodeAddInlineCommand,
  NodeAddNumericInputCommand,
  NodeAddAnnotationCommand,
  NodeMoveCommand,
  NodeSetNameCommand,
  NodeSetCodeCommand,
  NodeSetAnnotationCommand,
  NodeSetAutoRecomputeCommand,
  NodeAddInputCommand,
  NodeDeleteInputCommand,
  NodeMoveInputCommand,
  NodeRenameInputCommand,
  NodeDeleteCommand,
  ConnectionAddCommand,
  ConnectionSetCommand,
  ConnectionReplaceCommand,
  ConnectionDeleteCommand,
  DrawingCreateCommand,
  DrawingAddPathCommand,
  DrawingMoveCommand,
  DrawingSetNameCommand,
  DrawingDeleteCommand,
  ComputeNodeCommand,
  ComputeGraphCommand,
]);

export type GraphCommand = z.infer<typeof GraphCommand>;

export const GraphCommandRequest = z.object({
  baseRevision: z.number().int().nonnegative(),
  commands: z.array(GraphCommand).min(1),
});

export type GraphCommandRequest = z.infer<typeof GraphCommandRequest>;

export const GraphCommandResponse = z.object({
  graph: Graph,
  runtimeState: GraphRuntimeState.optional(),
});

export type GraphCommandResponse = z.infer<typeof GraphCommandResponse>;

export const GraphEvent = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('graph.revised'),
    graphId: z.string(),
    revision: z.number().int().nonnegative(),
    updatedAt: z.number(),
  }),
  z.object({
    type: z.literal('runtime.node.updated'),
    graphId: z.string(),
    revision: z.number().int().nonnegative(),
    nodeId: z.string(),
  }),
  z.object({
    type: z.literal('runtime.task.completed'),
    graphId: z.string(),
    revision: z.number().int().nonnegative(),
    scheduledNodeIds: z.array(z.string()),
    completedNodeIds: z.array(z.string()),
  }),
]);

export type GraphEvent = z.infer<typeof GraphEvent>;

function stableStringify(value: unknown): string {
  return JSON.stringify(value);
}

export function buildGraphCommandsFromSnapshotChange(
  currentGraph: Graph,
  nextGraph: Graph
): GraphCommand[] {
  const commands: GraphCommand[] = [];

  if (currentGraph.name !== nextGraph.name) {
    commands.push({
      kind: 'set_graph_name',
      name: nextGraph.name,
    });
  }

  if ((currentGraph.recomputeConcurrency ?? 1) !== (nextGraph.recomputeConcurrency ?? 1)) {
    commands.push({
      kind: 'set_recompute_concurrency',
      recomputeConcurrency: nextGraph.recomputeConcurrency ?? 1,
    });
  }

  if (
    (currentGraph.executionTimeoutMs ?? DEFAULT_GRAPH_EXECUTION_TIMEOUT_MS) !==
    (nextGraph.executionTimeoutMs ?? DEFAULT_GRAPH_EXECUTION_TIMEOUT_MS)
  ) {
    commands.push({
      kind: 'set_execution_timeout',
      executionTimeoutMs: nextGraph.executionTimeoutMs ?? DEFAULT_GRAPH_EXECUTION_TIMEOUT_MS,
    });
  }

  if (
    stableStringify(currentGraph.connectionStroke ?? DEFAULT_GRAPH_CONNECTION_STROKE) !==
    stableStringify(nextGraph.connectionStroke ?? DEFAULT_GRAPH_CONNECTION_STROKE)
  ) {
    commands.push({
      kind: 'set_connection_stroke',
      connectionStroke: nextGraph.connectionStroke ?? DEFAULT_GRAPH_CONNECTION_STROKE,
    });
  }

  if (
    stableStringify(currentGraph.canvasBackground ?? DEFAULT_CANVAS_BACKGROUND) !==
    stableStringify(nextGraph.canvasBackground ?? DEFAULT_CANVAS_BACKGROUND)
  ) {
    commands.push({
      kind: 'set_canvas_background',
      canvasBackground: nextGraph.canvasBackground ?? DEFAULT_CANVAS_BACKGROUND,
    });
  }

  if (
    stableStringify(currentGraph.pythonEnvs ?? []) !==
    stableStringify(nextGraph.pythonEnvs ?? [])
  ) {
    commands.push({
      kind: 'replace_python_envs',
      pythonEnvs: nextGraph.pythonEnvs ?? [],
    });
  }

  if (
    stableStringify(currentGraph.cameras ?? []) !==
    stableStringify(nextGraph.cameras ?? [])
  ) {
    commands.push({
      kind: 'replace_cameras',
      cameras: nextGraph.cameras ?? [],
    });
  }

  if (
    stableStringify(currentGraph.drawings ?? []) !==
    stableStringify(nextGraph.drawings ?? [])
  ) {
    commands.push({
      kind: 'replace_drawings',
      drawings: nextGraph.drawings ?? [],
    });
  }

  if (stableStringify(currentGraph.nodes) !== stableStringify(nextGraph.nodes)) {
    commands.push({
      kind: 'replace_nodes',
      nodes: nextGraph.nodes,
    });
  }

  if (stableStringify(currentGraph.connections) !== stableStringify(nextGraph.connections)) {
    commands.push({
      kind: 'replace_connections',
      connections: nextGraph.connections,
    });
  }

  if (
    stableStringify(currentGraph.projections ?? []) !==
    stableStringify(nextGraph.projections ?? [])
  ) {
    commands.push({
      kind: 'replace_projections',
      projections: nextGraph.projections ?? [],
    });
  }

  if ((currentGraph.activeProjectionId ?? '') !== (nextGraph.activeProjectionId ?? '')) {
    commands.push({
      kind: 'set_active_projection',
      activeProjectionId: nextGraph.activeProjectionId ?? DEFAULT_GRAPH_PROJECTION_ID,
    });
  }

  return commands;
}

export * from './graphCommands.js';
export * from './graphCamera.js';
export * from './graphConnection.js';
export * from './graphDrawing.js';
export * from './graphMutation.js';
export * from './graphNodes.js';
export * from './graphProjection.js';
export * from './graphQuery.js';
export * from './graphState.js';
