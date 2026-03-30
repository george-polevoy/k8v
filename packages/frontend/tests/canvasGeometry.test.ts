import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveResizeHandlePlacements } from '../src/components/canvasGeometry.ts';

test('resolveResizeHandlePlacements keeps handles outside the bounds with a fixed margin', () => {
  assert.deepEqual(
    resolveResizeHandlePlacements(
      {
        x: 10,
        y: 20,
        width: 100,
        height: 80,
      },
      10,
      4
    ),
    [
      { anchorX: 10, anchorY: 20, drawX: -14, drawY: -14, handle: 'nw' },
      { anchorX: 60, anchorY: 20, drawX: -5, drawY: -14, handle: 'n' },
      { anchorX: 110, anchorY: 20, drawX: 4, drawY: -14, handle: 'ne' },
      { anchorX: 110, anchorY: 60, drawX: 4, drawY: -5, handle: 'e' },
      { anchorX: 110, anchorY: 100, drawX: 4, drawY: 4, handle: 'se' },
      { anchorX: 60, anchorY: 100, drawX: -5, drawY: 4, handle: 's' },
      { anchorX: 10, anchorY: 100, drawX: -14, drawY: 4, handle: 'sw' },
      { anchorX: 10, anchorY: 60, drawX: -14, drawY: -5, handle: 'w' },
    ]
  );
});
