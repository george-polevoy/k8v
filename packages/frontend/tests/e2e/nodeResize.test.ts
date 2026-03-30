import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createInlineCodeGraph,
  getNodePosition,
  waitForNodeCardSize,
  waitForNodePosition,
} from './support/api.ts';
import {
  launchBrowser,
  openCanvasForGraph,
  openSidebarSection,
  readCanvasCursor,
  waitForCursorAtPoint,
} from './support/browser.ts';
import { E2E_ASSERT_TIMEOUT_MS } from './support/config.ts';
import { ensureE2EEnvironment, shutdownE2EEnvironment } from './support/environment.ts';
import {
  NODE_RESIZE_HANDLE_MARGIN,
  NODE_RESIZE_HANDLE_SIZE,
} from '../../src/components/canvasConstants.ts';

const DEFAULT_NODE_WIDTH = 220;
const DEFAULT_NODE_HEIGHT = 108;
const RESIZE_HANDLE_CENTER_OFFSET = NODE_RESIZE_HANDLE_MARGIN + (NODE_RESIZE_HANDLE_SIZE * 0.5);

interface NodeScreenPosition {
  centerX: number;
  centerY: number;
  left: number;
  top: number;
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

interface ViewportTransform {
  x: number;
  y: number;
  scale: number;
}

function resolveCenteredNodePosition(canvasBox: CanvasBox): NodeScreenPosition {
  const centerX = canvasBox.x + (canvasBox.width / 2);
  const centerY = canvasBox.y + (canvasBox.height / 2);
  return {
    centerX,
    centerY,
    left: centerX - (DEFAULT_NODE_WIDTH / 2),
    top: centerY - (DEFAULT_NODE_HEIGHT / 2),
  };
}

async function locateCursorPoint(
  page: import('playwright').Page,
  region: SearchRegion,
  expectedCursor: string
): Promise<{ x: number; y: number }> {
  for (let y = region.minY; y <= region.maxY; y += 4) {
    for (let x = region.minX; x <= region.maxX; x += 4) {
      await page.mouse.move(x, y);
      if ((await readCanvasCursor(page)) === expectedCursor) {
        return { x, y };
      }
    }
  }

  throw new Error(`Failed to find cursor "${expectedCursor}" within region ${JSON.stringify(region)}`);
}

async function readViewportTransform(page: import('playwright').Page): Promise<ViewportTransform> {
  return page.evaluate(() => {
    const debug = (window as Window & {
      __k8vCanvasDebug?: {
        viewportX?: number;
        viewportY?: number;
        viewportScale?: number;
      };
    }).__k8vCanvasDebug;
    return {
      x: Number(debug?.viewportX ?? Number.NaN),
      y: Number(debug?.viewportY ?? Number.NaN),
      scale: Number(debug?.viewportScale ?? Number.NaN),
    };
  });
}

async function waitForViewportTransform(
  page: import('playwright').Page,
  predicate: (transform: ViewportTransform) => boolean,
  timeoutMs = E2E_ASSERT_TIMEOUT_MS
): Promise<ViewportTransform> {
  const startedAt = Date.now();
  let lastTransform = await readViewportTransform(page);

  while ((Date.now() - startedAt) < timeoutMs) {
    if (predicate(lastTransform)) {
      return lastTransform;
    }

    await page.waitForTimeout(40);
    lastTransform = await readViewportTransform(page);
  }

  throw new Error(`Timed out waiting for viewport transform. Last value: ${JSON.stringify(lastTransform)}`);
}

function resolveNodeScreenRect(
  nodePosition: { x: number; y: number },
  viewportTransform: ViewportTransform,
  canvasBox: CanvasBox
): { x: number; y: number; width: number; height: number } {
  return {
    x: canvasBox.x + viewportTransform.x + (nodePosition.x * viewportTransform.scale),
    y: canvasBox.y + viewportTransform.y + (nodePosition.y * viewportTransform.scale),
    width: DEFAULT_NODE_WIDTH * viewportTransform.scale,
    height: DEFAULT_NODE_HEIGHT * viewportTransform.scale,
  };
}

async function dispatchCanvasWheel(
  page: import('playwright').Page,
  options: { x: number; y: number; deltaX: number; deltaY: number }
): Promise<void> {
  await page.evaluate(({ x, y, deltaX, deltaY }) => {
    const mainCanvas = document.querySelector('canvas');
    if (!(mainCanvas instanceof HTMLCanvasElement)) {
      throw new Error('Main canvas not found');
    }
    mainCanvas.dispatchEvent(new WheelEvent('wheel', {
      deltaX,
      deltaY,
      clientX: x,
      clientY: y,
      bubbles: true,
      cancelable: true,
    }));
  }, options);
}

test.before(async () => {
  await ensureE2EEnvironment();
});

test.after(async () => {
  await shutdownE2EEnvironment();
});

test(
  'inline-code cards use shared edge resize handles and persist size/position changes',
  { timeout: 90_000 },
  async () => {
    const { graphId, nodeId } = await createInlineCodeGraph({
      cardWidth: DEFAULT_NODE_WIDTH,
      cardHeight: DEFAULT_NODE_HEIGHT,
      code: 'outputs.output = inputs.input ?? 0;',
    });
    const initialPosition = await getNodePosition(graphId, nodeId);

    const browser = await launchBrowser();
    try {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
      });
      const page = await context.newPage();
      await openCanvasForGraph(page, graphId);
      await openSidebarSection(page, 'node');

      await page.waitForFunction(() => Boolean(window.__k8vGraphStore), {
        timeout: E2E_ASSERT_TIMEOUT_MS,
      });
      await page.evaluate((targetNodeId: string) => {
        window.__k8vGraphStore?.getState().selectNode(targetNodeId);
      }, nodeId);

      const canvas = page.locator('canvas').first();
      const canvasBox = await canvas.boundingBox();
      assert.ok(canvasBox, 'Canvas element should provide a bounding box');

      const nodeBox = resolveCenteredNodePosition(canvasBox);
      await page.locator('[data-testid="node-name-input"]').waitFor({
        state: 'visible',
        timeout: E2E_ASSERT_TIMEOUT_MS,
      });

      const leftHandle = await locateCursorPoint(page, {
        minX: Math.round(nodeBox.left - 16),
        maxX: Math.round(nodeBox.left + 18),
        minY: Math.round(nodeBox.centerY - 36),
        maxY: Math.round(nodeBox.centerY + 36),
      }, 'ew-resize');

      await page.mouse.down();
      await page.mouse.move(leftHandle.x - 72, leftHandle.y, { steps: 18 });
      await page.mouse.up();

      const widened = await waitForNodeCardSize(
        graphId,
        nodeId,
        (size) => (size.width ?? 0) >= 290,
        E2E_ASSERT_TIMEOUT_MS
      );
      const movedLeft = await waitForNodePosition(
        graphId,
        nodeId,
        (position) => position.x <= initialPosition.x - 40,
        E2E_ASSERT_TIMEOUT_MS
      );

      assert.ok((widened.width ?? 0) >= 290, `Expected width >= 290 after left resize. Received: ${widened.width}`);
      assert.ok(movedLeft.x <= initialPosition.x - 40, 'Expected node x to decrease after left resize.');

      const topHandle = await locateCursorPoint(page, {
        minX: Math.round(nodeBox.centerX - 84),
        maxX: Math.round(nodeBox.centerX + 36),
        minY: Math.round(nodeBox.top - 20),
        maxY: Math.round(nodeBox.centerY - 18),
      }, 'ns-resize');

      await page.mouse.move(topHandle.x, topHandle.y);
      await page.mouse.down();
      await page.mouse.move(topHandle.x, topHandle.y - 48, { steps: 16 });
      await page.mouse.up();

      const taller = await waitForNodeCardSize(
        graphId,
        nodeId,
        (size) => (size.height ?? 0) >= 150,
        E2E_ASSERT_TIMEOUT_MS
      );
      const movedUp = await waitForNodePosition(
        graphId,
        nodeId,
        (position) => position.y <= initialPosition.y - 24,
        E2E_ASSERT_TIMEOUT_MS
      );

      assert.ok((taller.height ?? 0) >= 150, `Expected height >= 150 after top resize. Received: ${taller.height}`);
      assert.ok(movedUp.y <= initialPosition.y - 24, 'Expected node y to decrease after top resize.');

      await context.close();
    } finally {
      await browser.close();
    }
  }
);

