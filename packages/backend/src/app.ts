import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { z } from 'zod';
import { DataStore } from './core/DataStore.js';
import { GraphEngine } from './core/GraphEngine.js';
import {
  executeGraphQuery,
  GRAPH_QUERY_CONNECTION_FIELDS,
  GRAPH_QUERY_NODE_FIELDS,
  GraphQueryValidationError,
  type GraphQueryRequest,
} from './core/graphQuery.js';
import {
  normalizeConnectionStrokeValue,
  normalizeGraphProjections,
} from './core/graphNormalization.js';
import { NodeExecutor } from './core/NodeExecutor.js';
import { RecomputeManager } from './core/RecomputeManager.js';
import {
  CanvasBackground,
  Connection,
  DEFAULT_CANVAS_BACKGROUND,
  DEFAULT_GRAPH_EXECUTION_TIMEOUT_MS,
  DEFAULT_GRAPH_PROJECTION_ID,
  Graph,
  GraphConnectionStroke,
  GraphDrawing,
  GraphProjection,
  GraphNode,
  PythonEnvironment,
} from './types/index.js';
import { DEFAULT_RUNTIME_ID, PYTHON_RUNTIME_ID } from './core/execution/types.js';
import { v4 as uuidv4 } from 'uuid';

interface AppDependencies {
  dataStore: DataStore;
  graphEngine: GraphEngine;
}

const JSON_BODY_LIMIT = '10mb';

const CreateGraphSchema = z.object({
  name: z.string().optional().default('Untitled Graph'),
  nodes: z.array(GraphNode).optional().default([]),
  connections: z.array(Connection).optional().default([]),
  recomputeConcurrency: z.number().int().min(1).max(32).optional(),
  executionTimeoutMs: z.number().finite().positive().optional(),
  canvasBackground: CanvasBackground.optional(),
  connectionStroke: GraphConnectionStroke.optional(),
  projections: z.array(GraphProjection).optional(),
  activeProjectionId: z.string().trim().min(1).optional(),
  pythonEnvs: z.array(PythonEnvironment).optional().default([]),
  drawings: z.array(GraphDrawing).optional().default([]),
});

const UpdateGraphSchema = z.object({
  name: z.string().optional(),
  nodes: z.array(GraphNode).optional(),
  connections: z.array(Connection).optional(),
  recomputeConcurrency: z.number().int().min(1).max(32).optional(),
  executionTimeoutMs: z.number().finite().positive().optional(),
  canvasBackground: CanvasBackground.optional(),
  connectionStroke: GraphConnectionStroke.optional(),
  projections: z.array(GraphProjection).optional(),
  activeProjectionId: z.string().trim().min(1).optional(),
  pythonEnvs: z.array(PythonEnvironment).optional(),
  drawings: z.array(GraphDrawing).optional(),
  ifMatchUpdatedAt: z.number().optional(),
});

const ComputeRequestSchema = z.object({
  nodeId: z.string().optional(),
});

const GraphicsBinaryQuerySchema = z.object({
  maxPixels: z.coerce.number().int().positive().optional(),
});

const GraphQueryNodeFieldSchema = z.enum(GRAPH_QUERY_NODE_FIELDS);

const GraphQueryConnectionFieldSchema = z.enum(GRAPH_QUERY_CONNECTION_FIELDS);

const GraphQueryBaseSchema = z.object({
  nodeFields: z.array(GraphQueryNodeFieldSchema).optional(),
  connectionFields: z.array(GraphQueryConnectionFieldSchema).optional(),
});

const GraphOverviewQuerySchema = GraphQueryBaseSchema.extend({
  operation: z.literal('overview'),
});

const GraphStartingVerticesQuerySchema = GraphQueryBaseSchema.extend({
  operation: z.literal('starting_vertices'),
});

const GraphTraverseBfsQuerySchema = GraphQueryBaseSchema.extend({
  operation: z.literal('traverse_bfs'),
  startNodeIds: z.array(z.string().trim().min(1)).min(1),
  depth: z.number().int().nonnegative().optional(),
});

