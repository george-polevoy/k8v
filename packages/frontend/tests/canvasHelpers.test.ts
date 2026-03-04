import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clamp,
  easeInOutCubic,
  interpolateCanvasBackground,
  makePortKey,
  parsePortKey,
  snapToPixel,
} from '../src/utils/canvasHelpers.ts';

test('clamp bounds values to the provided range', () => {
  assert.equal(clamp(-5, 0, 10), 0);
  assert.equal(clamp(12, 0, 10), 10);
  assert.equal(clamp(7, 0, 10), 7);
});

test('easeInOutCubic returns expected values at key points', () => {
  assert.equal(easeInOutCubic(0), 0);
  assert.equal(easeInOutCubic(0.5), 0.5);
  assert.equal(easeInOutCubic(1), 1);
});

test('snapToPixel rounds to nearest integer pixel', () => {
  assert.equal(snapToPixel(10.49), 10);
  assert.equal(snapToPixel(10.5), 11);
});

test('makePortKey and parsePortKey round-trip node id and port name', () => {
  const key = makePortKey('node-1', 'outputA');
  assert.deepEqual(parsePortKey(key), { nodeId: 'node-1', portName: 'outputA' });
});

test('parsePortKey returns empty port name when separator is missing', () => {
  assert.deepEqual(parsePortKey('node-2'), { nodeId: 'node-2', portName: '' });
});

test('interpolateCanvasBackground blends color and switches mode at midpoint', () => {
  const from = {
    mode: 'gradient',
    baseColor: '#000000',
  } as const;
  const to = {
    mode: 'solid',
    baseColor: '#ffffff',
  } as const;

  assert.deepEqual(interpolateCanvasBackground(from, to, 0), {
    mode: 'gradient',
    baseColor: '#000000',
  });
  assert.deepEqual(interpolateCanvasBackground(from, to, 0.5), {
    mode: 'solid',
    baseColor: '#808080',
  });
  assert.deepEqual(interpolateCanvasBackground(from, to, 1), {
    mode: 'solid',
    baseColor: '#ffffff',
  });
});
