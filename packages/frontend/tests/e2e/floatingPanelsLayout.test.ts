import assert from 'node:assert/strict';
import test from 'node:test';
import type { Page } from 'playwright';
import { createEmptyGraph } from './support/api.ts';
import { launchBrowser, openCanvasForGraph } from './support/browser.ts';
import { E2E_ASSERT_TIMEOUT_MS } from './support/config.ts';
import { ensureE2EEnvironment, shutdownE2EEnvironment } from './support/environment.ts';

interface ViewportTransform {
  x: number;
  y: number;
  scale: number;
}

async function assertCanvasMatchesViewport(page: Page): Promise<void> {
  const viewport = page.viewportSize();
  assert.ok(viewport, 'Expected page viewport to be set');
  const canvas = page.locator('canvas').first();
  const canvasBox = await canvas.boundingBox();
  assert.ok(canvasBox, 'Expected canvas to be measurable');
  assert.ok(Math.abs(canvasBox.x) <= 1.5, `Expected canvas x near 0, got ${canvasBox.x}`);
  assert.ok(Math.abs(canvasBox.y) <= 1.5, `Expected canvas y near 0, got ${canvasBox.y}`);
  assert.ok(
    Math.abs(canvasBox.width - viewport.width) <= 2,
    `Expected canvas width ${viewport.width}, got ${canvasBox.width}`
  );
  assert.ok(
    Math.abs(canvasBox.height - viewport.height) <= 2,
    `Expected canvas height ${viewport.height}, got ${canvasBox.height}`
  );
}

async function reloadCanvasForGraph(page: Page, graphId: string): Promise<void> {
  const graphLoadResponse = page.waitForResponse((response) =>
    response.request().method() === 'GET' &&
    response.url().endsWith(`/api/graphs/${graphId}`) &&
    response.ok()
  , {
    timeout: E2E_ASSERT_TIMEOUT_MS,
  });

  await page.reload({
    waitUntil: 'domcontentloaded',
    timeout: E2E_ASSERT_TIMEOUT_MS,
  });
  await page.locator('canvas').first().waitFor({
    state: 'visible',
    timeout: E2E_ASSERT_TIMEOUT_MS,
  });
  await graphLoadResponse;
  await page.locator('[data-testid="graph-select"]').first().waitFor({
    state: 'visible',
    timeout: E2E_ASSERT_TIMEOUT_MS,
  });
  await page.waitForFunction((expectedGraphId: string) => {
    const graphSelect = document.querySelector('[data-testid="graph-select"]');
    return graphSelect instanceof HTMLSelectElement && graphSelect.value === expectedGraphId;
  }, graphId, {
    timeout: E2E_ASSERT_TIMEOUT_MS,
  });
}