const GraphTraverseDfsQuerySchema = GraphQueryBaseSchema.extend({
  operation: z.literal('traverse_dfs'),
  startNodeIds: z.array(z.string().trim().min(1)).min(1),
  maxNodes: z.number().int().positive(),
});

const GraphQueryRequestSchema = z.discriminatedUnion('operation', [
  GraphOverviewQuerySchema,
  GraphStartingVerticesQuerySchema,
  GraphTraverseBfsQuerySchema,
  GraphTraverseDfsQuerySchema,
]);

const CreateLibraryNodeSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  graphId: z.string().optional(),
  version: z.string().optional().default('1.0.0'),
});

const validate = <T extends z.ZodType>(schema: T) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: result.error.flatten(),
      });
    }
    req.body = result.data;
    next();
  };
};

function isTruthyQueryFlag(value: unknown): boolean {
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
  }

  if (Array.isArray(value)) {
    return value.some((candidate) => isTruthyQueryFlag(candidate));
  }

  return false;
}

function connectionSignature(connection: Connection): string {
  return `${connection.sourceNodeId}:${connection.sourcePort}->${connection.targetNodeId}:${connection.targetPort}`;
}

function collectInboundConnectionChangedNodeIds(
  previousConnections: Connection[],
  nextConnections: Connection[]
): Set<string> {
  const previousByTarget = new Map<string, Set<string>>();
  for (const connection of previousConnections) {
    const signature = connectionSignature(connection);
    const existing = previousByTarget.get(connection.targetNodeId);
    if (existing) {
      existing.add(signature);
    } else {
      previousByTarget.set(connection.targetNodeId, new Set([signature]));
    }
  }

  const nextByTarget = new Map<string, Set<string>>();
  for (const connection of nextConnections) {
    const signature = connectionSignature(connection);
    const existing = nextByTarget.get(connection.targetNodeId);
    if (existing) {
      existing.add(signature);
    } else {
      nextByTarget.set(connection.targetNodeId, new Set([signature]));
    }
  }

  const changedNodeIds = new Set<string>();
  const targetNodeIds = new Set<string>([
    ...previousByTarget.keys(),
    ...nextByTarget.keys(),
  ]);

  for (const targetNodeId of targetNodeIds) {
    const previous = previousByTarget.get(targetNodeId) ?? new Set<string>();
    const next = nextByTarget.get(targetNodeId) ?? new Set<string>();
    if (previous.size !== next.size) {
      changedNodeIds.add(targetNodeId);
      continue;
    }

    let differs = false;
    for (const signature of previous) {
      if (!next.has(signature)) {
        differs = true;
        break;
      }
    }

    if (differs) {
      changedNodeIds.add(targetNodeId);
    }
  }

  return changedNodeIds;
}

function bumpNodeVersions(nodes: GraphNode[], nodeIds: Set<string>): GraphNode[] {
  if (nodeIds.size === 0) {
    return nodes;
  }

  const versionPrefix = Date.now().toString();
  return nodes.map((node) => {
    if (!nodeIds.has(node.id)) {
      return node;
    }
    return {
      ...node,
      version: `${versionPrefix}-${node.id}`,
    };
  });
}

