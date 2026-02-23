import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { z } from 'zod';
import { DataStore } from './core/DataStore.js';
import { GraphEngine } from './core/GraphEngine.js';
import { NodeExecutor } from './core/NodeExecutor.js';
import {
  CanvasBackground,
  Connection,
  DEFAULT_CANVAS_BACKGROUND,
  DEFAULT_GRAPH_PROJECTION_ID,
  DEFAULT_GRAPH_PROJECTION_NAME,
  Graph,
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
  canvasBackground: CanvasBackground.optional().default(DEFAULT_CANVAS_BACKGROUND),
  projections: z.array(GraphProjection).optional(),
  activeProjectionId: z.string().trim().min(1).optional(),
  pythonEnvs: z.array(PythonEnvironment).optional().default([]),
  drawings: z.array(GraphDrawing).optional().default([]),
});

const UpdateGraphSchema = z.object({
  name: z.string().optional(),
  nodes: z.array(GraphNode).optional(),
  connections: z.array(Connection).optional(),
  canvasBackground: CanvasBackground.optional(),
  projections: z.array(GraphProjection).optional(),
  activeProjectionId: z.string().trim().min(1).optional(),
  pythonEnvs: z.array(PythonEnvironment).optional(),
  drawings: z.array(GraphDrawing).optional(),
});

const ComputeRequestSchema = z.object({
  nodeId: z.string().optional(),
});

const GraphicsBinaryQuerySchema = z.object({
  maxPixels: z.coerce.number().int().positive().optional(),
});

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

function buildProjectionNodePositionMap(nodes: GraphNode[]): Record<string, { x: number; y: number }> {
  const map: Record<string, { x: number; y: number }> = {};
  for (const node of nodes) {
    map[node.id] = {
      x: node.position.x,
      y: node.position.y,
    };
  }
  return map;
}

function normalizeGraphProjections(
  nodes: GraphNode[],
  projections: GraphProjection[] | undefined,
  activeProjectionId: string | undefined
): { projections: GraphProjection[]; activeProjectionId: string; nodes: GraphNode[] } {
  const fallbackNodePositions = buildProjectionNodePositionMap(nodes);
  const deduped: GraphProjection[] = [];
  const seenProjectionIds = new Set<string>();

  for (const projection of projections ?? []) {
    const projectionId = projection.id.trim();
    if (!projectionId || seenProjectionIds.has(projectionId)) {
      continue;
    }
    seenProjectionIds.add(projectionId);

    const normalizedNodePositions: Record<string, { x: number; y: number }> = {};
    for (const [nodeId, fallbackPosition] of Object.entries(fallbackNodePositions)) {
      const candidate = projection.nodePositions?.[nodeId];
      if (
        candidate &&
        Number.isFinite(candidate.x) &&
        Number.isFinite(candidate.y)
      ) {
        normalizedNodePositions[nodeId] = {
          x: candidate.x,
          y: candidate.y,
        };
      } else {
        normalizedNodePositions[nodeId] = {
          x: fallbackPosition.x,
          y: fallbackPosition.y,
        };
      }
    }

    deduped.push({
      ...projection,
      id: projectionId,
      name: projection.name.trim() || projectionId,
      nodePositions: normalizedNodePositions,
    });
  }

  if (!seenProjectionIds.has(DEFAULT_GRAPH_PROJECTION_ID)) {
    deduped.unshift({
      id: DEFAULT_GRAPH_PROJECTION_ID,
      name: DEFAULT_GRAPH_PROJECTION_NAME,
      nodePositions: fallbackNodePositions,
    });
  }

  const selectedActiveProjectionId =
    typeof activeProjectionId === 'string' && activeProjectionId.trim()
      ? activeProjectionId.trim()
      : DEFAULT_GRAPH_PROJECTION_ID;
  const normalizedActiveProjectionId = deduped.some(
    (projection) => projection.id === selectedActiveProjectionId
  )
    ? selectedActiveProjectionId
    : DEFAULT_GRAPH_PROJECTION_ID;

  const activeProjection =
    deduped.find((projection) => projection.id === normalizedActiveProjectionId) ?? deduped[0];
  const projectedNodes = nodes.map((node) => ({
    ...node,
    position: activeProjection?.nodePositions[node.id] ?? node.position,
  }));

  return {
    projections: deduped,
    activeProjectionId: normalizedActiveProjectionId,
    nodes: projectedNodes,
  };
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

  app.post('/api/graphs', validate(CreateGraphSchema), async (req, res) => {
    try {
      const projectionState = normalizeGraphProjections(
        req.body.nodes,
        req.body.projections,
        req.body.activeProjectionId
      );
      const graph: Graph = {
        id: uuidv4(),
        name: req.body.name,
        nodes: projectionState.nodes,
        connections: req.body.connections,
        canvasBackground: req.body.canvasBackground,
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

      const mergedNodes = req.body.nodes ?? existing.nodes;
      const projectionState = normalizeGraphProjections(
        mergedNodes,
        req.body.projections ?? existing.projections,
        req.body.activeProjectionId ?? existing.activeProjectionId
      );
      const graph: Graph = {
        ...existing,
        ...req.body,
        id: req.params.id,
        nodes: projectionState.nodes,
        canvasBackground: req.body.canvasBackground ?? existing.canvasBackground ?? DEFAULT_CANVAS_BACKGROUND,
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
        const result = await graphEngine.computeNode(graph, nodeId);
        res.json(result);
      } else {
        const results = await graphEngine.computeGraph(graph);
        res.json(Array.from(results.values()));
      }
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
