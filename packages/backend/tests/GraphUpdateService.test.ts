import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GraphUpdateService,
  GraphWriteValidationError,
} from '../src/core/GraphUpdateService.ts';
import type { Graph } from '../src/types/index.ts';

function createGraph(): Graph {
  return {
    id: 'graph-1',
    name: 'Graph 1',
    nodes: [
      {
        id: 'source',
        type: 'inline_code',
        position: { x: 0, y: 0 },
        metadata: {
          name: 'Source',
          inputs: [],
          outputs: [{ name: 'value', schema: { type: 'number' } }],
        },
        config: {
          type: 'inline_code',
          code: 'outputs.value = 1;',
          runtime: 'javascript_vm',
        },
        version: 'source-v1',
      },
      {
        id: 'target',
        type: 'inline_code',
        position: { x: 120, y: 0 },
        metadata: {
          name: 'Target',
          inputs: [{ name: 'input', schema: { type: 'number' } }],
          outputs: [{ name: 'value', schema: { type: 'number' } }],
        },
        config: {
          type: 'inline_code',
          code: 'outputs.value = inputs.input;',
          runtime: 'javascript_vm',
          config: { autoRecompute: true },
        },
        version: 'target-v1',
      },
    ],
    connections: [],
    recomputeConcurrency: 1,
    executionTimeoutMs: 30_000,
    canvasBackground: {
      mode: 'gradient',
      baseColor: '#1d437e',
    },
    connectionStroke: {
      foregroundColor: '#334155',
      backgroundColor: '#cbd5e1',
      foregroundWidth: 1,
      backgroundWidth: 2,
    },
    projections: [
      {
        id: 'default',
        name: 'Default',
        nodePositions: {},
        nodeCardSizes: {},
        canvasBackground: {
          mode: 'gradient',
          baseColor: '#1d437e',
        },
      },
    ],
    activeProjectionId: 'default',
    cameras: [
      {
        id: 'default-camera',
        name: 'Default Camera',
        floatingWindows: {},
      },
    ],
    pythonEnvs: [],
    drawings: [],
    createdAt: 1,
    updatedAt: 2,
  };
}

test('GraphUpdateService bumps inbound target versions and queues recompute on graph updates', async () => {
  const existing = createGraph();
  const storedGraphs: Graph[] = [];
  const queuedUpdates: Array<{ previous: Graph; next: Graph }> = [];
  const dataStore = {
    getGraph: async () => existing,
    storeGraph: async (graph: Graph) => {
      storedGraphs.push(graph);
    },
  } as any;
  const recomputeManager = {
    queueGraphUpdateRecompute: (previous: Graph, next: Graph) => {
      queuedUpdates.push({ previous, next });
    },
  } as any;
  const service = new GraphUpdateService(dataStore, recomputeManager);

  const result = await service.updateGraph(existing.id, {
    connections: [
      {
        id: 'connection-1',
        sourceNodeId: 'source',
        sourcePort: 'value',
        targetNodeId: 'target',
        targetPort: 'input',
      },
    ],
  });

  assert.equal(storedGraphs.length, 1);
  assert.equal(queuedUpdates.length, 1);
  assert.equal(queuedUpdates[0].previous, existing);
  assert.equal(queuedUpdates[0].next, result);
  assert.match(result.nodes.find((node) => node.id === 'target')?.version ?? '', /^\d+-target$/);
  assert.equal(result.nodes.find((node) => node.id === 'source')?.version, 'source-v1');
});

test('GraphUpdateService rejects updates that remove all projections', async () => {
  const existing = createGraph();
  const service = new GraphUpdateService(
    {
      getGraph: async () => existing,
      storeGraph: async () => undefined,
    } as any,
    {
      queueGraphUpdateRecompute: () => undefined,
    } as any
  );

  await assert.rejects(
    () => service.updateGraph(existing.id, { projections: [] }),
    GraphWriteValidationError
  );
});

