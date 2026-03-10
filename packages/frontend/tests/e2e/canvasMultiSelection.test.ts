import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getNodeCardSize,
  getNodePosition,
  waitForNodeCardSize,
  waitForNodePosition,
} from './support/api.ts';
import { launchBrowser, openCanvasForGraph, readCanvasCursor } from './support/browser.ts';
import { E2E_ASSERT_TIMEOUT_MS, E2E_BACKEND_URL } from './support/config.ts';
import { ensureE2EEnvironment, shutdownE2EEnvironment } from './support/environment.ts';

const DEFAULT_NUMERIC_NODE_WIDTH = 220;
const DEFAULT_NUMERIC_NODE_HEIGHT = 80;

interface CanvasBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ViewportTransform {
  x: number;
  y: number;
  scale: number;
}

async function createMultiNodeGraph(): Promise<{
  graphId: string;
  nodeIds: {
    left: string;
    middle: string;
    right: string;
  };
}> {
  const nodeIds = {
    left: crypto.randomUUID(),
    middle: crypto.randomUUID(),
    right: crypto.randomUUID(),
  };
  const makeNode = (
    id: string,
    name: string,
    position: { x: number; y: number }
  ) => ({
    id,
    type: 'numeric_input',
    position,
    metadata: {
      name,
      inputs: [],
      outputs: [{ name: 'value', schema: { type: 'number' } }],
    },
    config: {
      type: 'numeric_input',
      config: {
        value: 0,
        min: 0,
        max: 100,
        step: 1,
      },
    },
    version: `${Date.now()}`,
  });

  const response = await fetch(`${E2E_BACKEND_URL}/api/graphs`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      name: `autotests_e2e_multi_select_${Date.now()}`,
      nodes: [
        makeNode(nodeIds.left, 'Left Numeric', { x: 120, y: 140 }),
        makeNode(nodeIds.middle, 'Middle Numeric', { x: 430, y: 160 }),
        makeNode(nodeIds.right, 'Right Numeric', { x: 820, y: 260 }),
      ],
      connections: [],
      drawings: [],
    }),
  });
  const graph = await response.json() as { id?: string };
  assert.ok(response.ok, `Create graph failed (${response.status})`);
  assert.ok(graph.id, 'Create graph response should include graph id');
  return {
    graphId: graph.id,
    nodeIds,
  };
}

async function getGraphNodeIds(graphId: string): Promise<string[]> {
  const response = await fetch(`${E2E_BACKEND_URL}/api/graphs/${graphId}`, {
    method: 'GET',
    headers: {
      accept: 'application/json',
    },
  });
  const graph = await response.json() as { nodes?: Array<{ id?: string }> };
  assert.ok(response.ok, `Fetch graph failed (${response.status})`);
  return Array.isArray(graph.nodes)
    ? graph.nodes.flatMap((node) => (typeof node.id === 'string' ? [node.id] : []))
    : [];
}

