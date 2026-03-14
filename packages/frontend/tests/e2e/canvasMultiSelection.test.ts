import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getNodeCardSize,
  getNodePosition,
  waitForNodeCardSize,
  waitForNodePosition,
} from './support/api.ts';
import { launchBrowser, openCanvasForGraph, waitForCursorAtPoint } from './support/browser.ts';
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

interface ContextMenuDispatchResult {
  defaultPrevented: boolean;
  dispatchResult: boolean;
}

async function createMultiNodeGraph(): Promise<{
  graphId: string;
  nodeIds: {
    left: string;
    middle: string;
    right: string;
  };
}>;
async function createMultiNodeGraph(options?: {
  withInternalConnection?: boolean;
}): Promise<{
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
      connections: options?.withInternalConnection
        ? [{
            id: crypto.randomUUID(),
            sourceNodeId: nodeIds.left,
            sourcePort: 'value',
            targetNodeId: nodeIds.middle,
            targetPort: 'value',
          }]
        : [],
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

async function getGraphSnapshot(graphId: string): Promise<{
  nodes: Array<{
    id: string;
    name: string;
    position: {
      x: number;
      y: number;
    };
  }>;
  connections: Array<{
    id: string;
    sourceNodeId: string;
    targetNodeId: string;
  }>;
}> {
  const response = await fetch(`${E2E_BACKEND_URL}/api/graphs/${graphId}`, {
    method: 'GET',
    headers: {
      accept: 'application/json',
    },
  });
  const graph = await response.json() as {
    nodes?: Array<{
      id?: string;
      position?: {
        x?: number;
        y?: number;
      };
      metadata?: {
        name?: string;
      };
    }>;
    connections?: Array<{
      id?: string;
      sourceNodeId?: string;
      targetNodeId?: string;
    }>;
  };
  assert.ok(response.ok, `Fetch graph failed (${response.status})`);

  return {
    nodes: Array.isArray(graph.nodes)
      ? graph.nodes.flatMap((node) => (
          typeof node.id === 'string' &&
          typeof node.position?.x === 'number' &&
          typeof node.position?.y === 'number'
            ? [{
                id: node.id,
                name: typeof node.metadata?.name === 'string' ? node.metadata.name : node.id,
                position: {
                  x: node.position.x,
                  y: node.position.y,
                },
              }]
            : []
        ))
      : [],
    connections: Array.isArray(graph.connections)
      ? graph.connections.flatMap((connection) => (
          typeof connection.id === 'string' &&
          typeof connection.sourceNodeId === 'string' &&
          typeof connection.targetNodeId === 'string'
            ? [{
                id: connection.id,
                sourceNodeId: connection.sourceNodeId,
                targetNodeId: connection.targetNodeId,
              }]
            : []
        ))
      : [],
  };
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

async function waitForSelectedNodeIds(
  page: import('playwright').Page,
  predicate: (selectedNodeIds: string[]) => boolean,
  timeoutMs = E2E_ASSERT_TIMEOUT_MS
): Promise<string[]> {
  const startedAt = Date.now();
  let lastSelectedNodeIds = await readSelectedNodeIds(page);

  while ((Date.now() - startedAt) < timeoutMs) {
    lastSelectedNodeIds = await readSelectedNodeIds(page);
    if (predicate(lastSelectedNodeIds)) {
      return lastSelectedNodeIds;
    }
    await page.waitForTimeout(60);
  }

  throw new Error(
    `Timed out waiting for selected node ids. Last value: ${JSON.stringify(lastSelectedNodeIds)}`
  );
}

async function retryCtrlClickUntilSelectionMatches(
  page: import('playwright').Page,
  point: { x: number; y: number },
  predicate: (selectedNodeIds: string[]) => boolean,
  timeoutMs = E2E_ASSERT_TIMEOUT_MS
): Promise<string[]> {
  const startedAt = Date.now();
  let lastSelectedNodeIds = await readSelectedNodeIds(page);

  while ((Date.now() - startedAt) < timeoutMs) {
    await page.keyboard.down('Control');
    await page.mouse.click(point.x, point.y);
    await page.keyboard.up('Control');

    try {
      return await waitForSelectedNodeIds(page, predicate, 250);
    } catch {
      lastSelectedNodeIds = await readSelectedNodeIds(page);
      await page.waitForTimeout(60);
    }
  }

  throw new Error(
    `Timed out retrying ctrl-click selection. Last value: ${JSON.stringify(lastSelectedNodeIds)}`
  );
}

async function dispatchCanvasContextMenu(
  page: import('playwright').Page
): Promise<ContextMenuDispatchResult> {
  return page.locator('canvas').first().evaluate((canvasElement) => {
    const event = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      button: 0,
    });
    const dispatchResult = canvasElement.dispatchEvent(event);
    return {
      defaultPrevented: event.defaultPrevented,
      dispatchResult,
    };
  });
}

