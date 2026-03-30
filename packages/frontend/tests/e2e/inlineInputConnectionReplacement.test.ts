import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createInlineInputReplacementGraph,
  waitForGraphConnections,
} from './support/api.ts';
import { launchBrowser, openCanvasForGraph, waitForCursorAtPoint } from './support/browser.ts';
import { E2E_ASSERT_TIMEOUT_MS } from './support/config.ts';
import { ensureE2EEnvironment, shutdownE2EEnvironment } from './support/environment.ts';

interface CanvasBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface WorldPoint {
  x: number;
  y: number;
}

interface ViewportTransform {
  x: number;
  y: number;
  scale: number;
}

function resolveWorldPointToScreen(
  canvasBox: CanvasBox,
  viewportTransform: ViewportTransform,
  point: WorldPoint
): { x: number; y: number } {
  return {
    x: canvasBox.x + viewportTransform.x + (point.x * viewportTransform.scale),
    y: canvasBox.y + viewportTransform.y + (point.y * viewportTransform.scale),
  };
}

async function readViewportTransform(page: import('playwright').Page): Promise<ViewportTransform> {
  return page.evaluate(() => {
    const debug = (window as Window & {
      __k8vCanvasDebug?: {
        viewportX?: unknown;
        viewportY?: unknown;
        viewportScale?: unknown;
      };
    }).__k8vCanvasDebug;
    return {
      x: typeof debug?.viewportX === 'number' ? debug.viewportX : Number.NaN,
      y: typeof debug?.viewportY === 'number' ? debug.viewportY : Number.NaN,
      scale: typeof debug?.viewportScale === 'number' ? debug.viewportScale : Number.NaN,
    };
  });
}

async function waitForViewportTransform(
  page: import('playwright').Page,
  timeoutMs = E2E_ASSERT_TIMEOUT_MS
): Promise<ViewportTransform> {
  const startedAt = Date.now();
  let lastTransform = await readViewportTransform(page);

  while ((Date.now() - startedAt) < timeoutMs) {
    if (
      Number.isFinite(lastTransform.x) &&
      Number.isFinite(lastTransform.y) &&
      Number.isFinite(lastTransform.scale)
    ) {
      return lastTransform;
    }
    await page.waitForTimeout(60);
    lastTransform = await readViewportTransform(page);
  }

  throw new Error(`Timed out waiting for viewport transform. Last value: ${JSON.stringify(lastTransform)}`);
}

async function dragConnection(
  page: import('playwright').Page,
  from: { x: number; y: number },
  to: { x: number; y: number }
): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 20 });
  await page.mouse.up();
}

test.before(async () => {
  await ensureE2EEnvironment();
});

test.after(async () => {
  await shutdownE2EEnvironment();
});

test(
  'dragging a new edge onto an occupied inline input replaces the previous inbound edge',
  { timeout: 90_000 },
  async () => {
    const {
      graphId,
      sourceAId,
      sourceBId,
      targetId,
    } = await createInlineInputReplacementGraph();

    const browser = await launchBrowser();
    try {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
      });
      const page = await context.newPage();
      await page.addInitScript(() => {
        (window as Window & {
          __k8vCanvasDebug?: Record<string, unknown>;
        }).__k8vCanvasDebug = {};
      });
      await openCanvasForGraph(page, graphId);

      const initialConnections = await waitForGraphConnections(
        graphId,
        (connections) =>
          connections.length === 1 &&
          connections[0]?.sourceNodeId === sourceAId &&
          connections[0]?.targetNodeId === targetId,
        E2E_ASSERT_TIMEOUT_MS
      );
      assert.equal(initialConnections.length, 1);

      const canvas = page.locator('canvas').first();
      const canvasBox = await canvas.boundingBox();
      assert.ok(canvasBox, 'Canvas element should provide a bounding box');
      const viewportTransform = await waitForViewportTransform(page);

      const sourceBOutput = resolveWorldPointToScreen(canvasBox, viewportTransform, {
        x: 120 + 220,
        y: 300 + 49,
      });
      const targetInput = resolveWorldPointToScreen(canvasBox, viewportTransform, {
        x: 460,
        y: 210 + 49,
      });

      await waitForCursorAtPoint(page, sourceBOutput.x, sourceBOutput.y, 'crosshair');
      await waitForCursorAtPoint(page, targetInput.x, targetInput.y, 'crosshair');
      await dragConnection(page, sourceBOutput, targetInput);

      const persistedConnections = await waitForGraphConnections(
        graphId,
        (connections) =>
          connections.length === 1 &&
          connections[0]?.sourceNodeId === sourceBId &&
          connections[0]?.targetNodeId === targetId &&
          connections[0]?.targetPort === 'input',
        E2E_ASSERT_TIMEOUT_MS
      );

      assert.equal(persistedConnections.length, 1);
      assert.equal(persistedConnections[0]?.sourceNodeId, sourceBId);
      assert.equal(persistedConnections[0]?.targetNodeId, targetId);
      assert.equal(persistedConnections[0]?.targetPort, 'input');

      await context.close();
    } finally {
      await browser.close();
    }
  }
);
