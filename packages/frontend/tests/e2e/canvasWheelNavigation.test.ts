import assert from 'node:assert/strict';
import test from 'node:test';
import { createNumericInputGraph } from './support/api.ts';
import { launchBrowser, openCanvasForGraph } from './support/browser.ts';
import { E2E_ASSERT_TIMEOUT_MS } from './support/config.ts';
import { ensureE2EEnvironment, shutdownE2EEnvironment } from './support/environment.ts';

interface MinimapViewportRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface CanvasBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface CanvasDebugCounters {
  fullRenderCount: number;
  viewportSyncCount: number;
  viewportDeferredRenderCount: number;
}

async function installMinimapViewportCaptureHook(page: import('playwright').Page): Promise<void> {
  await page.evaluate(() => {
    type StrokeRectRecord = {
      x: number;
      y: number;
      width: number;
      height: number;
      lineWidth: number;
      strokeStyle: string;
    };
    const windowWithHook = window as Window & {
      __k8vMinimapStrokeRects?: StrokeRectRecord[];
      __k8vMinimapStrokeRectPatched?: boolean;
    };
    if (windowWithHook.__k8vMinimapStrokeRectPatched) {
      return;
    }

    const records: StrokeRectRecord[] = [];
    windowWithHook.__k8vMinimapStrokeRects = records;

    const originalStrokeRect = CanvasRenderingContext2D.prototype.strokeRect;
    CanvasRenderingContext2D.prototype.strokeRect = function (
      x: number,
      y: number,
      width: number,
      height: number
    ): void {
      records.push({
        x,
        y,
        width,
        height,
        lineWidth: Number(this.lineWidth),
        strokeStyle: String(this.strokeStyle),
      });
      if (records.length > 1200) {
        records.splice(0, records.length - 1200);
      }
      originalStrokeRect.call(this, x, y, width, height);
    };
    windowWithHook.__k8vMinimapStrokeRectPatched = true;
  });
}

async function installCanvasDebugCounters(page: import('playwright').Page): Promise<void> {
  await page.addInitScript(() => {
    (window as Window & {
      __k8vCanvasDebug?: {
        fullRenderCount?: number;
        viewportSyncCount?: number;
        viewportDeferredRenderCount?: number;
      };
    }).__k8vCanvasDebug = {
      fullRenderCount: 0,
      viewportSyncCount: 0,
      viewportDeferredRenderCount: 0,
    };
  });
}

async function readCanvasDebugCounters(page: import('playwright').Page): Promise<CanvasDebugCounters> {
  return page.evaluate(() => {
    const counters = (window as Window & {
      __k8vCanvasDebug?: {
        fullRenderCount?: number;
        viewportSyncCount?: number;
        viewportDeferredRenderCount?: number;
      };
    }).__k8vCanvasDebug;
    return {
      fullRenderCount: counters?.fullRenderCount ?? 0,
      viewportSyncCount: counters?.viewportSyncCount ?? 0,
      viewportDeferredRenderCount: counters?.viewportDeferredRenderCount ?? 0,
    };
  });
}

async function waitForCanvasDebugCountersToSettle(
  page: import('playwright').Page,
  timeoutMs = E2E_ASSERT_TIMEOUT_MS
): Promise<CanvasDebugCounters> {
  const startedAt = Date.now();
  let previousCounters = await readCanvasDebugCounters(page);

  while ((Date.now() - startedAt) < timeoutMs) {
    await page.waitForTimeout(180);
    const nextCounters = await readCanvasDebugCounters(page);
    if (
      nextCounters.fullRenderCount === previousCounters.fullRenderCount &&
      nextCounters.viewportSyncCount === previousCounters.viewportSyncCount &&
      nextCounters.viewportDeferredRenderCount === previousCounters.viewportDeferredRenderCount
    ) {
      return nextCounters;
    }
    previousCounters = nextCounters;
  }

  throw new Error(`Timed out waiting for canvas debug counters to settle. Last counters: ${JSON.stringify(previousCounters)}`);
}

