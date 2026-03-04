import assert from 'node:assert/strict';
import test from 'node:test';
import {
  resolveGraphWorldBounds,
  resolveViewportFitTransform,
} from '../src/utils/canvasViewportFit.ts';

test('resolveGraphWorldBounds returns null when there are no nodes or drawings', () => {
  assert.equal(resolveGraphWorldBounds([], []), null);
});

test('resolveGraphWorldBounds includes node projected graphics and drawing path extents', () => {
  const bounds = resolveGraphWorldBounds(
    [
      {
        x: 100,
        y: 200,
        width: 120,
        height: 80,
        projectedGraphicsHeight: 60,
      },
    ],
    [
      {
        position: { x: 50, y: 40 },
        paths: [
          {
            points: [
              { x: -20, y: 15 },
              { x: 30, y: 70 },
            ],
          },
        ],
      },
    ]
  );

  assert.deepEqual(bounds, {
    minX: 30,
    minY: 40,
    maxX: 220,
    maxY: 340,
  });
});

test('resolveViewportFitTransform centers graph and clamps scale', () => {
  const transform = resolveViewportFitTransform({
    bounds: {
      minX: 0,
      minY: 0,
      maxX: 200,
      maxY: 100,
    },
    screenWidth: 800,
    screenHeight: 600,
    margin: 100,
    minZoom: 0.1,
    maxZoom: 4,
  });

  assert.deepEqual(transform, {
    scale: 1,
    x: 300,
    y: 250,
  });
});

test('resolveViewportFitTransform caps fit scale at 1 before applying zoom limits', () => {
  const transform = resolveViewportFitTransform({
    bounds: {
      minX: 10,
      minY: 20,
      maxX: 12,
      maxY: 22,
    },
    screenWidth: 800,
    screenHeight: 600,
    margin: 100,
    minZoom: 0.1,
    maxZoom: 2,
  });

  assert.equal(transform.scale, 1);
});