function validateGraphStructure(graph: Graph): string | null {
  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  const drawingIds = new Set<string>();
  const pythonEnvNames = new Set<string>();
  const projectionIds = new Set<string>();

  if (!Array.isArray(graph.projections) || graph.projections.length === 0) {
    return 'Graph must include at least one projection';
  }
  if (!graph.activeProjectionId) {
    return 'Graph must include activeProjectionId';
  }
  for (const projection of graph.projections) {
    if (projectionIds.has(projection.id)) {
      return `Graph projection ids must be unique. Duplicate id: ${projection.id}`;
    }
    projectionIds.add(projection.id);
  }
  if (!projectionIds.has(DEFAULT_GRAPH_PROJECTION_ID)) {
    return `Graph must include "${DEFAULT_GRAPH_PROJECTION_ID}" projection`;
  }
  if (!projectionIds.has(graph.activeProjectionId)) {
    return `Graph active projection "${graph.activeProjectionId}" does not exist`;
  }

  for (const pythonEnv of graph.pythonEnvs ?? []) {
    if (pythonEnvNames.has(pythonEnv.name)) {
      return `Graph python environment names must be unique. Duplicate name: ${pythonEnv.name}`;
    }
    pythonEnvNames.add(pythonEnv.name);
  }

  for (const drawing of graph.drawings ?? []) {
    if (drawingIds.has(drawing.id)) {
      return `Graph drawing ids must be unique. Duplicate id: ${drawing.id}`;
    }
    drawingIds.add(drawing.id);

    const pathIds = new Set<string>();
    for (const path of drawing.paths) {
      if (pathIds.has(path.id)) {
        return `Drawing ${drawing.id} path ids must be unique. Duplicate id: ${path.id}`;
      }
      pathIds.add(path.id);
    }
  }

  for (const projection of graph.projections ?? []) {
    for (const nodeId of Object.keys(projection.nodePositions ?? {})) {
      if (!nodeIds.has(nodeId)) {
        return `Projection ${projection.id} references missing node ${nodeId}`;
      }
    }
    for (const [nodeId, size] of Object.entries(projection.nodeCardSizes ?? {})) {
      if (!nodeIds.has(nodeId)) {
        return `Projection ${projection.id} card size references missing node ${nodeId}`;
      }
      if (
        !Number.isFinite(size.width) ||
        size.width <= 0 ||
        !Number.isFinite(size.height) ||
        size.height <= 0
      ) {
        return `Projection ${projection.id} has invalid card size for node ${nodeId}`;
      }
    }
  }

  for (const connection of graph.connections) {
    if (!nodeIds.has(connection.sourceNodeId)) {
      return `Connection ${connection.id} references missing source node ${connection.sourceNodeId}`;
    }
    if (!nodeIds.has(connection.targetNodeId)) {
      return `Connection ${connection.id} references missing target node ${connection.targetNodeId}`;
    }
  }

  const adjacency = new Map<string, string[]>();
  for (const nodeId of nodeIds) {
    adjacency.set(nodeId, []);
  }
  for (const connection of graph.connections) {
    adjacency.get(connection.sourceNodeId)?.push(connection.targetNodeId);
  }

  const visited = new Set<string>();
  const visiting = new Set<string>();

  const dfs = (nodeId: string): boolean => {
    if (visiting.has(nodeId)) {
      return true;
    }
    if (visited.has(nodeId)) {
      return false;
    }

    visiting.add(nodeId);
    const neighbors = adjacency.get(nodeId) || [];
    for (const neighbor of neighbors) {
      if (dfs(neighbor)) {
        return true;
      }
    }
    visiting.delete(nodeId);
    visited.add(nodeId);
    return false;
  };

  for (const nodeId of nodeIds) {
    if (dfs(nodeId)) {
      return 'Graph contains a circular dependency';
    }
  }

  for (const node of graph.nodes) {
    const pythonEnvName = node.config.pythonEnv;
    if (!pythonEnvName) {
      continue;
    }

    const runtimeId = node.config.runtime ?? DEFAULT_RUNTIME_ID;
    if (runtimeId !== PYTHON_RUNTIME_ID) {
      return `Node ${node.id} references pythonEnv "${pythonEnvName}" but runtime "${runtimeId}" is not "${PYTHON_RUNTIME_ID}"`;
    }

    if (!pythonEnvNames.has(pythonEnvName)) {
      return `Node ${node.id} references unknown pythonEnv "${pythonEnvName}"`;
    }
  }

  return null;
}