test(
  'resize handles stay outside the card and keep a constant screen offset across zoom',
  { timeout: 90_000 },
  async () => {
    const { graphId, nodeId } = await createInlineCodeGraph({
      cardWidth: DEFAULT_NODE_WIDTH,
      cardHeight: DEFAULT_NODE_HEIGHT,
      code: 'outputs.output = inputs.input ?? 0;',
    });
    const initialPosition = await getNodePosition(graphId, nodeId);

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
      await openSidebarSection(page, 'node');
      await page.waitForFunction(() => Boolean(window.__k8vGraphStore), {
        timeout: E2E_ASSERT_TIMEOUT_MS,
      });
      await page.evaluate((targetNodeId: string) => {
        window.__k8vGraphStore?.getState().selectNode(targetNodeId);
      }, nodeId);

      const canvas = page.locator('canvas').first();
      const canvasBox = await canvas.boundingBox() as CanvasBox | null;
      assert.ok(canvasBox, 'Canvas element should provide a bounding box');
      await page.locator('[data-testid="node-name-input"]').waitFor({
        state: 'visible',
        timeout: E2E_ASSERT_TIMEOUT_MS,
      });

      const initialViewportTransform = await waitForViewportTransform(
        page,
        (transform) => (
          Number.isFinite(transform.x) &&
          Number.isFinite(transform.y) &&
          Number.isFinite(transform.scale)
        )
      );
      const initialNodeRect = resolveNodeScreenRect(initialPosition, initialViewportTransform, canvasBox);
      const initialLeftHandle = {
        x: initialNodeRect.x - RESIZE_HANDLE_CENTER_OFFSET,
        y: initialNodeRect.y + (initialNodeRect.height * 0.5),
      };

      await waitForCursorAtPoint(page, initialLeftHandle.x, initialLeftHandle.y, 'ew-resize');

      const zoomAnchor = {
        x: initialNodeRect.x + (initialNodeRect.width * 0.5),
        y: initialNodeRect.y + (initialNodeRect.height * 0.5),
      };
      await dispatchCanvasWheel(page, {
        x: zoomAnchor.x,
        y: zoomAnchor.y,
        deltaX: 0,
        deltaY: 240,
      });

      const zoomedViewportTransform = await waitForViewportTransform(
        page,
        (transform) => (
          Number.isFinite(transform.scale) &&
          transform.scale < (initialViewportTransform.scale * 0.85)
        )
      );
      const zoomedNodeRect = resolveNodeScreenRect(initialPosition, zoomedViewportTransform, canvasBox);
      const zoomedLeftHandle = {
        x: zoomedNodeRect.x - RESIZE_HANDLE_CENTER_OFFSET,
        y: zoomedNodeRect.y + (zoomedNodeRect.height * 0.5),
      };

      await waitForCursorAtPoint(page, zoomedLeftHandle.x, zoomedLeftHandle.y, 'ew-resize');
      assert.ok(
        zoomedLeftHandle.x < (zoomedNodeRect.x - (NODE_RESIZE_HANDLE_SIZE * 0.5)),
        'Left handle center should remain outside the node bounds after zoom'
      );

      await context.close();
    } finally {
      await browser.close();
    }
  }
);
