import express from 'express';
import cors from 'cors';
import { z } from 'zod';
import { DataStore } from './core/DataStore.js';
import { GraphEventBroker } from './core/GraphEventBroker.js';
import { GraphEngine } from './core/GraphEngine.js';
import { NodeExecutor } from './core/NodeExecutor.js';
import { RecomputeManager } from './core/RecomputeManager.js';
import { createGraphRouter } from './routes/graphRoutes.js';

interface AppDependencies {
  dataStore: DataStore;
  graphEngine: GraphEngine;
}

const JSON_BODY_LIMIT = '10mb';

const GraphicsBinaryQuerySchema = z.object({
  maxPixels: z.coerce.number().int().positive().optional(),
});

export function createApp(deps?: AppDependencies) {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: JSON_BODY_LIMIT }));

  const dataStore = deps?.dataStore ?? new DataStore();
  const graphEngine =
    deps?.graphEngine ?? new GraphEngine(dataStore, new NodeExecutor(dataStore));
  const eventBroker = new GraphEventBroker();
  const recomputeManager = new RecomputeManager(dataStore, graphEngine, eventBroker);
  app.use('/api/graphs', createGraphRouter({ dataStore, recomputeManager, eventBroker }));

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