async function waitForGraphNodeIds(
  graphId: string,
  predicate: (nodeIds: string[]) => boolean,
  timeoutMs = E2E_ASSERT_TIMEOUT_MS
): Promise<string[]> {
  const startedAt = Date.now();
  let lastNodeIds: string[] = [];

  while ((Date.now() - startedAt) < timeoutMs) {
    lastNodeIds = await getGraphNodeIds(graphId);
    if (predicate(lastNodeIds)) {
      return lastNodeIds;
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }

  throw new Error(`Timed out waiting for graph node ids. Last value: ${JSON.stringify(lastNodeIds)}`);
}

async function readViewportTransform(page: import('playwright').Page): Promise<ViewportTransform> {
  return page.evaluate(() => {
    const debugCounters = (window as Window & {
      __k8vCanvasDebug?: {
        viewportX?: unknown;
        viewportY?: unknown;
        viewportScale?: unknown;
      };
    }).__k8vCanvasDebug;
    return {
      x: typeof debugCounters?.viewportX === 'number' ? debugCounters.viewportX : Number.NaN,
      y: typeof debugCounters?.viewportY === 'number' ? debugCounters.viewportY : Number.NaN,
      scale: typeof debugCounters?.viewportScale === 'number' ? debugCounters.viewportScale : Number.NaN,
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
    lastTransform = await readViewportTransform(page);
    if (predicate(lastTransform)) {
      return lastTransform;
    }
    await page.waitForTimeout(60);
  }

  throw new Error(`Timed out waiting for viewport transform. Last value: ${JSON.stringify(lastTransform)}`);
}

async function readSelectedNodeIds(page: import('playwright').Page): Promise<string[]> {
  return page.evaluate(() => {
    const state = (window as Window & {
      __k8vGraphStore?: {
        getState: () => {
          selectedNodeIds?: unknown;
        };
      };
    }).__k8vGraphStore?.getState();
    const selectedNodeIds = state?.selectedNodeIds;
    return Array.isArray(selectedNodeIds)
      ? selectedNodeIds.filter((nodeId): nodeId is string => typeof nodeId === 'string')
      : [];
  });
}

function sortNodeIds(nodeIds: string[]): string[] {
  return [...nodeIds].sort((left, right) => left.localeCompare(right));
}

function approxEqual(left: number, right: number, tolerance: number): boolean {
  return Math.abs(left - right) <= tolerance;
}

async function readCursorAtPoint(
  page: import('playwright').Page,
  point: { x: number; y: number }
): Promise<string> {
  await page.mouse.move(point.x, point.y);
  return readCanvasCursor(page);
}

async function resolveNodeScreenRect(
  graphId: string,
  nodeId: string,
  viewportTransform: ViewportTransform,
  canvasBox: CanvasBox
): Promise<{ x: number; y: number; width: number; height: number }> {
  const [position, size] = await Promise.all([
    getNodePosition(graphId, nodeId),
    getNodeCardSize(graphId, nodeId),
  ]);
  const width = (size.width ?? DEFAULT_NUMERIC_NODE_WIDTH) * viewportTransform.scale;
  const height = (size.height ?? DEFAULT_NUMERIC_NODE_HEIGHT) * viewportTransform.scale;
  return {
    x: canvasBox.x + viewportTransform.x + (position.x * viewportTransform.scale),
    y: canvasBox.y + viewportTransform.y + (position.y * viewportTransform.scale),
    width,
    height,
  };
}

async function resolveSelectionScreenBounds(
  graphId: string,
  nodeIds: string[],
  viewportTransform: ViewportTransform,
  canvasBox: CanvasBox
): Promise<{ x: number; y: number; width: number; height: number }> {
  const nodeRects = await Promise.all(nodeIds.map((nodeId) =>
    resolveNodeScreenRect(graphId, nodeId, viewportTransform, canvasBox)
  ));
  const minX = Math.min(...nodeRects.map((rect) => rect.x));
  const minY = Math.min(...nodeRects.map((rect) => rect.y));
  const maxX = Math.max(...nodeRects.map((rect) => rect.x + rect.width));
  const maxY = Math.max(...nodeRects.map((rect) => rect.y + rect.height));
  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

test.before(async () => {
  await ensureE2EEnvironment();
});

test.after(async () => {
  await shutdownE2EEnvironment();
});

test(
  'canvas multi-selection supports marquee selection, ctrl toggle/add, shared resize/delete, and space pan',
  { timeout: 150_000 },
  async () => {
    const { graphId, nodeIds } = await createMultiNodeGraph();
    const browser = await launchBrowser();

    try {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 1,
      });
      const page = await context.newPage();
      await page.addInitScript(() => {
        (window as Window & {
          __k8vCanvasDebug?: Record<string, unknown>;
        }).__k8vCanvasDebug = {};
      });
      await openCanvasForGraph(page, graphId);

      const canvas = page.locator('canvas').first();
      const canvasBox = await canvas.boundingBox() as CanvasBox | null;
      assert.ok(canvasBox, 'Canvas should provide a bounding box');

      const initialViewportTransform = await waitForViewportTransform(page, (transform) =>
        Number.isFinite(transform.x) &&
        Number.isFinite(transform.y) &&
        Number.isFinite(transform.scale)
      );
      const leftRect = await resolveNodeScreenRect(graphId, nodeIds.left, initialViewportTransform, canvasBox);
      const middleRect = await resolveNodeScreenRect(graphId, nodeIds.middle, initialViewportTransform, canvasBox);

      await page.mouse.move(leftRect.x - 20, leftRect.y - 20);
      await page.mouse.down();
      await page.mouse.move(
        middleRect.x + middleRect.width + 20,
        middleRect.y + middleRect.height + 20,
        { steps: 16 }
      );
      await page.mouse.up();

      await page.waitForTimeout(200);
      const afterMarqueeSelection = await readSelectedNodeIds(page);
      assert.deepEqual(
        sortNodeIds(afterMarqueeSelection),
        sortNodeIds([nodeIds.left, nodeIds.middle]),
        'Marquee selection should select the intersecting nodes'
      );
      const viewportAfterMarqueeSelection = await waitForViewportTransform(page, () => true);
      assert.ok(
        approxEqual(initialViewportTransform.x, viewportAfterMarqueeSelection.x, 1.5) &&
        approxEqual(initialViewportTransform.y, viewportAfterMarqueeSelection.y, 1.5) &&
        approxEqual(initialViewportTransform.scale, viewportAfterMarqueeSelection.scale, 0.001),
        `Empty-space drag without space should not pan viewport. Before=${JSON.stringify(initialViewportTransform)} After=${JSON.stringify(viewportAfterMarqueeSelection)}`
      );

      await page.keyboard.down('Control');
      await page.mouse.click(
        middleRect.x + (middleRect.width * 0.5),
        middleRect.y + (middleRect.height * 0.5)
      );
      await page.keyboard.up('Control');
      await page.waitForTimeout(200);
      const afterCtrlToggle = await readSelectedNodeIds(page);
      assert.deepEqual(afterCtrlToggle, [nodeIds.left], 'Ctrl-click should toggle a node out of the selection');

      await page.keyboard.down('Control');
      await page.mouse.move(middleRect.x - 20, middleRect.y - 20);
      await page.mouse.down();
      await page.mouse.move(
        middleRect.x + middleRect.width + 20,
        middleRect.y + middleRect.height + 20,
        { steps: 12 }
      );
      await page.mouse.up();
      await page.keyboard.up('Control');
      await page.waitForTimeout(200);
      const afterCtrlDragAdd = await readSelectedNodeIds(page);
      assert.deepEqual(
        sortNodeIds(afterCtrlDragAdd),
        sortNodeIds([nodeIds.left, nodeIds.middle]),
        'Ctrl-drag marquee should add newly intersected nodes to the selection'
      );

      const selectionBoundsBeforeResize = await resolveSelectionScreenBounds(
        graphId,
        [nodeIds.left, nodeIds.middle],
        viewportAfterMarqueeSelection,
        canvasBox
      );
      const sharedResizeHandle = {
        x: selectionBoundsBeforeResize.x + selectionBoundsBeforeResize.width,
        y: selectionBoundsBeforeResize.y + selectionBoundsBeforeResize.height,
      };
      const sharedHandleCursor = await readCursorAtPoint(page, sharedResizeHandle);
      assert.equal(
        sharedHandleCursor,
        'nwse-resize',
        'Shared selection should expose a resize handle'
      );

      await page.mouse.move(sharedResizeHandle.x, sharedResizeHandle.y);
      await page.mouse.down();
      await page.mouse.move(sharedResizeHandle.x + 80, sharedResizeHandle.y + 42, { steps: 18 });
      await page.mouse.up();

      const leftResized = await waitForNodeCardSize(
        graphId,
        nodeIds.left,
        (size) => (size.width ?? 0) >= 245 && (size.height ?? 0) >= 100
      );
      const middleResized = await waitForNodeCardSize(
        graphId,
        nodeIds.middle,
        (size) => (size.width ?? 0) >= 245 && (size.height ?? 0) >= 100
      );
      assert.ok((leftResized.width ?? 0) >= 245);
      assert.ok((middleResized.width ?? 0) >= 245);

      const leftPositionBeforeMove = await getNodePosition(graphId, nodeIds.left);
      const middlePositionBeforeMove = await getNodePosition(graphId, nodeIds.middle);
      await page.mouse.move(
        leftRect.x + (leftRect.width * 0.5),
        leftRect.y + (leftRect.height * 0.5)
      );
      await page.mouse.down();
      await page.mouse.move(
        leftRect.x + (leftRect.width * 0.5) + 96,
        leftRect.y + (leftRect.height * 0.5) + 64,
        { steps: 14 }
      );
      await page.mouse.up();

      const leftPositionAfterMove = await waitForNodePosition(
        graphId,
        nodeIds.left,
        (position) => position.x > (leftPositionBeforeMove.x + 40) && position.y > (leftPositionBeforeMove.y + 20)
      );
      const middlePositionAfterMove = await waitForNodePosition(
        graphId,
        nodeIds.middle,
        (position) => position.x > (middlePositionBeforeMove.x + 40) && position.y > (middlePositionBeforeMove.y + 20)
      );
      assert.ok(
        approxEqual(
          leftPositionAfterMove.x - leftPositionBeforeMove.x,
          middlePositionAfterMove.x - middlePositionBeforeMove.x,
          1.5
        ) &&
        approxEqual(
          leftPositionAfterMove.y - leftPositionBeforeMove.y,
          middlePositionAfterMove.y - middlePositionBeforeMove.y,
          1.5
        ),
        'Dragging one selected node should move the full selection together'
      );

      const viewportBeforePan = await waitForViewportTransform(page, () => true);
      const rightRectBeforePan = await resolveNodeScreenRect(graphId, nodeIds.right, viewportBeforePan, canvasBox);
      const panStartPoint = {
        x: canvasBox.x + 280,
        y: canvasBox.y + 80,
      };
      const panDelta = {
        x: 160,
        y: 100,
      };

      await page.keyboard.down('Space');
      await page.mouse.move(panStartPoint.x, panStartPoint.y);
      await page.mouse.down();
      await page.mouse.move(panStartPoint.x + panDelta.x, panStartPoint.y + panDelta.y, { steps: 16 });
      await page.mouse.up();
      await page.keyboard.up('Space');

      const viewportAfterPan = await waitForViewportTransform(page, (transform) =>
        Math.abs(transform.x - viewportBeforePan.x) > 3 || Math.abs(transform.y - viewportBeforePan.y) > 3
      );
      assert.ok(
        approxEqual(viewportAfterPan.x - viewportBeforePan.x, panDelta.x, 2) &&
        approxEqual(viewportAfterPan.y - viewportBeforePan.y, panDelta.y, 2),
        `Space-drag should pan viewport. Before=${JSON.stringify(viewportBeforePan)} After=${JSON.stringify(viewportAfterPan)}`
      );
      const rightRectAfterPan = await resolveNodeScreenRect(graphId, nodeIds.right, viewportAfterPan, canvasBox);
      assert.ok(
        approxEqual(rightRectAfterPan.x - rightRectBeforePan.x, panDelta.x, 2) &&
        approxEqual(rightRectAfterPan.y - rightRectBeforePan.y, panDelta.y, 2),
        'Space-drag should move node screen positions with the viewport'
      );

      await canvas.evaluate((canvasElement) => {
        (canvasElement as HTMLCanvasElement).focus();
      });
      await page.keyboard.press('Delete');

      const remainingNodeIds = await waitForGraphNodeIds(
        graphId,
        (ids) => ids.length === 1 && ids[0] === nodeIds.right
      );
      assert.deepEqual(remainingNodeIds, [nodeIds.right]);

      await context.close();
    } finally {
      await browser.close();
    }
  }
);