async function readMinimapViewportRect(
  page: import('playwright').Page
): Promise<MinimapViewportRect | null> {
  return page.evaluate(() => {
    const records = (window as Window & {
      __k8vMinimapStrokeRects?: Array<{
        x: number;
        y: number;
        width: number;
        height: number;
        lineWidth: number;
        strokeStyle: string;
      }>;
    }).__k8vMinimapStrokeRects;

    if (!Array.isArray(records)) {
      return null;
    }

    for (let index = records.length - 1; index >= 0; index -= 1) {
      const record = records[index];
      const isViewportOutline = Math.abs(record.lineWidth - 1.5) < 0.01;
      if (isViewportOutline) {
        return {
          x: record.x,
          y: record.y,
          width: record.width,
          height: record.height,
        };
      }
    }

    return null;
  });
}

async function waitForViewportRect(
  page: import('playwright').Page,
  predicate: (rect: MinimapViewportRect) => boolean,
  timeoutMs = E2E_ASSERT_TIMEOUT_MS
): Promise<MinimapViewportRect> {
  const startedAt = Date.now();
  let lastRect: MinimapViewportRect | null = null;

  while ((Date.now() - startedAt) < timeoutMs) {
    lastRect = await readMinimapViewportRect(page);
    if (lastRect && predicate(lastRect)) {
      return lastRect;
    }
    await page.waitForTimeout(50);
  }

  throw new Error(
    `Timed out waiting for minimap viewport rect change. Last rect: ${
      lastRect ? JSON.stringify(lastRect) : 'null'
    }`
  );
}

function approxEqual(a: number, b: number, tolerance: number): boolean {
  return Math.abs(a - b) <= tolerance;
}

test.before(async () => {
  await ensureE2EEnvironment();
});

test.after(async () => {
  await shutdownE2EEnvironment();
});

