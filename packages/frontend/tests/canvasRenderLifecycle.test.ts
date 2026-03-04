import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clearRenderLayerChildren,
  pruneNodeDraftMaps,
  resolveProjectionTransitionFrame,
  type ProjectionTransitionLike,
  type RenderLayerLike,
} from '../src/utils/canvasRenderLifecycle.ts';

test('clearRenderLayerChildren destroys removed children recursively', () => {
  const destroyCalls: Array<{ children?: boolean }> = [];
  const layer: RenderLayerLike = {
    removeChildren: () => [
      {
        destroy: (options) => {
          destroyCalls.push(options ?? {});
        },
      },
      {
        destroy: (options) => {
          destroyCalls.push(options ?? {});
        },
      },
    ],
  };

  clearRenderLayerChildren(layer);

  assert.equal(destroyCalls.length, 2);
  assert.deepEqual(destroyCalls, [{ children: true }, { children: true }]);
});

test('resolveProjectionTransitionFrame clears transition when graph id does not match', () => {
  const transition: ProjectionTransitionLike = {
    graphId: 'graph-a',
    startAt: 100,
    durationMs: 200,
  };

  const frame = resolveProjectionTransitionFrame(transition, 'graph-b', 150);

  assert.equal(frame.transition, null);
  assert.equal(frame.isActive, false);
  assert.equal(frame.progress, 1);
  assert.equal(frame.easedProgress, 1);
});

test('resolveProjectionTransitionFrame returns active eased frame while transition is in progress', () => {
  const transition: ProjectionTransitionLike = {
    graphId: 'graph-a',
    startAt: 100,
    durationMs: 200,
  };

  const frame = resolveProjectionTransitionFrame(transition, 'graph-a', 150);

  assert.equal(frame.transition, transition);
  assert.equal(frame.isActive, true);
  assert.equal(frame.progress, 0.25);
  assert.ok(frame.easedProgress > 0 && frame.easedProgress < 1);
});

test('resolveProjectionTransitionFrame completes and clears transition at progress >= 1', () => {
  const transition: ProjectionTransitionLike = {
    graphId: 'graph-a',
    startAt: 100,
    durationMs: 200,
  };

  const frame = resolveProjectionTransitionFrame(transition, 'graph-a', 301);

  assert.equal(frame.transition, null);
  assert.equal(frame.isActive, false);
  assert.equal(frame.progress, 1);
  assert.equal(frame.easedProgress, 1);
});

test('pruneNodeDraftMaps removes stale draft entries for deleted nodes', () => {
  const nodeCardDraftSizes = new Map<string, { width: number }>([
    ['node-a', { width: 120 }],
    ['node-b', { width: 140 }],
  ]);
  const nodeCardDraftPositions = new Map<string, { x: number; y: number }>([
    ['node-b', { x: 10, y: 20 }],
    ['node-c', { x: 30, y: 40 }],
  ]);

  pruneNodeDraftMaps(
    new Set(['node-b']),
    nodeCardDraftSizes,
    nodeCardDraftPositions
  );

  assert.deepEqual(Array.from(nodeCardDraftSizes.keys()), ['node-b']);
  assert.deepEqual(Array.from(nodeCardDraftPositions.keys()), ['node-b']);
});
