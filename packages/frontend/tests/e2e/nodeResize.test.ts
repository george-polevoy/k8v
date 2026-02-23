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
  for (let y = region.minY; y <= region.maxY; y += 4) {
    for (let x = region.minX; x <= region.maxX; x += 4) {
      await page.mouse.move(x, y);
      if ((await readCanvasCursor(page)) === 'nwse-resize') {
        return { x, y };
      }
    }
  }

  throw new Error(`Failed to find resize handle cursor within region ${JSON.stringify(region)}`);
}

async function ensureNodeSelected(
  page: import('playwright').Page,
  nodeBox: NodeScreenPosition
): Promise<void> {
  const nodeNameInput = page.locator('[data-testid="node-name-input"]');
  if (await nodeNameInput.isVisible()) {
    return;
  }

  const selectionClicks = [
    { x: nodeBox.centerX, y: nodeBox.centerY },
    { x: nodeBox.left + 24, y: nodeBox.centerY - 30 },
    { x: nodeBox.left + 24, y: nodeBox.centerY - 12 },
    { x: nodeBox.centerX - 80, y: nodeBox.centerY - 12 },
    { x: nodeBox.centerX + 80, y: nodeBox.centerY - 12 },
    { x: nodeBox.centerX, y: nodeBox.centerY - 56 },
    { x: nodeBox.centerX, y: nodeBox.centerY + 28 },
  ];

  const deadline = Date.now() + E2E_ASSERT_TIMEOUT_MS;
  let index = 0;
  while (Date.now() < deadline) {
    const click = selectionClicks[index % selectionClicks.length];
    index += 1;
    await page.mouse.click(click.x, click.y);
    await page.waitForTimeout(120);
    if (await nodeNameInput.isVisible()) {
      return;
    }
  }

  throw new Error('Failed to select centered node before resize interaction.');
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
      await ensureNodeSelected(page, nodeBox);

      const resizePoint = await locateResizeHandle(page, {
        minX: Math.round(nodeBox.left + DEFAULT_NODE_WIDTH - 80),
        maxX: Math.round(nodeBox.left + DEFAULT_NODE_WIDTH + 60),
        minY: Math.round(nodeBox.centerY - 20),
        maxY: Math.round(nodeBox.centerY + 90),
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
