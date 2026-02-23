import assert from 'node:assert/strict';
import test from 'node:test';
import { BULK_EDIT_OPERATION_SCHEMA, applyBulkEditOperation } from '../src/index.ts';

function createEmptyGraph() {
  const now = Date.now();
  return {
    id: 'graph-1',
    name: 'Graph 1',
    nodes: [] as Array<any>,
    connections: [] as Array<any>,
    createdAt: now,
    updatedAt: now,
  };
}

test('bulk_edit schema accepts node_add_numeric_input operations', () => {
  const parsed = BULK_EDIT_OPERATION_SCHEMA.parse({
    op: 'node_add_numeric_input',
    x: 120,
    y: -32,
    value: 2.5,
    min: 0,
    max: 10,
    step: 0.5,
  });

  assert.equal(parsed.op, 'node_add_numeric_input');
});

test('applyBulkEditOperation adds numeric_input node with normalized config', () => {
  const graph = createEmptyGraph();
  const result = applyBulkEditOperation(graph, {
    op: 'node_add_numeric_input',
    name: 'Slider A',
    x: 48,
    y: 96,
    value: 12,
    min: 3,
    max: 1,
    step: -2,
    autoRecompute: true,
  });

  assert.equal(result.graph.nodes.length, 1);
  const node = result.graph.nodes[0];
  assert.equal(node.type, 'numeric_input');
  assert.equal(node.metadata.name, 'Slider A');
  assert.deepEqual(node.metadata.inputs, []);
  assert.deepEqual(node.metadata.outputs, [{ name: 'value', schema: { type: 'number' } }]);
  assert.deepEqual(node.position, { x: 48, y: 96 });

  const numericConfig = (node.config.config ?? {}) as Record<string, unknown>;
  assert.equal(numericConfig.value, 3);
  assert.equal(numericConfig.min, 3);
  assert.equal(numericConfig.max, 3);
  assert.equal(numericConfig.step, 1);
  assert.equal(numericConfig.autoRecompute, true);
  assert.equal(result.details?.nodeId, node.id);
});

test('applyBulkEditOperation rejects duplicate numeric_input node ids', () => {
  const graph = createEmptyGraph();
  graph.nodes.push({
    id: 'node-1',
    type: 'numeric_input',
    position: { x: 0, y: 0 },
    metadata: {
      name: 'Existing Slider',
      inputs: [],
      outputs: [{ name: 'value', schema: { type: 'number' } }],
    },
    config: {
      type: 'numeric_input',
      config: {
        value: 0,
        min: 0,
        max: 100,
        step: 1,
      },
    },
    version: '1',
  });

  assert.throws(
    () => applyBulkEditOperation(graph, {
      op: 'node_add_numeric_input',
      nodeId: 'node-1',
      x: 10,
      y: 20,
    }),
    /already exists/
  );
});
