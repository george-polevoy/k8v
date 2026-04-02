import { Router } from 'express';
import { z } from 'zod';
import {
  WasmAlgoExecutionError,
  WasmAlgoRequestError,
  WasmAlgoService,
} from '../core/WasmAlgoService.js';
import { DataStore } from '../core/DataStore.js';
import { GraphCommandService, GraphCommandValidationError, GraphRevisionConflictError } from '../core/GraphCommandService.js';
import { GraphEventBroker } from '../core/GraphEventBroker.js';
import {
  createGraphDocument,
  GraphDocumentValidationError,
} from '../core/graphDocumentFactory.js';
import { RecomputeManager } from '../core/RecomputeManager.js';
import {
  executeGraphQuery,
  GraphQueryValidationError,
} from '../core/graphQuery.js';
import { validate } from '../http/validate.js';
import {
  GraphCommandRequest,
  Graph,
  GraphQueryRequest,
  GraphQueryRequestSchema,
} from '../types/index.js';
import { GraphEngine } from '../core/GraphEngine.js';

interface GraphRoutesDependencies {
  dataStore: DataStore;
  recomputeManager: RecomputeManager;
  eventBroker: GraphEventBroker;
  graphEngine: GraphEngine;
}

const CreateGraphSchema = z.object({
  name: z.string().optional().default('Untitled Graph'),
}).strict();

const InvokeWasmAlgoSchema = z.object({
  wasmPath: z.string().trim().min(1),
  entrypoint: z.string().trim().min(1).optional(),
  input: z.unknown().optional(),
  noRecompute: z.boolean().optional(),
}).strict();

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
  const { dataStore, recomputeManager, eventBroker, graphEngine } = deps;
  const graphCommandService = new GraphCommandService(dataStore, recomputeManager, eventBroker);
  const wasmAlgoService = new WasmAlgoService(dataStore, graphCommandService);
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

  router.post('/:id/algo/invoke', validate(InvokeWasmAlgoSchema), async (req, res) => {
    try {
      return res.json(await wasmAlgoService.invokeWasmFile({
        graphId: req.params.id,
        wasmPath: req.body.wasmPath,
        entrypoint: req.body.entrypoint,
        input: req.body.input,
        noRecompute: req.body.noRecompute,
      }));
    } catch (error: unknown) {
      if (error instanceof GraphRevisionConflictError) {
        return res.status(409).json({
          error: error.message,
          currentRevision: error.currentRevision,
        });
      }
      if (error instanceof WasmAlgoRequestError || error instanceof WasmAlgoExecutionError) {
        return res.status(400).json({ error: error.message });
      }
      if (error instanceof Error && /not found/i.test(error.message)) {
        return res.status(404).json({ error: error.message });
      }
      const message = error instanceof Error ? error.message : String(error);
      return res.status(500).json({ error: message });
    }
  });

  router.get('/:id/runtime-state', async (req, res) => {
    try {
      const graph = await dataStore.getGraph(req.params.id);
      if (!graph) {
        return res.status(404).json({ error: 'Graph not found' });
      }

      return res.json(await graphCommandService.buildRuntimeState(graph, {
        sinceCursor: typeof req.query.since === 'string' ? req.query.since : undefined,
      }));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: message });
    }
  });

  router.get('/:id/nodes/:nodeId/result', async (req, res) => {
    try {
      const graph = await dataStore.getGraph(req.params.id);
      if (!graph) {
        return res.status(404).json({ error: 'Graph not found' });
      }

      const result = await dataStore.getResult(
        graph.id,
        req.params.nodeId,
        typeof req.query.version === 'string' ? req.query.version : undefined
      );
      if (!result) {
        return res.status(404).json({ error: 'Result not found' });
      }

      return res.json(result);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: message });
    }
  });

  router.get('/:id/events', async (req, res) => {
    try {
      const graph = await dataStore.getGraph(req.params.id);
      if (!graph) {
        return res.status(404).json({ error: 'Graph not found' });
      }

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders?.();

      const unsubscribe = eventBroker.subscribe(graph.id, (event) => {
        res.write(`event: ${event.type}\n`);
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      });

      const heartbeat = setInterval(() => {
        res.write(': heartbeat\n\n');
      }, 15_000);

      req.on('close', () => {
        clearInterval(heartbeat);
        unsubscribe();
        res.end();
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: message });
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
      const graph = createGraphDocument({
        name: req.body.name,
      });
      await dataStore.storeGraph(graph);
      res.json(graph);
    } catch (error: unknown) {
      if (error instanceof GraphDocumentValidationError) {
        return res.status(400).json({ error: error.message });
      }
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: message });
    }
  });

  router.post('/:id/commands', validate(GraphCommandRequest), async (req, res) => {
    try {
      const noRecompute = isTruthyQueryFlag(req.query.noRecompute);
      const response = await graphCommandService.executeCommands(
        req.params.id,
        req.body.baseRevision,
        req.body.commands,
        {
          noRecompute,
        }
      );
      return res.json(response);
    } catch (error: unknown) {
      if (error instanceof GraphRevisionConflictError) {
        return res.status(409).json({
          error: error.message,
          currentRevision: error.currentRevision,
        });
      }
      if (error instanceof GraphCommandValidationError) {
        return res.status(400).json({ error: error.message });
      }
      if (error instanceof Error && /not found/i.test(error.message)) {
        return res.status(404).json({ error: error.message });
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
      await graphEngine.disposeGraphExecutionResources(req.params.id);
      recomputeManager.dropGraphState(req.params.id);
      res.status(204).send();
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}
