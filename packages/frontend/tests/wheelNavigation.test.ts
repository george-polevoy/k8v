import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveModifierWheelScrollDelta, shouldWheelPanCanvas } from '../src/utils/wheelNavigation.ts';

test('resolveModifierWheelScrollDelta maps shift+wheel to horizontal scroll', () => {
  assert.deepEqual(
    resolveModifierWheelScrollDelta({
      shiftKey: true,
      altKey: false,
      deltaX: 5,
      deltaY: 20,
    }),
    {
      x: -25,
      y: 0,
    }
  );
});

test('resolveModifierWheelScrollDelta maps alt+wheel to vertical-only scroll', () => {
  assert.deepEqual(
    resolveModifierWheelScrollDelta({
      shiftKey: false,
      altKey: true,
      deltaX: 12,
      deltaY: -30,
    }),
    {
      x: 0,
      y: 30,
    }
  );
});

test('resolveModifierWheelScrollDelta returns null without wheel modifiers', () => {
  assert.equal(
    resolveModifierWheelScrollDelta({
      shiftKey: false,
      altKey: false,
      deltaX: 0,
      deltaY: 15,
    }),
    null
  );
});

test('shouldWheelPanCanvas returns false for ctrl+wheel pinch zoom events', () => {
  assert.equal(
    shouldWheelPanCanvas({
      ctrlKey: true,
      deltaMode: 0,
      deltaX: 0,
      deltaY: 8,
    }),
    false
  );
});

test('shouldWheelPanCanvas returns false for line-mode mouse wheel events', () => {
  assert.equal(
    shouldWheelPanCanvas({
      ctrlKey: false,
      deltaMode: 1,
      deltaX: 0,
      deltaY: 3,
    }),
    false
  );
});

test('shouldWheelPanCanvas returns false for coarse pixel-mode wheel zoom events', () => {
  assert.equal(
    shouldWheelPanCanvas({
      ctrlKey: false,
      deltaMode: 0,
      deltaX: 0,
      deltaY: 120,
    }),
    false
  );
});

test('shouldWheelPanCanvas returns true for diagonal pixel-mode trackpad scroll', () => {
  assert.equal(
    shouldWheelPanCanvas({
      ctrlKey: false,
      deltaMode: 0,
      deltaX: 12,
      deltaY: -18,
    }),
    true
  );
});

test('shouldWheelPanCanvas returns true for fine-grained pixel-mode trackpad scroll', () => {
  assert.equal(
    shouldWheelPanCanvas({
      ctrlKey: false,
      deltaMode: 0,
      deltaX: 0.5,
      deltaY: 7.25,
    }),
    true
  );
});

test('shouldWheelPanCanvas returns true for ultra-fine integer pixel-mode vertical trackpad scroll', () => {
  assert.equal(
    shouldWheelPanCanvas({
      ctrlKey: false,
      deltaMode: 0,
      deltaX: 0,
      deltaY: 1,
    }),
    true
  );
});

test('shouldWheelPanCanvas returns false for medium integer pixel-mode mouse wheel deltas', () => {
  assert.equal(
    shouldWheelPanCanvas({
      ctrlKey: false,
      deltaMode: 0,
      deltaX: 0,
      deltaY: 53,
    }),
    false
  );
});

test('shouldWheelPanCanvas returns false for medium fractional pixel-mode wheel deltas', () => {
  assert.equal(
    shouldWheelPanCanvas({
      ctrlKey: false,
      deltaMode: 0,
      deltaX: 0,
      deltaY: 6.5,
    }),
    false
  );
});