test(
  'canvas wheel navigation keeps mouse-wheel zoom and maps modifier/trackpad panning',
  { timeout: 90_000 },
  async () => {
    const { graphId } = await createNumericInputGraph();
    const browser = await launchBrowser();

    try {
      const context = await browser.newContext({
        viewport: { width: 1400, height: 900 },
        deviceScaleFactor: 1,
      });
      const page = await context.newPage();

      await openCanvasForGraph(page, graphId);
      await installMinimapViewportCaptureHook(page);

      const canvas = page.locator('canvas').first();
      const canvasBox = await canvas.boundingBox() as CanvasBox | null;
      assert.ok(canvasBox, 'Canvas element should provide a bounding box');

      const cursorX = canvasBox.x + (canvasBox.width / 2);
      const cursorY = canvasBox.y + (canvasBox.height / 2);
      await page.mouse.move(cursorX, cursorY);

      await page.evaluate(({ x, y }) => {
        const mainCanvas = document.querySelector('canvas');
        if (!(mainCanvas instanceof HTMLCanvasElement)) {
          throw new Error('Main canvas not found');
        }
        mainCanvas.dispatchEvent(new WheelEvent('wheel', {
          deltaX: 0,
          deltaY: 0,
          clientX: x,
          clientY: y,
          bubbles: true,
          cancelable: true,
        }));
      }, { x: cursorX, y: cursorY });
      const initialRect = await waitForViewportRect(page, () => true);

      await page.evaluate(({ x, y }) => {
        const mainCanvas = document.querySelector('canvas');
        if (!(mainCanvas instanceof HTMLCanvasElement)) {
          throw new Error('Main canvas not found');
        }
        mainCanvas.dispatchEvent(new WheelEvent('wheel', {
          deltaX: 0,
          deltaY: -20,
          clientX: x,
          clientY: y,
          bubbles: true,
          cancelable: true,
        }));
      }, { x: cursorX, y: cursorY });
      const afterSmallWheelRect = await waitForViewportRect(
        page,
        (rect) => rect.width < (initialRect.width - 0.02)
      );
      const smallWheelZoomStep = initialRect.width - afterSmallWheelRect.width;
      assert.ok(
        smallWheelZoomStep > 0,
        `Expected regular small wheel delta to zoom in (${initialRect.width} -> ${afterSmallWheelRect.width})`
      );

      await page.evaluate(({ x, y }) => {
        const mainCanvas = document.querySelector('canvas');
        if (!(mainCanvas instanceof HTMLCanvasElement)) {
          throw new Error('Main canvas not found');
        }
        mainCanvas.dispatchEvent(new WheelEvent('wheel', {
          deltaX: 0,
          deltaY: -20,
          ctrlKey: true,
          clientX: x,
          clientY: y,
          bubbles: true,
          cancelable: true,
        }));
      }, { x: cursorX, y: cursorY });
      const afterPinchRect = await waitForViewportRect(
        page,
        (rect) => rect.width < (afterSmallWheelRect.width - 0.02)
      );
      const pinchZoomStep = afterSmallWheelRect.width - afterPinchRect.width;
      assert.ok(
        pinchZoomStep > (smallWheelZoomStep * 3),
        `Expected pinch zoom step to be significantly stronger than regular wheel step (${smallWheelZoomStep} vs ${pinchZoomStep})`
      );

      await page.mouse.wheel(0, -120);
      const afterZoomRect = await waitForViewportRect(
        page,
        (rect) => rect.width < afterPinchRect.width || rect.height < afterPinchRect.height
      );
      assert.ok(
        afterZoomRect.width < afterPinchRect.width,
        `Mouse-wheel zoom should shrink minimap viewport width (${afterPinchRect.width} -> ${afterZoomRect.width})`
      );

      await page.keyboard.down('Shift');
      await page.mouse.wheel(0, 120);
      await page.keyboard.up('Shift');
      const afterShiftRect = await waitForViewportRect(
        page,
        (rect) =>
          !approxEqual(rect.x, afterZoomRect.x, 0.08) &&
          approxEqual(rect.y, afterZoomRect.y, 0.08)
      );
      assert.ok(
        approxEqual(afterShiftRect.y, afterZoomRect.y, 0.08),
        `Shift+wheel should keep vertical position unchanged (${afterZoomRect.y} vs ${afterShiftRect.y})`
      );

      await page.keyboard.down('Alt');
      await page.mouse.wheel(0, 120);
      await page.keyboard.up('Alt');
      const afterAltRect = await waitForViewportRect(
        page,
        (rect) =>
          approxEqual(rect.x, afterShiftRect.x, 0.08) &&
          !approxEqual(rect.y, afterShiftRect.y, 0.08)
      );
      assert.ok(
        approxEqual(afterAltRect.x, afterShiftRect.x, 0.08),
        `Alt+wheel should keep horizontal position unchanged (${afterShiftRect.x} vs ${afterAltRect.x})`
      );

      await page.evaluate(({ x, y }) => {
        const mainCanvas = document.querySelector('canvas');
        if (!(mainCanvas instanceof HTMLCanvasElement)) {
          throw new Error('Main canvas not found');
        }
        mainCanvas.dispatchEvent(new WheelEvent('wheel', {
          deltaX: 10,
          deltaY: 8,
          clientX: x,
          clientY: y,
          bubbles: true,
          cancelable: true,
        }));
      }, { x: cursorX, y: cursorY });
      const afterTrackpadPanRect = await waitForViewportRect(
        page,
        (rect) =>
          !approxEqual(rect.x, afterAltRect.x, 0.08) &&
          !approxEqual(rect.y, afterAltRect.y, 0.08)
      );
      assert.ok(
        approxEqual(afterTrackpadPanRect.width, afterAltRect.width, 0.08),
        `Trackpad-style pan should not change zoom width (${afterAltRect.width} vs ${afterTrackpadPanRect.width})`
      );

      for (let step = 0; step < 16; step += 1) {
        await page.evaluate(({ x, y }) => {
          const mainCanvas = document.querySelector('canvas');
          if (!(mainCanvas instanceof HTMLCanvasElement)) {
            throw new Error('Main canvas not found');
          }
          mainCanvas.dispatchEvent(new WheelEvent('wheel', {
            deltaX: 0,
            deltaY: -180,
            clientX: x,
            clientY: y,
            bubbles: true,
            cancelable: true,
          }));
        }, { x: cursorX, y: cursorY });
      }

      const afterDeepZoomInRect = await waitForViewportRect(
        page,
        (rect) => rect.width < (initialRect.width * 0.32)
      );
      assert.ok(
        afterDeepZoomInRect.width < (initialRect.width * 0.32),
        `Expected deeper zoom-in range beyond previous cap (${initialRect.width} -> ${afterDeepZoomInRect.width})`
      );

      for (let step = 0; step < 18; step += 1) {
        await page.evaluate(({ x, y }) => {
          const mainCanvas = document.querySelector('canvas');
          if (!(mainCanvas instanceof HTMLCanvasElement)) {
            throw new Error('Main canvas not found');
          }
          mainCanvas.dispatchEvent(new WheelEvent('wheel', {
            deltaX: 0,
            deltaY: 180,
            clientX: x,
            clientY: y,
            bubbles: true,
            cancelable: true,
          }));
        }, { x: cursorX, y: cursorY });
      }

      const afterDeepZoomOutRect = await waitForViewportRect(
        page,
        (rect) => rect.width > (initialRect.width * 6)
      );
      assert.ok(
        afterDeepZoomOutRect.width > (initialRect.width * 6),
        `Expected deep zoom-out range well beyond previous minimum (${initialRect.width} -> ${afterDeepZoomOutRect.width})`
      );

      await context.close();
    } finally {
      await browser.close();
    }
  }
);

