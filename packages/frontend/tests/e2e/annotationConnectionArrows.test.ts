import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createAnnotationArrowGraph,
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
  minX: 100,
  minY: 100,
  maxX: 1140,
  maxY: 300,
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
      await openCanvasForGraph(page, graphId);

      const canvas = page.locator('canvas').first();
      const canvasBox = await canvas.boundingBox();
      assert.ok(canvasBox, 'Canvas element should provide a bounding box');

      const leftBottomEdge = resolveWorldPointToScreen(canvasBox, {
        x: 100 + (220 * 0.25),
        y: 166 + 68,
      });
      const middleTopEdge = resolveWorldPointToScreen(canvasBox, {
        x: 440 + (220 * 0.5),
        y: 166,
      });
      const leftOutput = resolveWorldPointToScreen(canvasBox, {
        x: 100 + 220,
        y: 166 + 49,
      });
      const middleInput = resolveWorldPointToScreen(canvasBox, {
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
