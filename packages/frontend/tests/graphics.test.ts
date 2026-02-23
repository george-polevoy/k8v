import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveStableGraphicsRequestMaxPixels,
  selectGraphicsMipLevel,
} from '../src/utils/graphics.ts';
import { GraphicsArtifact } from '../src/types.ts';

const GRAPHICS: GraphicsArtifact = {
  id: 'gfx-1',
  mimeType: 'image/png',
  levels: [
    { level: 0, width: 1024, height: 1024, pixelCount: 1_048_576 },
    { level: 1, width: 512, height: 512, pixelCount: 262_144 },
    { level: 2, width: 256, height: 256, pixelCount: 65_536 },
    { level: 3, width: 128, height: 128, pixelCount: 16_384 },
  ],
};

test('selectGraphicsMipLevel stays on the same level for nearby zoom budgets', () => {
  const levelA = selectGraphicsMipLevel(GRAPHICS, 260_000);
  const levelB = selectGraphicsMipLevel(GRAPHICS, 200_000);

  assert.equal(levelA?.level, 1);
  assert.equal(levelB?.level, 1);
});

test('resolveStableGraphicsRequestMaxPixels quantizes to selected mip level pixelCount', () => {
  assert.equal(resolveStableGraphicsRequestMaxPixels(GRAPHICS, 1_000_000), 1_048_576);
  assert.equal(resolveStableGraphicsRequestMaxPixels(GRAPHICS, 70_000), 65_536);
  assert.equal(resolveStableGraphicsRequestMaxPixels(GRAPHICS, 17_000), 16_384);
});
