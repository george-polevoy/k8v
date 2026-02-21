import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hasErroredNodeExecutionState,
  shouldKeepCanvasAnimationLoopRunning,
} from '../src/utils/canvasAnimation.ts';

test('hasErroredNodeExecutionState returns true when any node has an error', () => {
  const hasError = hasErroredNodeExecutionState({
    a: { hasError: false },
    b: { hasError: true },
  });

  assert.equal(hasError, true);
});

test('hasErroredNodeExecutionState returns false when nodes are all healthy', () => {
  const hasError = hasErroredNodeExecutionState({
    a: { hasError: false },
    b: undefined,
  });

  assert.equal(hasError, false);
});

test('shouldKeepCanvasAnimationLoopRunning returns false for idle canvas state', () => {
  const shouldKeepRunning = shouldKeepCanvasAnimationLoopRunning({
    hasActiveInteraction: false,
    hasErroredNodes: false,
    lightningPulseCount: 0,
    nodeShockCount: 0,
    smokePuffCount: 0,
  });

  assert.equal(shouldKeepRunning, false);
});

test('shouldKeepCanvasAnimationLoopRunning returns true for active interaction', () => {
  const shouldKeepRunning = shouldKeepCanvasAnimationLoopRunning({
    hasActiveInteraction: true,
    hasErroredNodes: false,
    lightningPulseCount: 0,
    nodeShockCount: 0,
    smokePuffCount: 0,
  });

  assert.equal(shouldKeepRunning, true);
});

test('shouldKeepCanvasAnimationLoopRunning returns true for active visual effects', () => {
  const shouldKeepRunning = shouldKeepCanvasAnimationLoopRunning({
    hasActiveInteraction: false,
    hasErroredNodes: false,
    lightningPulseCount: 1,
    nodeShockCount: 0,
    smokePuffCount: 0,
  });

  assert.equal(shouldKeepRunning, true);
});

test('shouldKeepCanvasAnimationLoopRunning returns true while errored nodes are present', () => {
  const shouldKeepRunning = shouldKeepCanvasAnimationLoopRunning({
    hasActiveInteraction: false,
    hasErroredNodes: true,
    lightningPulseCount: 0,
    nodeShockCount: 0,
    smokePuffCount: 0,
  });

  assert.equal(shouldKeepRunning, true);
});
