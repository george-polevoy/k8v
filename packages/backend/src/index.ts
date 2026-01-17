import express from 'express';
import cors from 'cors';
import { DataStore } from './core/DataStore.js';
import { GraphEngine } from './core/GraphEngine.js';
import { NodeExecutor } from './core/NodeExecutor.js';
import { Graph, GraphNode, Connection } from './types/index.js';
import { v4 as uuidv4 } from 'uuid';

const app = express();
app.use(cors());
app.use(express.json());

// Initialize services
const dataStore = new DataStore('./k8v.db', './data');
const nodeExecutor = new NodeExecutor(dataStore);
const graphEngine = new GraphEngine(dataStore, nodeExecutor);

// API Routes

// Graph management
app.get('/api/graphs', async (req, res) => {
  try {
    const graphs = await dataStore.listGraphs();
    res.json({ graphs });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/graphs/latest', async (req, res) => {
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

app.post('/api/graphs', async (req, res) => {
  try {
    const graph: Graph = {
      id: uuidv4(),
      name: req.body.name || 'Untitled Graph',
      nodes: req.body.nodes || [],
      connections: req.body.connections || [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await dataStore.storeGraph(graph);
    res.json(graph);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/graphs/:id', async (req, res) => {
  try {
    const existing = await dataStore.getGraph(req.params.id);
    if (!existing) {
      return res.status(404).json({ error: 'Graph not found' });
    }

    const graph: Graph = {
      ...existing,
      ...req.body,
      id: req.params.id,
      updatedAt: Date.now(),
    };

    await dataStore.storeGraph(graph);
    res.json(graph);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Node computation
app.post('/api/graphs/:id/compute', async (req, res) => {
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

// Library nodes
app.get('/api/library-nodes', async (req, res) => {
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

app.post('/api/library-nodes', async (req, res) => {
  try {
    const manifest = {
      id: uuidv4(),
      ...req.body,
      createdAt: Date.now(),
    };

    await dataStore.storeLibraryNode(manifest, req.body.graphId);
    res.json(manifest);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Computation results
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`k8v backend server running on port ${PORT}`);
});