function sortNodeIds(nodeIds: string[]): string[] {
  return [...nodeIds].sort((left, right) => left.localeCompare(right));
}

function approxEqual(left: number, right: number, tolerance: number): boolean {
  return Math.abs(left - right) <= tolerance;
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
      const contextMenuDispatchResult = await dispatchCanvasContextMenu(page);
      assert.equal(
        contextMenuDispatchResult.defaultPrevented,
        true,
        'Canvas should prevent the browser context menu during ctrl-click selection gestures'
      );
      assert.equal(
        contextMenuDispatchResult.dispatchResult,
        false,
        'Prevented canvas contextmenu events should report a canceled default action'
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

      const afterMarqueeSelection = await waitForSelectedNodeIds(
        page,
        (selectedNodeIds) => (
          sortNodeIds(selectedNodeIds).join(',') === sortNodeIds([nodeIds.left, nodeIds.middle]).join(',')
        )
      );
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

      const afterCtrlToggle = await retryCtrlClickUntilSelectionMatches(
        page,
        {
          x: middleRect.x + (middleRect.width * 0.5),
          y: middleRect.y + (middleRect.height * 0.5),
        },
        (selectedNodeIds) => selectedNodeIds.length === 1 && selectedNodeIds[0] === nodeIds.left
      );
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
      const afterCtrlDragAdd = await waitForSelectedNodeIds(
        page,
        (selectedNodeIds) => (
          sortNodeIds(selectedNodeIds).join(',') === sortNodeIds([nodeIds.left, nodeIds.middle]).join(',')
        )
      );
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
      await waitForCursorAtPoint(
        page,
        sharedResizeHandle.x,
        sharedResizeHandle.y,
        'nwse-resize'
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

test(
  'alt-dragging a selected node set duplicates the nodes and their internal links',
  { timeout: 150_000 },
  async () => {
    const { graphId, nodeIds } = await createMultiNodeGraph({ withInternalConnection: true });
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

      const viewportTransform = await waitForViewportTransform(page, (transform) =>
        Number.isFinite(transform.x) &&
        Number.isFinite(transform.y) &&
        Number.isFinite(transform.scale)
      );
      const leftRect = await resolveNodeScreenRect(graphId, nodeIds.left, viewportTransform, canvasBox);
      const middleRect = await resolveNodeScreenRect(graphId, nodeIds.middle, viewportTransform, canvasBox);

      await page.mouse.move(leftRect.x - 20, leftRect.y - 20);
      await page.mouse.down();
      await page.mouse.move(
        middleRect.x + middleRect.width + 20,
        middleRect.y + middleRect.height + 20,
        { steps: 16 }
      );
      await page.mouse.up();

      const selectedBeforeDuplicate = await readSelectedNodeIds(page);
      assert.deepEqual(
        sortNodeIds(selectedBeforeDuplicate),
        sortNodeIds([nodeIds.left, nodeIds.middle]),
        'Expected marquee selection before Alt-drag duplication'
      );

      const leftPositionBeforeDuplicate = await getNodePosition(graphId, nodeIds.left);
      const middlePositionBeforeDuplicate = await getNodePosition(graphId, nodeIds.middle);
      const dragDelta = { x: 144, y: 108 };

      await page.keyboard.down('Alt');
      await page.mouse.move(
        leftRect.x + (leftRect.width * 0.5),
        leftRect.y + (leftRect.height * 0.5)
      );
      await page.mouse.down();
      await page.mouse.move(
        leftRect.x + (leftRect.width * 0.5) + dragDelta.x,
        leftRect.y + (leftRect.height * 0.5) + dragDelta.y,
        { steps: 18 }
      );
      await page.mouse.up();
      await page.keyboard.up('Alt');

      const duplicatedNodeIds = await waitForGraphNodeIds(
        graphId,
        (ids) => ids.length === 5
      );
      assert.equal(duplicatedNodeIds.length, 5, 'Alt-drag should persist two duplicate nodes');

      const selectedAfterDuplicate = await readSelectedNodeIds(page);
      assert.equal(selectedAfterDuplicate.length, 2, 'The duplicated set should remain selected after Alt-drag');
      assert.ok(
        selectedAfterDuplicate.every((selectedNodeId) =>
          selectedNodeId !== nodeIds.left &&
          selectedNodeId !== nodeIds.middle &&
          selectedNodeId !== nodeIds.right
        ),
        'Alt-drag selection should switch to the new duplicate node ids'
      );

      const graphSnapshot = await getGraphSnapshot(graphId);
      const duplicateNodes = graphSnapshot.nodes.filter((node) =>
        node.id !== nodeIds.left &&
        node.id !== nodeIds.middle &&
        node.id !== nodeIds.right
      );
      assert.equal(duplicateNodes.length, 2, 'Expected exactly two duplicated nodes');
      const duplicateLeftNode = duplicateNodes.find((node) => node.name === 'Left Numeric');
      const duplicateMiddleNode = duplicateNodes.find((node) => node.name === 'Middle Numeric');
      assert.ok(duplicateLeftNode, 'Expected duplicated Left Numeric node');
      assert.ok(duplicateMiddleNode, 'Expected duplicated Middle Numeric node');
      assert.deepEqual(
        sortNodeIds(selectedAfterDuplicate),
        sortNodeIds([duplicateLeftNode.id, duplicateMiddleNode.id]),
        'The duplicate nodes should be the active selection after Alt-drag'
      );

      const leftPositionAfterDuplicate = await getNodePosition(graphId, nodeIds.left);
      const middlePositionAfterDuplicate = await getNodePosition(graphId, nodeIds.middle);
      assert.ok(
        approxEqual(leftPositionAfterDuplicate.x, leftPositionBeforeDuplicate.x, 1.5) &&
        approxEqual(leftPositionAfterDuplicate.y, leftPositionBeforeDuplicate.y, 1.5) &&
        approxEqual(middlePositionAfterDuplicate.x, middlePositionBeforeDuplicate.x, 1.5) &&
        approxEqual(middlePositionAfterDuplicate.y, middlePositionBeforeDuplicate.y, 1.5),
        'Alt-drag should leave the original selected nodes in place'
      );
      assert.ok(
        approxEqual(duplicateLeftNode.position.x - leftPositionBeforeDuplicate.x, dragDelta.x, 1.5) &&
        approxEqual(duplicateLeftNode.position.y - leftPositionBeforeDuplicate.y, dragDelta.y, 1.5) &&
        approxEqual(duplicateMiddleNode.position.x - middlePositionBeforeDuplicate.x, dragDelta.x, 1.5) &&
        approxEqual(duplicateMiddleNode.position.y - middlePositionBeforeDuplicate.y, dragDelta.y, 1.5),
        'Duplicate nodes should follow the Alt-drag delta'
      );
      assert.ok(
        graphSnapshot.connections.some((connection) =>
          connection.sourceNodeId === duplicateLeftNode.id &&
          connection.targetNodeId === duplicateMiddleNode.id
        ),
        'Internal links between duplicated nodes should be copied to the duplicate set'
      );

      await context.close();
    } finally {
      await browser.close();
    }
  }
);
