import assert from 'node:assert/strict';
import test from 'node:test';
import { duplicateNodeSelectionInGraph } from '../src/utils/selectionDuplication.ts';
import { NodeType, createInlineCodeNode, type Graph, type GraphNode, type Position } from '../src/types.ts';

test('duplicating inline nodes preserves and independently clones input values, editor settings and date format', () => {
  const node = createInlineCodeNode({ nodeId: 'typed', position: { x: 0, y: 0 } });
  node.metadata.inputs = [
    { name: 'amount', schema: { type: 'number' }, defaultValue: 0, editor: { min: 0, max: 10, step: 0.1 } },
    { name: 'flag', schema: { type: 'boolean' }, defaultValue: false },
    { name: 'date', schema: { type: 'string', format: 'date-time' }, defaultValue: '2026-11-02T12:00:00Z' },
  ];
  const graph: Graph = { id: 'typed-graph', name: 'autotests_duplicate_inputs', revision: 0, nodes: [node], connections: [], pythonEnvs: [], drawings: [], createdAt: 0, updatedAt: 0 };
  const result = duplicateNodeSelectionInGraph({ graph, selectedNodeIds: [node.id], createId: () => 'copy' });
  const copy = result.graph.nodes.find((entry) => entry.id === 'copy')!;
  assert.deepEqual(copy.metadata.inputs, node.metadata.inputs);
  copy.metadata.inputs[0].editor!.max = 20;
  copy.metadata.inputs[2].schema.format = undefined;
  assert.equal(node.metadata.inputs[0].editor!.max, 10);
  assert.equal(node.metadata.inputs[2].schema.format, 'date-time');
});

function makeNode(
  id: string,
  name: string,
  position: Position,
  cardSize?: { width: number; height: number }
): GraphNode {
  return {
    id,
    type: NodeType.NUMERIC_INPUT,
    position,
    metadata: {
      name,
      inputs: [],
      outputs: [{ name: 'value', schema: { type: 'number' } }],
      custom: {
        sourceId: id,
        nested: {
          label: name,
        },
      },
    },
    config: {
      value: 0,
      min: 0,
      max: 100,
      step: 1,
      dragDebounceSeconds: 0.1,
      ...(cardSize ? { cardWidth: cardSize.width, cardHeight: cardSize.height } : {}),
    },
    version: `version-${id}`,
    lastComputed: 123,
  };
}

