import test from 'node:test';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import { buildPngMipLevels } from '../src/core/graphicsArtifacts.ts';

function setPixel(
  png: PNG,
  x: number,
  y: number,
  r: number,
  g: number,
  b: number,
  a: number
) {
  const index = (png.width * y + x) << 2;
  png.data[index] = r;
  png.data[index + 1] = g;
  png.data[index + 2] = b;
  png.data[index + 3] = a;
}

test('buildPngMipLevels preserves color at transparent edges via premultiplied filtering', () => {
  const source = new PNG({ width: 2, height: 1 });
  setPixel(source, 0, 0, 255, 0, 0, 255);
  setPixel(source, 1, 0, 0, 0, 0, 0);

  const levels = buildPngMipLevels(PNG.sync.write(source));
  assert.ok(levels.length >= 2, 'expected at least one downsampled mip level');
  const mip1 = PNG.sync.read(levels[1].buffer);
  const r = mip1.data[0];
  const g = mip1.data[1];
  const b = mip1.data[2];
  const a = mip1.data[3];

  // Correct premultiplied filtering produces a 50% alpha pure red texel.
  assert.equal(a, 128);
  assert.equal(r, 255);
  assert.equal(g, 0);
  assert.equal(b, 0);
});
