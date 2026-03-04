import assert from 'node:assert/strict';
import test from 'node:test';
import { PNG } from 'pngjs';
import { createNumericInputGraph, waitForNumericNodeValue } from './support/api.ts';
import { launchBrowser, openCanvasForGraph, readCanvasCursor, waitForCursorAtPoint } from './support/browser.ts';
import { E2E_ASSERT_TIMEOUT_MS } from './support/config.ts';
import { ensureE2EEnvironment, shutdownE2EEnvironment } from './support/environment.ts';

const NUMERIC_NODE_WIDTH = 220;

interface NodeScreenPosition {
  centerX: number;
  centerY: number;
  left: number;
}

interface CanvasBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface SliderProgressScanBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

function resolveCenteredNodePosition(canvasBox: CanvasBox): NodeScreenPosition {
  const centerX = canvasBox.x + (canvasBox.width / 2);
  const centerY = canvasBox.y + (canvasBox.height / 2);
  return {
    centerX,
    centerY,
    left: centerX - (NUMERIC_NODE_WIDTH / 2),
  };
}

function findSliderProgressMaxX(
  screenshotPng: Buffer,
  bounds: SliderProgressScanBounds
): number | null {
  const image = PNG.sync.read(screenshotPng);
  const minX = Math.max(0, Math.round(bounds.minX));
  const maxX = Math.min(image.width - 1, Math.round(bounds.maxX));
  const minY = Math.max(0, Math.round(bounds.minY));
  const maxY = Math.min(image.height - 1, Math.round(bounds.maxY));

  if (maxX < minX || maxY < minY) {
    return null;
  }

  let maxProgressX = Number.NEGATIVE_INFINITY;
  let activePixelCount = 0;

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const index = ((y * image.width) + x) * 4;
      const r = image.data[index] ?? 0;
      const g = image.data[index + 1] ?? 0;
      const b = image.data[index + 2] ?? 0;
      const a = image.data[index + 3] ?? 0;
      const isSliderBlue = (
        a >= 140 &&
        b >= 95 &&
        b >= g &&
        b >= r &&
        (b - r) >= 18
      );

      if (isSliderBlue) {
        activePixelCount += 1;
        maxProgressX = Math.max(maxProgressX, x);
      }
    }
  }

  if (!Number.isFinite(maxProgressX) || activePixelCount < 6) {
    return null;
  }

  return maxProgressX;
}

async function locateSliderY(page: import('playwright').Page, scanX: number, centerY: number): Promise<number> {
  const scanStart = centerY - 30;
  const scanEnd = centerY + 120;
  for (let y = scanStart; y <= scanEnd; y += 2) {
    await page.mouse.move(scanX, y);
    if ((await readCanvasCursor(page)) === 'ew-resize') {
      return y;
    }
  }

  throw new Error(`Failed to locate slider row near x=${scanX.toFixed(1)} around centerY=${centerY.toFixed(1)}`);
}

test.before(async () => {
  await ensureE2EEnvironment();
});

test.after(async () => {
  await shutdownE2EEnvironment();
});

test(
  'numeric_input slider drag keeps resize cursor and persists dragged value',
  { timeout: 90_000 },
  async () => {
    const { graphId, nodeId } = await createNumericInputGraph({
      value: 0,
      min: 0,
      max: 100,
      step: 1,
      nodeName: 'Numeric Input',
    });

    const browser = await launchBrowser();
    try {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
      });
      const page = await context.newPage();
      await openCanvasForGraph(page, graphId);

      const canvas = page.locator('canvas').first();
      const canvasBox = await canvas.boundingBox();
      assert.ok(canvasBox, 'Canvas element should provide a bounding box');

      const nodeBox = resolveCenteredNodePosition(canvasBox);
      const headerClickX = nodeBox.left + 24;
      const headerClickY = nodeBox.centerY - 30;
      const sliderStartX = nodeBox.left + 12;
      const sliderEndX = nodeBox.left + NUMERIC_NODE_WIDTH - 12;

      // Select the card first to exercise the cursor-priority case.
      await page.mouse.click(headerClickX, headerClickY);
      const sliderY = await locateSliderY(page, nodeBox.left + 80, nodeBox.centerY);
      await waitForCursorAtPoint(page, sliderStartX, sliderY, 'ew-resize');
      assert.equal(await readCanvasCursor(page), 'ew-resize');

      await page.mouse.down();
      await page.mouse.move(sliderEndX, sliderY, { steps: 24 });
      await waitForCursorAtPoint(page, sliderEndX - 8, sliderY, 'ew-resize');
      await page.mouse.up();
      await waitForCursorAtPoint(page, sliderEndX - 8, sliderY, 'ew-resize');

      const finalValue = await waitForNumericNodeValue(
        graphId,
        nodeId,
        (value) => value >= 95,
        E2E_ASSERT_TIMEOUT_MS
      );
      assert.ok(finalValue >= 95, `Expected dragged slider value to be near max. Received: ${finalValue}`);

      await context.close();
    } finally {
      await browser.close();
    }
  }
);