export function createApp(deps?: AppDependencies) {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: JSON_BODY_LIMIT }));

  const dataStore = deps?.dataStore ?? new DataStore('./k8v.db', './data');
  const graphEngine =
    deps?.graphEngine ?? new GraphEngine(dataStore, new NodeExecutor(dataStore));
  const recomputeManager = new RecomputeManager(dataStore, graphEngine);

  app.get('/api/graphs', async (_req, res) => {
    try {
      const graphs = await dataStore.listGraphs();
      res.json({ graphs });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/graphs/latest', async (_req, res) => {
    try {
      const graph = await dataStore.getLatestGraph();
      if (!graph) {
        return res.status(404).json({ error: 'No graphs found' });
      }
      res.json(graph);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/graphs/:id', async (req, res) => {
    try {
      const graph = await dataStore.getGraph(req.params.id);
      if (!graph) {
        return res.status(404).json({ error: 'Graph not found' });
      }
      res.json(graph);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/graphs/:id/query', validate(GraphQueryRequestSchema), async (req, res) => {
    try {
      const graph = await dataStore.getGraph(req.params.id) as Graph | null;
      if (!graph) {
        return res.status(404).json({ error: 'Graph not found' });
      }

      return res.json(executeGraphQuery(graph, req.body as GraphQueryRequest));
    } catch (error: any) {
      if (error instanceof GraphQueryValidationError) {
        return res.status(400).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/graphs', validate(CreateGraphSchema), async (req, res) => {
    try {
      const projectionState = normalizeGraphProjections(
        req.body.nodes,
        req.body.projections,
        req.body.activeProjectionId,
        req.body.canvasBackground,
        req.body.canvasBackground
      );
      const graph: Graph = {
        id: uuidv4(),
        name: req.body.name,
        nodes: projectionState.nodes,
        connections: req.body.connections,
        recomputeConcurrency: req.body.recomputeConcurrency ?? 1,
        executionTimeoutMs: req.body.executionTimeoutMs ?? DEFAULT_GRAPH_EXECUTION_TIMEOUT_MS,
        canvasBackground: projectionState.canvasBackground,
        connectionStroke: normalizeConnectionStrokeValue(req.body.connectionStroke),
        projections: projectionState.projections,
        activeProjectionId: projectionState.activeProjectionId,
        pythonEnvs: req.body.pythonEnvs,
        drawings: req.body.drawings,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const validationError = validateGraphStructure(graph);
      if (validationError) {
        return res.status(400).json({ error: validationError });
      }

      await dataStore.storeGraph(graph);
      res.json(graph);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.put('/api/graphs/:id', validate(UpdateGraphSchema), async (req, res) => {
    try {
      const existing = await dataStore.getGraph(req.params.id);
      if (!existing) {
        return res.status(404).json({ error: 'Graph not found' });
      }
      const noRecompute = isTruthyQueryFlag(req.query.noRecompute);

      const expectedUpdatedAt = req.body.ifMatchUpdatedAt;
      if (typeof expectedUpdatedAt === 'number' && expectedUpdatedAt !== existing.updatedAt) {
        return res.status(409).json({
          error: 'Graph has changed since it was loaded. Reload and retry your update.',
          currentUpdatedAt: existing.updatedAt,
        });
      }

      if (Array.isArray(req.body.projections) && req.body.projections.length === 0) {
        return res.status(400).json({ error: 'At least one projection must remain in the graph.' });
      }

      const graphUpdates = { ...req.body } as Partial<Graph> & { ifMatchUpdatedAt?: number };
      delete graphUpdates.ifMatchUpdatedAt;
      const mergedNodes = req.body.nodes ?? existing.nodes;
      const mergedConnections = req.body.connections ?? existing.connections;
      const mergedCanvasBackground = req.body.canvasBackground ?? existing.canvasBackground ?? DEFAULT_CANVAS_BACKGROUND;
      const mergedConnectionStroke = req.body.connectionStroke ?? existing.connectionStroke;
      const inboundConnectionChangedNodeIds = req.body.connections
        ? collectInboundConnectionChangedNodeIds(existing.connections, mergedConnections)
        : new Set<string>();
      const projectionState = normalizeGraphProjections(
        mergedNodes,
        req.body.projections ?? existing.projections,
        req.body.activeProjectionId ?? existing.activeProjectionId,
        mergedCanvasBackground,
        req.body.canvasBackground
      );
      const nextNodes = bumpNodeVersions(projectionState.nodes, inboundConnectionChangedNodeIds);
      const graph: Graph = {
        ...existing,
        ...graphUpdates,
        id: req.params.id,
        nodes: nextNodes,
        recomputeConcurrency: req.body.recomputeConcurrency ?? existing.recomputeConcurrency ?? 1,
        executionTimeoutMs:
          req.body.executionTimeoutMs ??
          existing.executionTimeoutMs ??
          DEFAULT_GRAPH_EXECUTION_TIMEOUT_MS,
        canvasBackground: projectionState.canvasBackground,
        connectionStroke: normalizeConnectionStrokeValue(mergedConnectionStroke),
        projections: projectionState.projections,
        activeProjectionId: projectionState.activeProjectionId,
        pythonEnvs: req.body.pythonEnvs ?? existing.pythonEnvs ?? [],
        drawings: req.body.drawings ?? existing.drawings ?? [],
        updatedAt: Date.now(),
      };

      const validationError = validateGraphStructure(graph);
      if (validationError) {
        return res.status(400).json({ error: validationError });
      }

      await dataStore.storeGraph(graph);
      if (!noRecompute) {
        recomputeManager.queueGraphUpdateRecompute(existing, graph);
      }
      res.json(graph);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete('/api/graphs/:id', async (req, res) => {
    try {
      const deleted = await dataStore.deleteGraph(req.params.id);
      if (!deleted) {
        return res.status(404).json({ error: 'Graph not found' });
      }
      recomputeManager.dropGraphState(req.params.id);
      res.status(204).send();
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/graphs/:id/compute', validate(ComputeRequestSchema), async (req, res) => {
    try {
      const graph = await dataStore.getGraph(req.params.id);
      if (!graph) {
        return res.status(404).json({ error: 'Graph not found' });
      }

      const nodeId = req.body.nodeId;
      if (nodeId) {
        const result = await recomputeManager.requestNodeRecompute(graph.id, nodeId);
        res.json(result);
      } else {
        const results = await recomputeManager.requestGraphRecompute(graph.id);
        res.json(Array.from(results.values()));
      }
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/graphs/:id/recompute-status', async (req, res) => {
    try {
      const graph = await dataStore.getGraph(req.params.id);
      if (!graph) {
        return res.status(404).json({ error: 'Graph not found' });
      }

      const status = await recomputeManager.getGraphStatus(graph.id);
      res.json(status);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/library-nodes', async (_req, res) => {
    try {
      const libraries = await dataStore.listLibraryNodes();
      res.json({ libraries });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/library-nodes/:id', async (req, res) => {
    try {
      const library = await dataStore.getLibraryNode(req.params.id);
      if (!library) {
        return res.status(404).json({ error: 'Library node not found' });
      }
      res.json(library);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/library-nodes', validate(CreateLibraryNodeSchema), async (req, res) => {
    try {
      const manifest = {
        id: uuidv4(),
        name: req.body.name,
        description: req.body.description,
        version: req.body.version,
        createdAt: Date.now(),
      };

      await dataStore.storeLibraryNode(manifest, req.body.graphId);
      res.json(manifest);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/nodes/:id/result', async (req, res) => {
    try {
      const result = await dataStore.getResult(req.params.id, req.query.version as string);
      if (!result) {
        return res.status(404).json({ error: 'Result not found' });
      }
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/graphics/:id', async (req, res) => {
    try {
      const graphics = await dataStore.getGraphicsArtifact(req.params.id);
      if (!graphics) {
        return res.status(404).json({ error: 'Graphics not found' });
      }
      res.json(graphics);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/graphics/:id/image', async (req, res) => {
    try {
      const parsedQuery = GraphicsBinaryQuerySchema.safeParse(req.query);
      if (!parsedQuery.success) {
        return res.status(400).json({
          error: 'Validation failed',
          details: parsedQuery.error.flatten(),
        });
      }

      const result = await dataStore.getGraphicsBinary(req.params.id, parsedQuery.data.maxPixels);
      if (!result) {
        return res.status(404).json({ error: 'Graphics not found' });
      }

      res.setHeader('Content-Type', result.mimeType);
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.setHeader('X-K8V-Graphics-Level', String(result.selectedLevel.level));
      res.setHeader('X-K8V-Graphics-Width', String(result.selectedLevel.width));
      res.setHeader('X-K8V-Graphics-Height', String(result.selectedLevel.height));
      res.setHeader('X-K8V-Graphics-Pixels', String(result.selectedLevel.pixelCount));
      res.send(result.buffer);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  return app;
}
