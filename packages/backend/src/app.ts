import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { z } from 'zod';
import { DataStore } from './core/DataStore.js';
import { GraphEngine } from './core/GraphEngine.js';
import { NodeExecutor } from './core/NodeExecutor.js';
import { Connection, Graph, GraphDrawing, GraphNode, PythonEnvironment } from './types/index.js';
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
  pythonEnvs: z.array(PythonEnvironment).optional().default([]),
  drawings: z.array(GraphDrawing).optional().default([]),
});

const UpdateGraphSchema = z.object({
  name: z.string().optional(),
  nodes: z.array(GraphNode).optional(),
  connections: z.array(Connection).optional(),
  pythonEnvs: z.array(PythonEnvironment).optional(),
  drawings: z.array(GraphDrawing).optional(),
});

const ComputeRequestSchema = z.object({
  nodeId: z.string().optional(),
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

function validateGraphStructure(graph: Graph): string | null {
  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  const drawingIds = new Set<string>();
  const pythonEnvNames = new Set<string>();

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
      const graph: Graph = {
        id: uuidv4(),
        name: req.body.name,
        nodes: req.body.nodes,
        connections: req.body.connections,
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

      const graph: Graph = {
        ...existing,
        ...req.body,
        id: req.params.id,
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

  return app;
}
