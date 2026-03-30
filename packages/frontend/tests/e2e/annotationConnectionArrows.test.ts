import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createAnnotationArrowGraph,
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
  'card edges create persisted presentation arrows without affecting port data connections',
  { timeout: 90_000 },
  async () => {
    const {
      graphId,
      leftInlineId,
      middleInlineId,
    } = await createAnnotationArrowGraph();

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
      await page.waitForFunction(() => Boolean(window.__k8vGraphStore), {
        timeout: E2E_ASSERT_TIMEOUT_MS,
      });
      await page.evaluate((sourceNodeId: string) => {
        window.__k8vGraphStore?.getState().selectNode(sourceNodeId);
      }, leftInlineId);

      const canvas = page.locator('canvas').first();
      const canvasBox = await canvas.boundingBox();
      assert.ok(canvasBox, 'Canvas element should provide a bounding box');
      const viewportTransform = await waitForViewportTransform(page);

      const leftBottomEdge = resolveWorldPointToScreen(canvasBox, viewportTransform, {
        x: 100 + (220 * 0.25),
        y: 166 + 68,
      });
      const middleTopEdge = resolveWorldPointToScreen(canvasBox, viewportTransform, {
        x: 440 + (220 * 0.5),
        y: 166,
      });
      const leftOutput = resolveWorldPointToScreen(canvasBox, viewportTransform, {
        x: 100 + 220,
        y: 166 + 49,
      });
      const middleInput = resolveWorldPointToScreen(canvasBox, viewportTransform, {
        x: 440,
        y: 166 + 49,
      });

      await waitForCursorAtPoint(page, leftBottomEdge.x, leftBottomEdge.y, 'crosshair');
      await dragConnection(page, leftBottomEdge, middleTopEdge);

      await waitForCursorAtPoint(page, leftOutput.x, leftOutput.y, 'crosshair');
      await dragConnection(page, leftOutput, middleInput);

      const connections = await waitForGraphConnections(
        graphId,
        (items) => items.length === 2,
        E2E_ASSERT_TIMEOUT_MS
      );

      const presentationConnection = connections.find((connection) =>
        connection.sourceNodeId === leftInlineId &&
        connection.targetNodeId === middleInlineId &&
        connection.sourcePort === '__annotation__'
      );
      assert.ok(presentationConnection, 'Expected a persisted inline-to-inline presentation arrow');
      assert.equal(presentationConnection.targetPort, '__annotation__');
      assert.equal(presentationConnection.sourceAnchor?.side, 'bottom');
      assert.ok(
        Math.abs((presentationConnection.sourceAnchor?.offset ?? 0) - 0.25) < 0.05,
        `Expected bottom-edge anchor near 0.25, received ${presentationConnection.sourceAnchor?.offset}`
      );
      assert.equal(presentationConnection.targetAnchor?.side, 'top');
      assert.ok(
        Math.abs((presentationConnection.targetAnchor?.offset ?? 0) - 0.5) < 0.05,
        `Expected top-edge anchor near 0.5, received ${presentationConnection.targetAnchor?.offset}`
      );

      const dataConnection = connections.find((connection) =>
        connection.sourceNodeId === leftInlineId &&
        connection.targetNodeId === middleInlineId &&
        connection.sourcePort === 'output' &&
        connection.targetPort === 'input'
      );
      assert.ok(dataConnection, 'Expected a persisted port-to-port data connection');
      assert.equal(dataConnection.sourceAnchor, undefined);
      assert.equal(dataConnection.targetAnchor, undefined);

      await context.close();
    } finally {
      await browser.close();
    }
  }
);
