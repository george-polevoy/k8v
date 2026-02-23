import assert from 'node:assert/strict';
import test from 'node:test';
import { createNumericInputGraph, waitForNodeCardSize } from './support/api.ts';
import { launchBrowser, openCanvasForGraph, readCanvasCursor } from './support/browser.ts';
import { E2E_ASSERT_TIMEOUT_MS } from './support/config.ts';
import { ensureE2EEnvironment, shutdownE2EEnvironment } from './support/environment.ts';

const DEFAULT_NODE_WIDTH = 220;

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

interface SearchRegion {
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
    left: centerX - (DEFAULT_NODE_WIDTH / 2),
  };
}

async function locateResizeHandle(
  page: import('playwright').Page,
  region: SearchRegion
): Promise<{ x: number; y: number }> {
  for (let y = region.minY; y <= region.maxY; y += 2) {
    for (let x = region.minX; x <= region.maxX; x += 2) {
      await page.mouse.move(x, y);
      if ((await readCanvasCursor(page)) === 'nwse-resize') {
        return { x, y };
      }
    }
  }

  throw new Error(`Failed to find resize handle cursor within region ${JSON.stringify(region)}`);
}

test.before(async () => {
  await ensureE2EEnvironment();
});

test.after(async () => {
  await shutdownE2EEnvironment();
});

test(
  'node cards can be resized from canvas and persisted',
  { timeout: 90_000 },
  async () => {
    const { graphId, nodeId } = await createNumericInputGraph({
      value: 10,
      min: 0,
      max: 100,
      step: 1,
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
      await page.mouse.click(headerClickX, headerClickY);

      const resizePoint = await locateResizeHandle(page, {
        minX: Math.round(nodeBox.left + DEFAULT_NODE_WIDTH - 24),
        maxX: Math.round(nodeBox.left + DEFAULT_NODE_WIDTH + 8),
        minY: Math.round(nodeBox.centerY + 8),
        maxY: Math.round(nodeBox.centerY + 54),
      });

      await page.mouse.down();
      await page.mouse.move(resizePoint.x + 90, resizePoint.y + 48, { steps: 18 });
      await page.mouse.up();

      const resized = await waitForNodeCardSize(
        graphId,
        nodeId,
        (size) => (size.width ?? 0) >= 280 && (size.height ?? 0) >= 110,
        E2E_ASSERT_TIMEOUT_MS
      );

      assert.ok((resized.width ?? 0) >= 280, `Expected resized width >= 280. Received: ${resized.width}`);
      assert.ok((resized.height ?? 0) >= 110, `Expected resized height >= 110. Received: ${resized.height}`);

      await context.close();
    } finally {
      await browser.close();
    }
  }
);
