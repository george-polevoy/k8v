import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createInlineInputReplacementGraph,
  waitForGraphConnections,
} from './support/api.ts';
import {
  launchBrowser,
  openCanvasForGraph,
  waitForCursorAtPoint,
} from './support/browser.ts';
import { E2E_ASSERT_TIMEOUT_MS } from './support/config.ts';
import { ensureE2EEnvironment, shutdownE2EEnvironment } from './support/environment.ts';

const VIEWPORT_MARGIN = 100;
const GRAPH_BOUNDS = {
  minX: 120,
  minY: 120,
  maxX: 680,
  maxY: 368,
};

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

function resolveWorldPointToScreen(canvasBox: CanvasBox, point: WorldPoint): { x: number; y: number } {
  const graphWidth = GRAPH_BOUNDS.maxX - GRAPH_BOUNDS.minX;
  const graphHeight = GRAPH_BOUNDS.maxY - GRAPH_BOUNDS.minY;
  const scale = Math.min(
    (canvasBox.width - (VIEWPORT_MARGIN * 2)) / graphWidth,
    (canvasBox.height - (VIEWPORT_MARGIN * 2)) / graphHeight,
    1
  );
  const viewportX = (canvasBox.width / 2) - (((GRAPH_BOUNDS.minX + GRAPH_BOUNDS.maxX) * 0.5) * scale);
  const viewportY = (canvasBox.height / 2) - (((GRAPH_BOUNDS.minY + GRAPH_BOUNDS.maxY) * 0.5) * scale);

  return {
    x: canvasBox.x + viewportX + (point.x * scale),
    y: canvasBox.y + viewportY + (point.y * scale),
  };
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

      const sourceBOutput = resolveWorldPointToScreen(canvasBox, {
        x: 120 + 220,
        y: 300 + 49,
      });
      const targetInput = resolveWorldPointToScreen(canvasBox, {
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