test(
  'numeric_input slider drag stays visually stable across canvas re-renders',
  { timeout: 90_000 },
  async () => {
    const { graphId, nodeId } = await createNumericInputGraph({
      value: 0,
      min: 0,
      max: 100,
      step: 1,
      nodeName: 'Numeric Input',
    });

    const browser = await launchBrowser();
    try {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
      });
      const page = await context.newPage();
      await openCanvasForGraph(page, graphId);

      const canvas = page.locator('canvas').first();
      const canvasBox = await canvas.boundingBox();
      assert.ok(canvasBox, 'Canvas element should provide a bounding box');

      const nodeBox = resolveCenteredNodePosition(canvasBox);
      const sliderTrackStartX = nodeBox.left + 12;
      const sliderTrackEndX = nodeBox.left + NUMERIC_NODE_WIDTH - 34;
      const sliderTargetX = sliderTrackStartX + ((sliderTrackEndX - sliderTrackStartX) * 0.82);
      const sliderY = await locateSliderY(page, nodeBox.left + 80, nodeBox.centerY);
      const sliderTrackStartInCanvas = sliderTrackStartX - canvasBox.x;
      const sliderTrackEndInCanvas = sliderTrackEndX - canvasBox.x;
      const sliderBandTopInCanvas = (sliderY - canvasBox.y) - 2;
      const sliderBandBottomInCanvas = sliderBandTopInCanvas + 28;

      await waitForCursorAtPoint(page, sliderTrackStartX, sliderY, 'ew-resize');
      await page.mouse.down();
      await page.mouse.move(sliderTargetX, sliderY, { steps: 20 });
      await page.waitForTimeout(120);

      const movedScreenshot = await canvas.screenshot();
      const movedProgressX = findSliderProgressMaxX(movedScreenshot, {
        minX: sliderTrackStartInCanvas - 4,
        maxX: sliderTrackEndInCanvas + 4,
        minY: sliderBandTopInCanvas,
        maxY: sliderBandBottomInCanvas,
      });
      assert.ok(movedProgressX !== null, 'Expected to detect active slider progress while drag is held');
      if (movedProgressX === null) {
        throw new Error('Moved slider progress should not be null before stability assertion.');
      }

      const expectedMovedThreshold = sliderTrackStartInCanvas +
        ((sliderTrackEndInCanvas - sliderTrackStartInCanvas) * 0.6);
      assert.ok(
        movedProgressX >= expectedMovedThreshold,
        `Expected moved slider progress to be past 60% of track. moved=${movedProgressX}, threshold=${expectedMovedThreshold}`
      );

      await page.evaluate(() => {
        const canvas = document.querySelector('canvas');
        if (!(canvas instanceof HTMLCanvasElement)) {
          throw new Error('Main canvas not found');
        }
        const rect = canvas.getBoundingClientRect();
        canvas.dispatchEvent(new WheelEvent('wheel', {
          bubbles: true,
          cancelable: true,
          clientX: rect.left + (rect.width / 2),
          clientY: rect.top + (rect.height / 2),
          deltaMode: WheelEvent.DOM_DELTA_PIXEL,
          deltaX: 0,
          deltaY: 0,
        }));
      });
      await page.waitForTimeout(220);

      const heldScreenshot = await canvas.screenshot();
      const heldProgressX = findSliderProgressMaxX(heldScreenshot, {
        minX: sliderTrackStartInCanvas - 4,
        maxX: sliderTrackEndInCanvas + 4,
        minY: sliderBandTopInCanvas,
        maxY: sliderBandBottomInCanvas,
      });
      assert.ok(heldProgressX !== null, 'Expected to detect slider progress after forced canvas re-render');
      if (heldProgressX === null) {
        throw new Error('Held slider progress should not be null before drift assertion.');
      }

      assert.ok(
        Math.abs(heldProgressX - movedProgressX) <= 20,
        `Slider knob should stay near dragged position during active drag. moved=${movedProgressX}, held=${heldProgressX}`
      );

      await page.mouse.up();
      const finalValue = await waitForNumericNodeValue(
        graphId,
        nodeId,
        (value) => value >= 75,
        E2E_ASSERT_TIMEOUT_MS
      );
      assert.ok(finalValue >= 75, `Expected dragged slider value to persist after release. Received: ${finalValue}`);

      await context.close();
    } finally {
      await browser.close();
    }
  }
);
