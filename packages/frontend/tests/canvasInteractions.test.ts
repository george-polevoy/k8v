import assert from 'node:assert/strict';
import test from 'node:test';
import {
  computeNodeResizeDraft,
  computeSnappedDragPosition,
  computeSnappedPanPosition,
  hasExceededDragThreshold,
  isCanvasDeletionShortcutBlocked,
  resolveWheelInteractionPlan,
} from '../src/utils/canvasInteractions.ts';

test('hasExceededDragThreshold requires movement at or above threshold', () => {
  assert.equal(hasExceededDragThreshold(1, 1, 2), false);
  assert.equal(hasExceededDragThreshold(2, 0, 2), true);
});

test('computeSnappedDragPosition converts pointer delta to snapped world position', () => {
  assert.deepEqual(
    computeSnappedDragPosition({
      originX: 100,
      originY: 200,
      pointerX: 140,
      pointerY: 260,
      startPointerX: 100,
      startPointerY: 200,
      scale: 2,
    }),
    {
      x: 120,
      y: 230,
    }
  );
});

test('computeSnappedPanPosition applies pointer delta in screen space', () => {
  assert.deepEqual(
    computeSnappedPanPosition({
      viewportX: 300,
      viewportY: 400,
      pointerX: 120,
      pointerY: 160,
      startPointerX: 100,
      startPointerY: 200,
    }),
    {
      x: 320,
      y: 360,
    }
  );
});

test('computeNodeResizeDraft expands east/south handles with scale compensation', () => {
  assert.deepEqual(
    computeNodeResizeDraft({
      x: 10,
      y: 20,
      width: 100,
      height: 80,
      minWidth: 60,
      minHeight: 40,
      handle: 'se',
      pointerX: 170,
      pointerY: 130,
      startPointerX: 110,
      startPointerY: 100,
      scale: 2,
    }),
    {
      x: 10,
      y: 20,
      width: 130,
      height: 95,
    }
  );
});

test('computeNodeResizeDraft enforces min width when resizing from west', () => {
  assert.deepEqual(
    computeNodeResizeDraft({
      x: 100,
      y: 50,
      width: 120,
      height: 80,
      minWidth: 100,
      minHeight: 40,
      handle: 'w',
      pointerX: 180,
      pointerY: 50,
      startPointerX: 100,
      startPointerY: 50,
      scale: 1,
    }),
    {
      x: 120,
      y: 50,
      width: 100,
      height: 80,
    }
  );
});

test('resolveWheelInteractionPlan handles explicit modifier pan', () => {
  assert.deepEqual(
    resolveWheelInteractionPlan({
      currentX: 50,
      currentY: 75,
      currentScale: 1,
      deltaX: 10,
      deltaY: 20,
      modifierScrollDelta: { x: -25, y: 0 },
      shouldPan: false,
      pointerX: 0,
      pointerY: 0,
      worldBeforeX: 0,
      worldBeforeY: 0,
      zoomSensitivity: 0.0014,
      minZoom: 0.1,
      maxZoom: 4,
    }),
    {
      kind: 'pan',
      x: 25,
      y: 75,
    }
  );
});

test('resolveWheelInteractionPlan handles trackpad pan', () => {
  assert.deepEqual(
    resolveWheelInteractionPlan({
      currentX: 50,
      currentY: 75,
      currentScale: 1,
      deltaX: 12,
      deltaY: -18,
      modifierScrollDelta: null,
      shouldPan: true,
      pointerX: 0,
      pointerY: 0,
      worldBeforeX: 0,
      worldBeforeY: 0,
      zoomSensitivity: 0.0014,
      minZoom: 0.1,
      maxZoom: 4,
    }),
    {
      kind: 'pan',
      x: 38,
      y: 93,
    }
  );
});

test('resolveWheelInteractionPlan computes zoom scale and keeps pointer anchored', () => {
  const plan = resolveWheelInteractionPlan({
    currentX: 300,
    currentY: 220,
    currentScale: 1,
    deltaX: 0,
    deltaY: 100,
    modifierScrollDelta: null,
    shouldPan: false,
    pointerX: 200,
    pointerY: 150,
    worldBeforeX: 40,
    worldBeforeY: 30,
    zoomSensitivity: 0.0014,
    minZoom: 0.1,
    maxZoom: 4,
  });

  assert.equal(plan.kind, 'zoom');
  assert.ok(plan.scale > 0.8 && plan.scale < 0.9);
  const expectedScale = Math.exp(-0.14);
  assert.ok(Math.abs(plan.x - (200 - 40 * expectedScale)) < 0.000001);
  assert.ok(Math.abs(plan.y - (150 - 30 * expectedScale)) < 0.000001);
});

test('isCanvasDeletionShortcutBlocked only blocks editable non-canvas elements', () => {
  const canvasElement = {
    tagName: 'CANVAS',
    isContentEditable: false,
  } as unknown as HTMLElement;
  const inputElement = {
    tagName: 'INPUT',
    isContentEditable: false,
  } as unknown as HTMLElement;

  assert.equal(isCanvasDeletionShortcutBlocked(null, canvasElement), false);
  assert.equal(isCanvasDeletionShortcutBlocked(canvasElement, canvasElement), false);
  assert.equal(isCanvasDeletionShortcutBlocked(inputElement, canvasElement), true);
});
