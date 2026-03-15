import test from 'node:test';
import assert from 'node:assert/strict';
import { BULK_EDIT_OPERATION_SCHEMA, applyBulkEditOperation } from '../src/graphEdits.ts';

function createGraph() {
  return {
    id: 'graph-1',
    name: 'Graph 1',
    nodes: [
      {
        id: 'node-1',
        type: 'inline_code',
        position: { x: 0, y: 0 },
        metadata: {
          name: 'Node 1',
          inputs: [{ name: 'input', schema: { type: 'number' } }],
          outputs: [{ name: 'output', schema: { type: 'number' } }],
        },
        config: {
          type: 'inline_code',
          code: 'outputs.output = inputs.input;',
          runtime: 'javascript_vm',
        },
        version: 'node-1-v1',
      },
      {
        id: 'node-2',
        type: 'inline_code',
        position: { x: 120, y: 0 },
        metadata: {
          name: 'Node 2',
          inputs: [{ name: 'input', schema: { type: 'number' } }],
          outputs: [{ name: 'output', schema: { type: 'number' } }],
        },
        config: {
          type: 'inline_code',
          code: 'outputs.output = inputs.input;',
          runtime: 'javascript_vm',
        },
        version: 'node-2-v1',
      },
    ],
    connections: [],
    projections: [],
    activeProjectionId: undefined,
    canvasBackground: undefined,
    pythonEnvs: [],
    drawings: [],
    createdAt: 1,
    updatedAt: 1,
  };
}

test('BULK_EDIT_OPERATION_SCHEMA accepts operations from each bulk-edit domain', () => {
  assert.equal(BULK_EDIT_OPERATION_SCHEMA.parse({ op: 'graph_set_name', name: 'Renamed' }).op, 'graph_set_name');
  assert.equal(BULK_EDIT_OPERATION_SCHEMA.parse({ op: 'drawing_create', x: 1, y: 2 }).op, 'drawing_create');
  assert.equal(BULK_EDIT_OPERATION_SCHEMA.parse({ op: 'node_set_name', nodeId: 'node-1', name: 'Node A' }).op, 'node_set_name');
  assert.equal(
    BULK_EDIT_OPERATION_SCHEMA.parse({
      op: 'connection_add',
      sourceNodeId: 'node-1',
      sourcePort: 'output',
      targetNodeId: 'node-2',
      targetPort: 'input',
    }).op,
    'connection_add'
  );
});

test('applyBulkEditOperation dispatches to composed handlers across graph, drawing, node, and connection domains', () => {
  const graph = createGraph();

  const renamed = applyBulkEditOperation(graph, { op: 'graph_set_name', name: 'Renamed' });
  assert.equal(renamed.graph.name, 'Renamed');

  const withDrawing = applyBulkEditOperation(renamed.graph, { op: 'drawing_create', name: 'Sketch', x: 10, y: 20 });
  assert.equal(withDrawing.graph.drawings?.[0]?.name, 'Sketch');

  const renamedNode = applyBulkEditOperation(withDrawing.graph, { op: 'node_set_name', nodeId: 'node-1', name: 'Source' });
  assert.equal(renamedNode.graph.nodes[0].metadata.name, 'Source');

  const connected = applyBulkEditOperation(renamedNode.graph, {
    op: 'connection_add',
    sourceNodeId: 'node-1',
    sourcePort: 'output',
    targetNodeId: 'node-2',
    targetPort: 'input',
  });
  assert.equal(connected.graph.connections.length, 1);
});
