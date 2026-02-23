import assert from 'node:assert/strict';
import test from 'node:test';
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

function resolveCenteredNodePosition(canvasBox: CanvasBox): NodeScreenPosition {
  const centerX = canvasBox.x + (canvasBox.width / 2);
  const centerY = canvasBox.y + (canvasBox.height / 2);
  return {
    centerX,
    centerY,
    left: centerX - (NUMERIC_NODE_WIDTH / 2),
  };
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
      assert.equal(await readCanvasCursor(page), 'ew-resize');
      await page.mouse.up();
      assert.equal(await readCanvasCursor(page), 'ew-resize');

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
