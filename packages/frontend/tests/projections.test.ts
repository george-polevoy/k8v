import test from 'node:test';
import assert from 'node:assert/strict';
import { NodeType } from '../src/types.ts';
import {
  applyProjectionToNodes,
  cloneProjectionNodePositions,
  DEFAULT_GRAPH_PROJECTION_ID,
  normalizeGraphProjectionState,
} from '../src/utils/projections.ts';

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
      type: NodeType.INLINE_CODE,
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

test('normalizeGraphProjectionState clamps oversized fallback node card width', () => {
  const node = makeNode('node-a', 1, 2);
  node.config.config = {
    cardWidth: 20_000,
    cardHeight: 120,
  };

  const projectionState = normalizeGraphProjectionState([node], [], 'default');
  assert.equal(projectionState.projections[0].nodeCardSizes['node-a'].width, 1920);
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
  assert.equal(projected[0].config.config?.cardWidth, 240);
  assert.equal(projected[0].config.config?.cardHeight, 140);
  assert.equal(projected[1].config.config?.cardWidth, 260);
  assert.equal(projected[1].config.config?.cardHeight, 160);
});
