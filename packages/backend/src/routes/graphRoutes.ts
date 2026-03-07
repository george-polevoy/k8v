import { Router } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { DataStore } from '../core/DataStore.js';
import { RecomputeManager } from '../core/RecomputeManager.js';
import {
  executeGraphQuery,
  GRAPH_QUERY_CONNECTION_FIELDS,
  GRAPH_QUERY_NODE_FIELDS,
  GraphQueryValidationError,
  type GraphQueryRequest,
} from '../core/graphQuery.js';
import {
  normalizeConnectionStrokeValue,
  normalizeGraphProjections,
} from '../core/graphNormalization.js';
import { validateGraphStructure } from '../core/graphValidation.js';
import { validate } from '../http/validate.js';
import {
  CanvasBackground,
  Connection,
  DEFAULT_CANVAS_BACKGROUND,
  DEFAULT_GRAPH_EXECUTION_TIMEOUT_MS,
  Graph,
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

export function createGraphRouter(deps: GraphRoutesDependencies): Router {
  const { dataStore, recomputeManager } = deps;
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

  router.put('/:id', validate(UpdateGraphSchema), async (req, res) => {
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
      res.json(status);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}
