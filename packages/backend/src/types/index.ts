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
  NUMERIC_INPUT = 'numeric_input',
  EXTERNAL_OUTPUT = 'external_output',
}

// Graph-scoped Python environment definition
export const PythonEnvironment = z.object({
  name: z.string().trim().min(1),
  pythonPath: z.string().trim().min(1),
  cwd: z.string().trim().min(1),
});

export type PythonEnvironment = z.infer<typeof PythonEnvironment>;

// Persistent freehand drawing primitives
const LEGACY_DRAWING_COLOR_MAP = {
  white: '#ffffff',
  green: '#22c55e',
  red: '#ef4444',
} as const;

export const DrawingColor = z
  .string()
  .trim()
  .min(1)
  .transform((value) => {
    const lowered = value.toLowerCase();
    if (lowered in LEGACY_DRAWING_COLOR_MAP) {
      return LEGACY_DRAWING_COLOR_MAP[lowered as keyof typeof LEGACY_DRAWING_COLOR_MAP];
    }
    return lowered;
  })
  .refine((value) => /^#[0-9a-f]{6}$/.test(value), {
    message: 'Drawing color must be a hex color in #RRGGBB format',
  });
export type DrawingColor = z.infer<typeof DrawingColor>;

export const DrawingPath = z.object({
  id: z.string(),
  color: DrawingColor,
  thickness: z.number().positive(),
  // Path points are local to drawing.position
  points: z.array(
    z.object({
      x: z.number(),
      y: z.number(),
    })
  ),
});

export type DrawingPath = z.infer<typeof DrawingPath>;

export const GraphDrawing = z.object({
  id: z.string(),
  name: z.string().trim().min(1),
  position: z.object({
    x: z.number(),
    y: z.number(),
  }),
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

export const DEFAULT_GRAPH_PROJECTION_ID = 'default';
export const DEFAULT_GRAPH_PROJECTION_NAME = 'Default';

export const GraphProjection = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  nodePositions: z.record(
    z.object({
      x: z.number(),
      y: z.number(),
    })
  ).default({}),
  nodeCardSizes: z.record(
    z.object({
      width: z.number().positive(),
      height: z.number().positive(),
    })
  ).default({}),
  canvasBackground: CanvasBackground.optional(),
});

export type GraphProjection = z.infer<typeof GraphProjection>;

// Node configuration
export const NodeConfig = z.object({
  type: z.nativeEnum(NodeType),
  code: z.string().optional(), // For inline code nodes
  libraryId: z.string().optional(), // For library nodes
  subgraphId: z.string().optional(), // For subgraph nodes
  runtime: z.string().min(1).optional(), // Runtime identifier for executable nodes
  pythonEnv: z.string().trim().min(1).optional(), // Named graph-level Python env for python_process runtime
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
  canvasBackground: CanvasBackground.optional(),
  projections: z.array(GraphProjection).optional(),
  activeProjectionId: z.string().trim().min(1).optional(),
  pythonEnvs: z.array(PythonEnvironment).default([]),
  drawings: z.array(GraphDrawing).default([]),
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
  graphicsOutput: z.string().optional(), // Internal runtime payload (legacy/data URL)
  graphics: z
    .object({
      id: z.string(),
      mimeType: z.string(),
      levels: z
        .array(
          z.object({
            level: z.number().int().nonnegative(),
            width: z.number().int().positive(),
            height: z.number().int().positive(),
            pixelCount: z.number().int().positive(),
          })
        )
        .min(1),
    })
    .optional(),
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
