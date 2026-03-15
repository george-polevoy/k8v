import { Router } from 'express';
import { z } from 'zod';
import { DataStore } from '../core/DataStore.js';
import {
  GraphConflictError,
  GraphNotFoundError,
  GraphUpdateService,
  GraphWriteValidationError,
} from '../core/GraphUpdateService.js';
import { RecomputeManager } from '../core/RecomputeManager.js';
import {
  executeGraphQuery,
  GRAPH_QUERY_CONNECTION_FIELDS,
  GRAPH_QUERY_NODE_FIELDS,
  GraphQueryValidationError,
  type GraphQueryRequest,
} from '../core/graphQuery.js';
import { validate } from '../http/validate.js';
import {
  CanvasBackground,
  Connection,
  DEFAULT_GRAPH_EXECUTION_TIMEOUT_MS,
  Graph,
  GraphCamera,
  GraphConnectionStroke,
  GraphDrawing,
  GraphProjection,
  GraphNode,
  PythonEnvironment,
} from '../types/index.js';

interface GraphRoutesDependencies {
  dataStore: DataStore;
  recomputeManager: RecomputeManager;
}

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
  cameras: z.array(GraphCamera).optional().default([]),
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
  cameras: z.array(GraphCamera).optional(),
  pythonEnvs: z.array(PythonEnvironment).optional(),
  drawings: z.array(GraphDrawing).optional(),
  ifMatchUpdatedAt: z.number().optional(),
});

const ComputeRequestSchema = z.object({
  nodeId: z.string().optional(),
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

export function createGraphRouter(deps: GraphRoutesDependencies): Router {
  const { dataStore, recomputeManager } = deps;
  const graphUpdateService = new GraphUpdateService(dataStore, recomputeManager);
  const router = Router();

  router.get('/', async (_req, res) => {
    try {
      const graphs = await dataStore.listGraphs();
      res.json({ graphs });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get('/latest', async (_req, res) => {
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

  router.get('/:id', async (req, res) => {
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

  router.post('/:id/query', validate(GraphQueryRequestSchema), async (req, res) => {
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

  router.post('/', validate(CreateGraphSchema), async (req, res) => {
    try {
      const graph = await graphUpdateService.createGraph({
        name: req.body.name,
        nodes: req.body.nodes,
        connections: req.body.connections,
        recomputeConcurrency: req.body.recomputeConcurrency,
        executionTimeoutMs: req.body.executionTimeoutMs ?? DEFAULT_GRAPH_EXECUTION_TIMEOUT_MS,
        canvasBackground: req.body.canvasBackground,
        connectionStroke: req.body.connectionStroke,
        projections: req.body.projections,
        activeProjectionId: req.body.activeProjectionId,
        cameras: req.body.cameras,
        pythonEnvs: req.body.pythonEnvs,
        drawings: req.body.drawings,
      });
      res.json(graph);
    } catch (error: unknown) {
      if (error instanceof GraphWriteValidationError) {
        return res.status(400).json({ error: error.message });
      }
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: message });
    }
  });

  router.put('/:id', validate(UpdateGraphSchema), async (req, res) => {
    try {
      const noRecompute = isTruthyQueryFlag(req.query.noRecompute);
      const graph = await graphUpdateService.updateGraph(req.params.id, req.body, { noRecompute });
      res.json(graph);
    } catch (error: unknown) {
      if (error instanceof GraphNotFoundError) {
        return res.status(404).json({ error: 'Graph not found' });
      }
      if (error instanceof GraphConflictError) {
        return res.status(409).json({
          error: error.message,
          currentUpdatedAt: error.currentUpdatedAt,
        });
      }
      if (error instanceof GraphWriteValidationError) {
        return res.status(400).json({ error: error.message });
      }
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: message });
    }
  });

  router.delete('/:id', async (req, res) => {
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

  router.post('/:id/compute', validate(ComputeRequestSchema), async (req, res) => {
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

  router.get('/:id/recompute-status', async (req, res) => {
    try {
      const graph = await dataStore.getGraph(req.params.id);
      if (!graph) {
        return res.status(404).json({ error: 'Graph not found' });
      }

      const status = await recomputeManager.getGraphStatus(graph.id);
      res.json({
        ...status,
        graphUpdatedAt: graph.updatedAt,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}
