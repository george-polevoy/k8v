import assert from 'node:assert/strict';
import test from 'node:test';
import { BULK_EDIT_OPERATION_SCHEMA, applyBulkEditOperation, filterConnections } from '../src/index.ts';

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

function createNode(params: {
  id: string;
  inputs?: string[];
  outputs?: string[];
  name?: string;
}) {
  return {
    id: params.id,
    type: 'inline_code',
    position: { x: 0, y: 0 },
    metadata: {
      name: params.name ?? params.id,
      inputs: (params.inputs ?? []).map((name) => ({ name, schema: { type: 'number' } })),
      outputs: (params.outputs ?? []).map((name) => ({ name, schema: { type: 'number' } })),
    },
    config: {
      type: 'inline_code',
      code: 'outputs.output = 1;',
      runtime: 'javascript_vm',
    },
    version: `${params.id}-v1`,
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

test('bulk_edit schema accepts connection_set operations', () => {
  const parsed = BULK_EDIT_OPERATION_SCHEMA.parse({
    op: 'connection_set',
    sourceNodeId: 'source',
    sourcePort: 'value',
    targetNodeId: 'target',
    targetPort: 'input',
  });

  assert.equal(parsed.op, 'connection_set');
});

test('bulk_edit schema accepts node_set_code outputNames', () => {
  const parsed = BULK_EDIT_OPERATION_SCHEMA.parse({
    op: 'node_set_code',
    nodeId: 'source',
    code: 'outputs.status = 1;',
    outputNames: ['status', 'diskFreeLanes'],
  });

  assert.equal(parsed.op, 'node_set_code');
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

test('applyBulkEditOperation graph_projection_add preserves oversized fallback node card dimensions', () => {
  const graph = createEmptyGraph();
  graph.nodes.push({
    id: 'node-inline',
    type: 'inline_code',
    position: { x: 0, y: 0 },
    metadata: {
      name: 'Inline',
      inputs: [],
      outputs: [{ name: 'output', schema: { type: 'number' } }],
    },
    config: {
      type: 'inline_code',
      code: 'outputs.output = 1;',
      runtime: 'javascript_vm',
      config: {
        cardWidth: 20_000,
        cardHeight: 20_000,
      },
    },
    version: '1',
  });

  const result = applyBulkEditOperation(graph, {
    op: 'graph_projection_add',
    projectionId: 'alt',
    activate: false,
  });

  const defaultProjection = result.graph.projections?.find((projection: any) => projection.id === 'default');
  const altProjection = result.graph.projections?.find((projection: any) => projection.id === 'alt');
  assert.ok(defaultProjection);
  assert.ok(altProjection);
  assert.equal(defaultProjection.nodeCardSizes['node-inline'].width, 20_000);
  assert.equal(defaultProjection.nodeCardSizes['node-inline'].height, 20_000);
  assert.equal(altProjection.nodeCardSizes['node-inline'].width, 20_000);
  assert.equal(altProjection.nodeCardSizes['node-inline'].height, 20_000);
  assert.equal(result.graph.nodes[0].config.config.cardWidth, 20_000);
  assert.equal(result.graph.nodes[0].config.config.cardHeight, 20_000);
});

test('applyBulkEditOperation connection_set replaces inbound target-input wiring atomically', () => {
  const graph = createEmptyGraph();
  graph.nodes.push(createNode({ id: 'source-a', outputs: ['value'] }));
  graph.nodes.push(createNode({ id: 'source-b', outputs: ['value'] }));
  graph.nodes.push(createNode({ id: 'target', inputs: ['input'] }));
  graph.nodes.push(createNode({ id: 'other-target', inputs: ['input'] }));
  graph.connections.push(
    {
      id: 'conn-target-old',
      sourceNodeId: 'source-a',
      sourcePort: 'value',
      targetNodeId: 'target',
      targetPort: 'input',
    },
    {
      id: 'conn-other',
      sourceNodeId: 'source-a',
      sourcePort: 'value',
      targetNodeId: 'other-target',
      targetPort: 'input',
    }
  );

  const result = applyBulkEditOperation(graph, {
    op: 'connection_set',
    sourceNodeId: 'source-b',
    sourcePort: 'value',
    targetNodeId: 'target',
    targetPort: 'input',
    connectionId: 'conn-target-new',
  });

  const targetInbound = result.graph.connections.filter(
    (connection) => connection.targetNodeId === 'target' && connection.targetPort === 'input'
  );
  assert.equal(targetInbound.length, 1);
  assert.equal(targetInbound[0].id, 'conn-target-new');
  assert.equal(targetInbound[0].sourceNodeId, 'source-b');
  assert.equal(targetInbound[0].sourcePort, 'value');

  const otherInbound = result.graph.connections.find((connection) => connection.id === 'conn-other');
  assert.ok(otherInbound);
  assert.equal(result.details?.replacedConnectionIds?.includes('conn-target-old'), true);
});

test('applyBulkEditOperation connection_set keeps matching connection id while deduplicating inbound edges', () => {
  const graph = createEmptyGraph();
  graph.nodes.push(createNode({ id: 'source-a', outputs: ['value'] }));
  graph.nodes.push(createNode({ id: 'source-b', outputs: ['value'] }));
  graph.nodes.push(createNode({ id: 'target', inputs: ['input'] }));
  graph.connections.push(
    {
      id: 'conn-keep',
      sourceNodeId: 'source-b',
      sourcePort: 'value',
      targetNodeId: 'target',
      targetPort: 'input',
    },
    {
      id: 'conn-drop',
      sourceNodeId: 'source-a',
      sourcePort: 'value',
      targetNodeId: 'target',
      targetPort: 'input',
    }
  );

  const result = applyBulkEditOperation(graph, {
    op: 'connection_set',
    sourceNodeId: 'source-b',
    sourcePort: 'value',
    targetNodeId: 'target',
    targetPort: 'input',
  });

  const targetInbound = result.graph.connections.filter(
    (connection) => connection.targetNodeId === 'target' && connection.targetPort === 'input'
  );
  assert.equal(targetInbound.length, 1);
  assert.equal(targetInbound[0].id, 'conn-keep');
  assert.equal(result.details?.replacedConnectionIds?.includes('conn-drop'), true);
});

test('applyBulkEditOperation node_set_code infers output ports from updated code', () => {
  const graph = createEmptyGraph();
  graph.nodes.push(createNode({ id: 'source', outputs: ['output'] }));

  const result = applyBulkEditOperation(graph, {
    op: 'node_set_code',
    nodeId: 'source',
    code: 'outputs.status = 1;',
  });

  const updatedSource = result.graph.nodes.find((node) => node.id === 'source');
  assert.ok(updatedSource, 'updated source node should exist');
  assert.equal(updatedSource.config.code, 'outputs.status = 1;');
  assert.deepEqual(updatedSource.metadata.outputs, [{ name: 'status', schema: { type: 'object' } }]);
});

test('applyBulkEditOperation node_set_code preserves connected legacy output ports', () => {
  const graph = createEmptyGraph();
  graph.nodes.push(createNode({ id: 'source', outputs: ['output', 'legacy'] }));
  graph.nodes.push(createNode({ id: 'target', inputs: ['input'] }));
  graph.connections.push({
    id: 'conn-legacy',
    sourceNodeId: 'source',
    sourcePort: 'legacy',
    targetNodeId: 'target',
    targetPort: 'input',
  });

  const result = applyBulkEditOperation(graph, {
    op: 'node_set_code',
    nodeId: 'source',
    code: 'outputs.status = 1;',
  });

  const updatedSource = result.graph.nodes.find((node) => node.id === 'source');
  assert.ok(updatedSource, 'updated source node should exist');
  assert.deepEqual(updatedSource.metadata.outputs, [
    { name: 'status', schema: { type: 'object' } },
    { name: 'legacy', schema: { type: 'number' } },
  ]);
  assert.equal(
    result.graph.connections.some((connection) => connection.id === 'conn-legacy'),
    true
  );
});

test('applyBulkEditOperation node_set_code accepts explicit outputNames for delegated code', () => {
  const graph = createEmptyGraph();
  graph.nodes.push(createNode({ id: 'source', outputs: ['output'] }));

  const result = applyBulkEditOperation(graph, {
    op: 'node_set_code',
    nodeId: 'source',
    code: 'from node_lib.worker_query import worker_query_node; worker_query_node(inputs, outputs, outputPng)',
    outputNames: ['times', 'diskFreeLanes', 'diskRows', 'status'],
  });

  const updatedSource = result.graph.nodes.find((node) => node.id === 'source');
  assert.ok(updatedSource, 'updated source node should exist');
  assert.deepEqual(
    updatedSource.metadata.outputs.map((output) => output.name),
    ['times', 'diskFreeLanes', 'diskRows', 'status']
  );
});

test('applyBulkEditOperation node_set_code explicit outputNames keep connected legacy ports', () => {
  const graph = createEmptyGraph();
  graph.nodes.push(createNode({ id: 'source', outputs: ['legacy'] }));
  graph.nodes.push(createNode({ id: 'target', inputs: ['input'] }));
  graph.connections.push({
    id: 'conn-legacy',
    sourceNodeId: 'source',
    sourcePort: 'legacy',
    targetNodeId: 'target',
    targetPort: 'input',
  });

  const result = applyBulkEditOperation(graph, {
    op: 'node_set_code',
    nodeId: 'source',
    code: 'outputs.status = 1;',
    outputNames: ['status'],
  });

  const updatedSource = result.graph.nodes.find((node) => node.id === 'source');
  assert.ok(updatedSource, 'updated source node should exist');
  assert.deepEqual(
    updatedSource.metadata.outputs.map((output) => output.name),
    ['status', 'legacy']
  );
});

test('filterConnections narrows by node and target port', () => {
  const graph = createEmptyGraph();
  graph.connections.push(
    {
      id: 'ab',
      sourceNodeId: 'a',
      sourcePort: 'out',
      targetNodeId: 'b',
      targetPort: 'in',
    },
    {
      id: 'cb',
      sourceNodeId: 'c',
      sourcePort: 'out',
      targetNodeId: 'b',
      targetPort: 'other',
    },
    {
      id: 'bd',
      sourceNodeId: 'b',
      sourcePort: 'out',
      targetNodeId: 'd',
      targetPort: 'in',
    }
  );

  const byNodeAndTarget = filterConnections(graph.connections, { nodeId: 'b', targetPort: 'in' });
  assert.deepEqual(byNodeAndTarget.map((connection) => connection.id).sort(), ['ab', 'bd']);
});
