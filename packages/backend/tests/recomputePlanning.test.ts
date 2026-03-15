import test from 'node:test';
import assert from 'node:assert/strict';
import {
  collectStaleNodeIdsFromErrorStates,
  selectNodeIdsForTask,
} from '../src/core/recompute/recomputePlanning.ts';
import type { Graph } from '../src/types/index.ts';

function createGraph(): Graph {
  return {
    id: 'graph-1',
    name: 'Graph 1',
    nodes: [
      {
        id: 'source',
        type: 'numeric_input',
        position: { x: 0, y: 0 },
        metadata: {
          name: 'Source',
          inputs: [],
          outputs: [{ name: 'value', schema: { type: 'number' } }],
        },
        config: {
          type: 'numeric_input',
          config: { value: 1, min: 0, max: 10, step: 1 },
        },
        version: 'source-v1',
      },
      {
        id: 'middle',
        type: 'inline_code',
        position: { x: 120, y: 0 },
        metadata: {
          name: 'Middle',
          inputs: [{ name: 'input', schema: { type: 'number' } }],
          outputs: [{ name: 'value', schema: { type: 'number' } }],
        },
        config: {
          type: 'inline_code',
          code: 'outputs.value = inputs.input;',
          runtime: 'javascript_vm',
          config: { autoRecompute: true },
        },
        version: 'middle-v1',
      },
      {
        id: 'leaf',
        type: 'inline_code',
        position: { x: 240, y: 0 },
        metadata: {
          name: 'Leaf',
          inputs: [{ name: 'input', schema: { type: 'number' } }],
          outputs: [{ name: 'value', schema: { type: 'number' } }],
        },
        config: {
          type: 'inline_code',
          code: 'outputs.value = inputs.input;',
          runtime: 'javascript_vm',
          config: { autoRecompute: false },
        },
        version: 'leaf-v1',
      },
    ],
    connections: [
      {
        id: 'connection-1',
        sourceNodeId: 'source',
        sourcePort: 'value',
        targetNodeId: 'middle',
        targetPort: 'input',
      },
      {
        id: 'connection-2',
        sourceNodeId: 'middle',
        sourcePort: 'value',
        targetNodeId: 'leaf',
        targetPort: 'input',
      },
    ],
    createdAt: 1,
    updatedAt: 1,
  } as Graph;
}

test('selectNodeIdsForTask keeps manual root nodes and auto-recompute descendants in topological order', () => {
  const graph = createGraph();

  const scheduled = selectNodeIdsForTask(graph, 'manual_node', ['source']);

  assert.deepEqual(scheduled, ['source', 'middle']);
});

test('collectStaleNodeIdsFromErrorStates marks downstream descendants of errored nodes', () => {
  const graph = createGraph();
  const stale = collectStaleNodeIdsFromErrorStates(graph, {
    source: {
      isPending: false,
      isComputing: false,
      hasError: true,
      isStale: false,
      errorMessage: 'boom',
      lastRunAt: 1,
    },
  });

  assert.deepEqual([...stale].sort(), ['leaf', 'middle']);
});

