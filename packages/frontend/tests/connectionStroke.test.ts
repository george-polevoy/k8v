import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_GRAPH_CONNECTION_STROKE,
  normalizeGraphConnectionStroke,
  resolveGraphConnectionStroke,
} from '../src/utils/connectionStroke.ts';

function resolveBrightness(color: string): number {
  const r = Number.parseInt(color.slice(1, 3), 16);
  const g = Number.parseInt(color.slice(3, 5), 16);
  const b = Number.parseInt(color.slice(5, 7), 16);
  return (0.299 * r) + (0.587 * g) + (0.114 * b);
}

test('normalizeGraphConnectionStroke falls back to defaults for invalid values', () => {
  const normalized = normalizeGraphConnectionStroke({
    foregroundColor: 'invalid',
    backgroundColor: 'invalid',
    foregroundWidth: Number.NaN,
    backgroundWidth: Number.NaN,
  });

  assert.deepEqual(normalized, DEFAULT_GRAPH_CONNECTION_STROKE);
});

test('normalizeGraphConnectionStroke keeps background width at 2x foreground width', () => {
  const normalizedFromForeground = normalizeGraphConnectionStroke({
    foregroundWidth: 2.75,
    backgroundWidth: 99,
  });
  assert.equal(normalizedFromForeground.foregroundWidth, 2.75);
  assert.equal(normalizedFromForeground.backgroundWidth, 5.5);

  const normalizedFromBackground = normalizeGraphConnectionStroke({
    foregroundWidth: Number.NaN,
    backgroundWidth: 9.6,
  });
  assert.equal(normalizedFromBackground.foregroundWidth, 4.8);
  assert.equal(normalizedFromBackground.backgroundWidth, 9.6);
});

test('normalizeGraphConnectionStroke enforces brightness separation between foreground/background colors', () => {
  const normalized = normalizeGraphConnectionStroke({
    foregroundColor: '#3c3c3c',
    backgroundColor: '#3c3c3c',
  });

  assert.equal(normalized.foregroundColor, '#3c3c3c');
  assert.ok(
    Math.abs(
      resolveBrightness(normalized.foregroundColor) -
      resolveBrightness(normalized.backgroundColor)
    ) >= 24
  );
});

test('resolveGraphConnectionStroke returns normalized graph-level stroke settings', () => {
  const resolved = resolveGraphConnectionStroke({
    connectionStroke: {
      foregroundColor: '#204060',
      backgroundColor: '#7f7f7f',
      foregroundWidth: 1.25,
      backgroundWidth: 7.5,
    },
  });

  assert.equal(resolved.foregroundColor, '#204060');
  assert.equal(resolved.foregroundWidth, 1.25);
  assert.equal(resolved.backgroundWidth, 2.5);
});