test('duplicateNodeSelectionInGraph clones selected nodes, internal connections, and projection state', () => {
  const graph: Graph = {
    id: 'graph-1',
    name: 'Selection Duplication',
    nodes: [
      makeNode('node-a', 'Node A', { x: 10, y: 20 }, { width: 240, height: 96 }),
      makeNode('node-b', 'Node B', { x: 120, y: 180 }, { width: 260, height: 110 }),
      makeNode('node-c', 'Node C', { x: 420, y: 180 }),
    ],
    connections: [
      {
        id: 'connection-ab',
        sourceNodeId: 'node-a',
        sourcePort: 'value',
        sourceAnchor: { side: 'right', offset: 0.5 },
        targetNodeId: 'node-b',
        targetPort: 'value',
        targetAnchor: { side: 'left', offset: 0.25 },
      },
      {
        id: 'connection-bc',
        sourceNodeId: 'node-b',
        sourcePort: 'value',
        targetNodeId: 'node-c',
        targetPort: 'value',
      },
    ],
    projections: [
      {
        id: 'default',
        name: 'Default',
        nodePositions: {
          'node-a': { x: 10, y: 20 },
          'node-b': { x: 120, y: 180 },
          'node-c': { x: 420, y: 180 },
        },
        nodeCardSizes: {
          'node-a': { width: 240, height: 96 },
          'node-b': { width: 260, height: 110 },
          'node-c': { width: 220, height: 80 },
        },
      },
      {
        id: 'presentation',
        name: 'Presentation',
        nodePositions: {
          'node-a': { x: 30, y: 40 },
          'node-b': { x: 190, y: 220 },
          'node-c': { x: 520, y: 220 },
        },
        nodeCardSizes: {
          'node-a': { width: 280, height: 120 },
          'node-b': { width: 300, height: 132 },
          'node-c': { width: 240, height: 88 },
        },
      },
    ],
    activeProjectionId: 'presentation',
    drawings: [],
    createdAt: 1,
    updatedAt: 2,
  };

  const nextIdValues = ['node-a-copy', 'node-b-copy', 'connection-copy'];
  let nextIdIndex = 0;
  const duplicateResult = duplicateNodeSelectionInGraph({
    graph,
    selectedNodeIds: ['node-a', 'node-b'],
    duplicatedNodePositions: new Map([
      ['node-a', { x: 210, y: 260 }],
      ['node-b', { x: 370, y: 440 }],
    ]),
    createId: () => {
      const nextValue = nextIdValues[nextIdIndex];
      nextIdIndex += 1;
      assert.ok(nextValue, 'expected deterministic duplicate id');
      return nextValue;
    },
    now: () => 9_876,
  });

  assert.deepEqual(duplicateResult.duplicatedNodeIds, ['node-a-copy', 'node-b-copy']);
  assert.deepEqual(
    Array.from(duplicateResult.sourceToDuplicateNodeId.entries()),
    [
      ['node-a', 'node-a-copy'],
      ['node-b', 'node-b-copy'],
    ]
  );
  assert.equal(graph.nodes.length, 3, 'source graph should remain unchanged');
  assert.equal(graph.connections.length, 2, 'source graph connections should remain unchanged');

  const duplicatedNodeA = duplicateResult.graph.nodes.find((node) => node.id === 'node-a-copy');
  const duplicatedNodeB = duplicateResult.graph.nodes.find((node) => node.id === 'node-b-copy');
  assert.ok(duplicatedNodeA, 'duplicated node A should exist');
  assert.ok(duplicatedNodeB, 'duplicated node B should exist');
  assert.deepEqual(duplicatedNodeA.position, { x: 210, y: 260 });
  assert.deepEqual(duplicatedNodeB.position, { x: 370, y: 440 });
  assert.equal(duplicatedNodeA.lastComputed, undefined, 'duplicates should not keep stale compute timestamps');
  assert.equal(duplicatedNodeA.version, '9876-0');
  assert.equal(duplicatedNodeB.version, '9876-1');
  assert.notEqual(duplicatedNodeA.metadata, graph.nodes[0].metadata, 'metadata should be cloned');
  assert.notEqual(duplicatedNodeA.metadata.custom, graph.nodes[0].metadata.custom, 'custom metadata should be cloned');
  assert.notEqual(duplicatedNodeA.config, graph.nodes[0].config, 'config should be cloned');
  assert.deepEqual(duplicatedNodeA.metadata.custom, {
    sourceId: 'node-a',
    nested: {
      label: 'Node A',
    },
  });

  assert.equal(duplicateResult.graph.connections.length, 3);
  const duplicatedConnection = duplicateResult.graph.connections.find((connection) => connection.id === 'connection-copy');
  assert.deepEqual(duplicatedConnection, {
    id: 'connection-copy',
    sourceNodeId: 'node-a-copy',
    sourcePort: 'value',
    sourceAnchor: { side: 'right', offset: 0.5 },
    targetNodeId: 'node-b-copy',
    targetPort: 'value',
    targetAnchor: { side: 'left', offset: 0.25 },
  });
  assert.ok(
    !duplicateResult.graph.connections.some(
      (connection) => connection.sourceNodeId === 'node-b-copy' && connection.targetNodeId === 'node-c'
    ),
    'connections to non-selected nodes should not be duplicated'
  );

  const defaultProjection = duplicateResult.graph.projections?.find((projection) => projection.id === 'default');
  const presentationProjection = duplicateResult.graph.projections?.find(
    (projection) => projection.id === 'presentation'
  );
  assert.deepEqual(defaultProjection?.nodePositions['node-a-copy'], { x: 10, y: 20 });
  assert.deepEqual(defaultProjection?.nodePositions['node-b-copy'], { x: 120, y: 180 });
  assert.deepEqual(defaultProjection?.nodeCardSizes['node-a-copy'], { width: 240, height: 96 });
  assert.deepEqual(defaultProjection?.nodeCardSizes['node-b-copy'], { width: 260, height: 110 });
  assert.deepEqual(presentationProjection?.nodePositions['node-a-copy'], { x: 210, y: 260 });
  assert.deepEqual(presentationProjection?.nodePositions['node-b-copy'], { x: 370, y: 440 });
  assert.deepEqual(presentationProjection?.nodeCardSizes['node-a-copy'], { width: 280, height: 120 });
  assert.deepEqual(presentationProjection?.nodeCardSizes['node-b-copy'], { width: 300, height: 132 });
  assert.equal(duplicateResult.graph.updatedAt, 9_876);
});
