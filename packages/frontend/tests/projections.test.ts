import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyProjectionToNodes,
  cloneProjectionNodePositions,
  DEFAULT_GRAPH_PROJECTION_ID,
  NodeType,
  normalizeGraphProjectionState,
  syncActiveProjectionLayout,
} from '../src/types.ts';

function makeNode(id: string, x: number, y: number) {
  return {
    id,
    type: NodeType.INLINE_CODE,
    position: { x, y },
    metadata: {
      name: id,
      inputs: [],
      outputs: [],
    },
    config: {
      code: 'outputs.output = 1;',
      runtime: 'javascript_vm',
    },
    version: `${id}-v1`,
  };
}

test('cloneProjectionNodePositions prefers source projection coordinates and falls back to node positions', () => {
  const nodes = [makeNode('node-a', 10, 20), makeNode('node-b', 30, 40)];
  const cloned = cloneProjectionNodePositions(nodes, {
    id: 'source',
    name: 'Source',
    nodePositions: {
      'node-a': { x: 110, y: 220 },
    },
    nodeCardSizes: {
      'node-a': { width: 220, height: 120 },
      'node-b': { width: 220, height: 120 },
    },
    canvasBackground: {
      mode: 'gradient',
      baseColor: '#1d437e',
    },
  });

  assert.deepEqual(cloned['node-a'], { x: 110, y: 220 });
  assert.deepEqual(cloned['node-b'], { x: 30, y: 40 });
});

test('normalizeGraphProjectionState ensures default projection and valid active projection id', () => {
  const nodes = [makeNode('node-a', 1, 2)];
  const projectionState = normalizeGraphProjectionState(nodes, [], 'missing');

  assert.equal(projectionState.projections.length, 1);
  assert.equal(projectionState.projections[0].id, DEFAULT_GRAPH_PROJECTION_ID);
  assert.equal(projectionState.activeProjectionId, DEFAULT_GRAPH_PROJECTION_ID);
  assert.deepEqual(projectionState.projections[0].nodePositions['node-a'], { x: 1, y: 2 });
  assert.ok(projectionState.projections[0].nodeCardSizes['node-a'].width > 0);
  assert.ok(projectionState.projections[0].nodeCardSizes['node-a'].height > 0);
  assert.deepEqual(projectionState.projections[0].canvasBackground, {
    mode: 'gradient',
    baseColor: '#1d437e',
  });
});

test('normalizeGraphProjectionState preserves oversized fallback node card dimensions', () => {
  const node = makeNode('node-a', 1, 2);
  node.config = {
    ...node.config,
    cardWidth: 20_000,
    cardHeight: 20_000,
  };

  const projectionState = normalizeGraphProjectionState([node], [], 'default');
  assert.equal(projectionState.projections[0].nodeCardSizes['node-a'].width, 20_000);
  assert.equal(projectionState.projections[0].nodeCardSizes['node-a'].height, 20_000);
});

test('applyProjectionToNodes updates node positions using projection coordinates', () => {
  const nodes = [makeNode('node-a', 1, 2), makeNode('node-b', 3, 4)];
  const projected = applyProjectionToNodes(nodes, {
    id: 'alt',
    name: 'Alt',
    nodePositions: {
      'node-a': { x: 101, y: 202 },
      'node-b': { x: 303, y: 404 },
    },
    nodeCardSizes: {
      'node-a': { width: 240, height: 140 },
      'node-b': { width: 260, height: 160 },
    },
    canvasBackground: {
      mode: 'solid',
      baseColor: '#204060',
    },
  });

  assert.deepEqual(projected.map((node) => node.position), [
    { x: 101, y: 202 },
    { x: 303, y: 404 },
  ]);
  assert.equal(projected[0].config.cardWidth, 240);
  assert.equal(projected[0].config.cardHeight, 140);
  assert.equal(projected[1].config.cardWidth, 260);
  assert.equal(projected[1].config.cardHeight, 160);
});

test('syncActiveProjectionLayout updates only the active projection from current node layout', () => {
  const nodes = [makeNode('node-a', 111, 222), makeNode('node-b', 333, 444)];
  nodes[0].config = { ...nodes[0].config, cardWidth: 260, cardHeight: 180 };
  nodes[1].config = { ...nodes[1].config, cardWidth: 300, cardHeight: 210 };

  const synced = syncActiveProjectionLayout([
    {
      id: 'default',
      name: 'Default',
      nodePositions: {
        'node-a': { x: 10, y: 20 },
        'node-b': { x: 30, y: 40 },
      },
      nodeCardSizes: {
        'node-a': { width: 220, height: 120 },
        'node-b': { width: 240, height: 140 },
      },
      canvasBackground: { mode: 'gradient', baseColor: '#1d437e' },
    },
    {
      id: 'alt',
      name: 'Alt',
      nodePositions: {
        'node-a': { x: 50, y: 60 },
        'node-b': { x: 70, y: 80 },
      },
      nodeCardSizes: {
        'node-a': { width: 200, height: 100 },
        'node-b': { width: 220, height: 120 },
      },
      canvasBackground: { mode: 'solid', baseColor: '#204060' },
    },
  ], nodes, 'alt');

  assert.ok(synced);
  assert.deepEqual(synced?.find((projection) => projection.id === 'default')?.nodePositions, {
    'node-a': { x: 10, y: 20 },
    'node-b': { x: 30, y: 40 },
  });
  assert.deepEqual(synced?.find((projection) => projection.id === 'alt')?.nodePositions, {
    'node-a': { x: 111, y: 222 },
    'node-b': { x: 333, y: 444 },
  });
  assert.deepEqual(synced?.find((projection) => projection.id === 'alt')?.nodeCardSizes, {
    'node-a': { width: 260, height: 180 },
    'node-b': { width: 300, height: 210 },
  });
});