test(
  'viewport wheel interactions coalesce deferred rebuilds until motion settles',
  { timeout: 90_000 },
  async () => {
    const { graphId } = await createNumericInputGraph();
    const browser = await launchBrowser();

    try {
      const context = await browser.newContext({
        viewport: { width: 1400, height: 900 },
        deviceScaleFactor: 1,
      });
      const page = await context.newPage();

      await installCanvasDebugCounters(page);
      await openCanvasForGraph(page, graphId);

      const canvas = page.locator('canvas').first();
      const canvasBox = await canvas.boundingBox() as CanvasBox | null;
      assert.ok(canvasBox, 'Canvas element should provide a bounding box');

      const cursorX = canvasBox.x + (canvasBox.width / 2);
      const cursorY = canvasBox.y + (canvasBox.height / 2);
      await page.mouse.move(cursorX, cursorY);

      const baselineCounters = await waitForCanvasDebugCountersToSettle(page);

      for (let step = 0; step < 6; step += 1) {
        await page.evaluate(({ x, y }) => {
          const mainCanvas = document.querySelector('canvas');
          if (!(mainCanvas instanceof HTMLCanvasElement)) {
            throw new Error('Main canvas not found');
          }
          mainCanvas.dispatchEvent(new WheelEvent('wheel', {
            deltaX: 12,
            deltaY: 9,
            clientX: x,
            clientY: y,
            bubbles: true,
            cancelable: true,
          }));
        }, { x: cursorX, y: cursorY });
        await page.waitForTimeout(30);
      }

      await page.waitForTimeout(70);
      const duringInteractionCounters = await readCanvasDebugCounters(page);
      assert.ok(
        duringInteractionCounters.viewportSyncCount > baselineCounters.viewportSyncCount,
        `Expected viewport sync counter to advance during wheel panning (${baselineCounters.viewportSyncCount} -> ${duringInteractionCounters.viewportSyncCount})`
      );
      assert.equal(
        duringInteractionCounters.viewportDeferredRenderCount,
        baselineCounters.viewportDeferredRenderCount,
        `Expected no deferred viewport rebuild while wheel interaction is still active (${baselineCounters.viewportDeferredRenderCount} vs ${duringInteractionCounters.viewportDeferredRenderCount})`
      );

      const settledCounters = await waitForCanvasDebugCountersToSettle(page);
      assert.equal(
        settledCounters.viewportDeferredRenderCount,
        baselineCounters.viewportDeferredRenderCount + 1,
        `Expected exactly one deferred viewport rebuild after the interaction burst (${baselineCounters.viewportDeferredRenderCount} -> ${settledCounters.viewportDeferredRenderCount})`
      );

      await context.close();
    } finally {
      await browser.close();
    }
  }
);
