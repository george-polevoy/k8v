import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveConnectionArrowHeadLayout } from '../src/utils/connectionArrows.ts';

test('resolveConnectionArrowHeadLayout keeps the background arrowhead as an outline around the foreground', () => {
  const resolved = resolveConnectionArrowHeadLayout({
    foregroundLineWidth: 2,
    backgroundLineWidth: 4,
    viewportScale: 1,
  });

  assert.deepEqual(resolved.foreground, {
    length: 10,
    width: 7,
  });
  assert.deepEqual(resolved.background, {
    length: 11,
    width: 9,
  });
});

test('resolveConnectionArrowHeadLayout preserves screen-space minimums while only adding outline padding', () => {
  const resolved = resolveConnectionArrowHeadLayout({
    foregroundLineWidth: 0.5,
    backgroundLineWidth: 1,
    viewportScale: 2,
  });

  assert.deepEqual(resolved.foreground, {
    length: 4.5,
    width: 3.5,
  });
  assert.deepEqual(resolved.background, {
    length: 4.75,
    width: 4,
  });
});