async function readViewportTransform(page: Page): Promise<ViewportTransform> {
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
  page: Page,
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

function approxEqual(left: number, right: number, tolerance: number): boolean {
  return Math.abs(left - right) <= tolerance;
}

async function dispatchCanvasWheel(
  page: Page,
  options: {
    x: number;
    y: number;
    deltaX?: number;
    deltaY: number;
    ctrlKey?: boolean;
  }
): Promise<void> {
  await page.evaluate((eventOptions) => {
    const mainCanvas = document.querySelector('canvas');
    if (!(mainCanvas instanceof HTMLCanvasElement)) {
      throw new Error('Main canvas not found');
    }
    mainCanvas.dispatchEvent(new WheelEvent('wheel', {
      deltaX: eventOptions.deltaX ?? 0,
      deltaY: eventOptions.deltaY,
      ctrlKey: eventOptions.ctrlKey ?? false,
      clientX: eventOptions.x,
      clientY: eventOptions.y,
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
  'canvas stays full-viewport while floating panels remain draggable across resize',
  { timeout: 90_000 },
  async () => {
    const { graphId } = await createEmptyGraph('E2E Floating Panels');
    const browser = await launchBrowser();
    try {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
      });
      const page = await context.newPage();
      await openCanvasForGraph(page, graphId);

      await page.locator('[data-testid="floating-window-right-sidebar"]').waitFor({
        state: 'visible',
        timeout: E2E_ASSERT_TIMEOUT_MS,
      });

      await assertCanvasMatchesViewport(page);

      const sidebarWindow = page.locator('[data-testid="floating-window-right-sidebar"]');
      const dragHandle = page.locator('[data-testid="floating-window-drag-right-sidebar"]');
      const beforeDrag = await sidebarWindow.boundingBox();
      const dragHandleBox = await dragHandle.boundingBox();
      assert.ok(beforeDrag, 'Expected sidebar floating window bounds');
      assert.ok(dragHandleBox, 'Expected sidebar drag-handle bounds');

      const startX = dragHandleBox.x + (dragHandleBox.width / 2);
      const startY = dragHandleBox.y + (dragHandleBox.height / 2);
      await page.mouse.move(startX, startY);
      await page.mouse.down();
      await page.mouse.move(startX - 180, startY + 120, { steps: 14 });
      await page.mouse.up();
      await page.waitForTimeout(120);

      const afterDrag = await sidebarWindow.boundingBox();
      assert.ok(afterDrag, 'Expected sidebar floating window bounds after drag');
      assert.ok(Math.abs(afterDrag.x - beforeDrag.x) >= 120, 'Expected sidebar window to move horizontally');
      assert.ok(Math.abs(afterDrag.y - beforeDrag.y) >= 20, 'Expected sidebar window to move vertically');

      await page.setViewportSize({ width: 1060, height: 700 });
      await page.waitForTimeout(180);

      await assertCanvasMatchesViewport(page);

      const viewport = page.viewportSize();
      assert.ok(viewport, 'Expected resized page viewport');
      const sidebarAfterResize = await sidebarWindow.boundingBox();
      const toolbarAfterResize = await page.locator('[data-testid="floating-window-toolbar"]').boundingBox();
      assert.ok(sidebarAfterResize, 'Expected sidebar window bounds after resize');
      assert.ok(toolbarAfterResize, 'Expected toolbar window bounds after resize');

      assert.ok(sidebarAfterResize.x >= -1, `Expected sidebar x in viewport, got ${sidebarAfterResize.x}`);
      assert.ok(sidebarAfterResize.y >= -1, `Expected sidebar y in viewport, got ${sidebarAfterResize.y}`);
      assert.ok(
        (sidebarAfterResize.x + sidebarAfterResize.width) <= (viewport.width + 1),
        'Expected sidebar right edge to stay in viewport after resize'
      );
      assert.ok(
        (sidebarAfterResize.y + sidebarAfterResize.height) <= (viewport.height + 1),
        'Expected sidebar bottom edge to stay in viewport after resize'
      );
      assert.ok(toolbarAfterResize.x >= -1, `Expected toolbar x in viewport, got ${toolbarAfterResize.x}`);
      assert.ok(toolbarAfterResize.y >= -1, `Expected toolbar y in viewport, got ${toolbarAfterResize.y}`);

      await context.close();
    } finally {
      await browser.close();
    }
  }
);

test(
  'floating window positions and viewport navigation persist across page refresh',
  { timeout: 90_000 },
  async () => {
    const { graphId } = await createEmptyGraph('E2E Refresh Persistence');
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

      const sidebarWindow = page.locator('[data-testid="floating-window-right-sidebar"]');
      const toolbarWindow = page.locator('[data-testid="floating-window-toolbar"]');
      const sidebarDragHandle = page.locator('[data-testid="floating-window-drag-right-sidebar"]');
      const toolbarDragHandle = page.locator('[data-testid="floating-window-drag-toolbar"]');
      const canvas = page.locator('canvas').first();
      const canvasBox = await canvas.boundingBox();
      assert.ok(canvasBox, 'Expected canvas bounds for viewport interaction test');

      const initialViewport = await waitForViewportTransform(page, (transform) =>
        Number.isFinite(transform.x) &&
        Number.isFinite(transform.y) &&
        Number.isFinite(transform.scale)
      );

      const sidebarHandleBox = await sidebarDragHandle.boundingBox();
      assert.ok(sidebarHandleBox, 'Expected sidebar drag handle bounds');
      await page.mouse.move(
        sidebarHandleBox.x + (sidebarHandleBox.width / 2),
        sidebarHandleBox.y + (sidebarHandleBox.height / 2)
      );
      await page.mouse.down();
      await page.mouse.move(
        sidebarHandleBox.x + (sidebarHandleBox.width / 2) - 170,
        sidebarHandleBox.y + (sidebarHandleBox.height / 2) + 115,
        { steps: 16 }
      );
      await page.mouse.up();

      const toolbarHandleBox = await toolbarDragHandle.boundingBox();
      assert.ok(toolbarHandleBox, 'Expected toolbar drag handle bounds');
      await page.mouse.move(
        toolbarHandleBox.x + (toolbarHandleBox.width / 2),
        toolbarHandleBox.y + (toolbarHandleBox.height / 2)
      );
      await page.mouse.down();
      await page.mouse.move(
        toolbarHandleBox.x + (toolbarHandleBox.width / 2) + 135,
        toolbarHandleBox.y + (toolbarHandleBox.height / 2) + 96,
        { steps: 16 }
      );
      await page.mouse.up();

      const sidebarBeforeReload = await sidebarWindow.boundingBox();
      const toolbarBeforeReload = await toolbarWindow.boundingBox();
      assert.ok(sidebarBeforeReload, 'Expected sidebar bounds after drag');
      assert.ok(toolbarBeforeReload, 'Expected toolbar bounds after drag');

      await page.mouse.move(
        canvasBox.x + (canvasBox.width * 0.62),
        canvasBox.y + (canvasBox.height * 0.48)
      );
      await dispatchCanvasWheel(page, {
        x: canvasBox.x + (canvasBox.width * 0.62),
        y: canvasBox.y + (canvasBox.height * 0.48),
        deltaY: -90,
      });

      const zoomedViewport = await waitForViewportTransform(page, (transform) =>
        transform.scale > (initialViewport.scale + 0.05)
      );

      const panStartPoint = {
        x: canvasBox.x + 320,
        y: canvasBox.y + 220,
      };
      const panDelta = {
        x: 150,
        y: 92,
      };

      await page.keyboard.down('Space');
      await page.mouse.move(panStartPoint.x, panStartPoint.y);
      await page.mouse.down();
      await page.mouse.move(
        panStartPoint.x + panDelta.x,
        panStartPoint.y + panDelta.y,
        { steps: 16 }
      );
      await page.mouse.up();
      await page.keyboard.up('Space');

      const viewportBeforeReload = await waitForViewportTransform(page, (transform) =>
        Math.abs(transform.x - zoomedViewport.x) > 3 || Math.abs(transform.y - zoomedViewport.y) > 3
      );

      assert.ok(
        approxEqual(viewportBeforeReload.x - zoomedViewport.x, panDelta.x, 3) &&
        approxEqual(viewportBeforeReload.y - zoomedViewport.y, panDelta.y, 3),
        `Expected pan delta to match drag. Before=${JSON.stringify(zoomedViewport)} After=${JSON.stringify(viewportBeforeReload)}`
      );

      await page.waitForTimeout(180);
      await reloadCanvasForGraph(page, graphId);

      const sidebarAfterReload = await sidebarWindow.boundingBox();
      const toolbarAfterReload = await toolbarWindow.boundingBox();
      assert.ok(sidebarAfterReload, 'Expected sidebar bounds after reload');
      assert.ok(toolbarAfterReload, 'Expected toolbar bounds after reload');

      assert.ok(
        approxEqual(sidebarAfterReload.x, sidebarBeforeReload.x, 2) &&
        approxEqual(sidebarAfterReload.y, sidebarBeforeReload.y, 2),
        `Expected sidebar window to restore after reload. Before=${JSON.stringify(sidebarBeforeReload)} After=${JSON.stringify(sidebarAfterReload)}`
      );
      assert.ok(
        approxEqual(toolbarAfterReload.x, toolbarBeforeReload.x, 2) &&
        approxEqual(toolbarAfterReload.y, toolbarBeforeReload.y, 2),
        `Expected toolbar window to restore after reload. Before=${JSON.stringify(toolbarBeforeReload)} After=${JSON.stringify(toolbarAfterReload)}`
      );

      const viewportAfterReload = await waitForViewportTransform(page, (transform) =>
        Number.isFinite(transform.x) &&
        Number.isFinite(transform.y) &&
        Number.isFinite(transform.scale)
      );

      assert.ok(
        approxEqual(viewportAfterReload.x, viewportBeforeReload.x, 2) &&
        approxEqual(viewportAfterReload.y, viewportBeforeReload.y, 2) &&
        approxEqual(viewportAfterReload.scale, viewportBeforeReload.scale, 0.02),
        `Expected viewport transform to restore after reload. Before=${JSON.stringify(viewportBeforeReload)} After=${JSON.stringify(viewportAfterReload)}`
      );

      await context.close();
    } finally {
      await browser.close();
    }
  }
);
