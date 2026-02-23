import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CANVAS_BACKGROUND,
  deriveGradientStops,
  normalizeCanvasBackground,
  resolveGraphCanvasBackground,
} from '../src/utils/canvasBackground.ts';

test('normalizeCanvasBackground falls back to defaults for invalid values', () => {
  const normalized = normalizeCanvasBackground({
    mode: 'invalid' as unknown as 'solid' | 'gradient',
    baseColor: 'not-a-color',
  });

  assert.deepEqual(normalized, DEFAULT_CANVAS_BACKGROUND);
});

test('normalizeCanvasBackground preserves valid mode and hex color', () => {
  const normalized = normalizeCanvasBackground({
    mode: 'solid',
    baseColor: '#A1B2C3',
  });

  assert.deepEqual(normalized, {
    mode: 'solid',
    baseColor: '#a1b2c3',
  });
});

test('resolveGraphCanvasBackground and deriveGradientStops produce deterministic palette', () => {
  const background = resolveGraphCanvasBackground({
    canvasBackground: {
      mode: 'gradient',
      baseColor: '#1d437e',
    },
  });
  const stops = deriveGradientStops(background.baseColor);

  assert.deepEqual(stops, ['#4a6998', '#1d437e', '#132c53', '#0a182d']);
});
