import assert from 'node:assert/strict';
import test from 'node:test';
import type { Page } from 'playwright';
import { createEmptyGraph } from './support/api.ts';
import { launchBrowser, openCanvasForGraph, openSidebarSection } from './support/browser.ts';
import { E2E_ASSERT_TIMEOUT_MS } from './support/config.ts';
import { ensureE2EEnvironment, shutdownE2EEnvironment } from './support/environment.ts';

interface ViewportTransform {
  x: number;
  y: number;
  scale: number;
}

async function assertCanvasMatchesLayout(page: Page): Promise<void> {
  const viewport = page.viewportSize();
  assert.ok(viewport, 'Expected page viewport to be set');
  const canvas = page.locator('canvas').first();
  const sidebar = page.locator('[data-testid="right-sidebar"]');
  const canvasBox = await canvas.boundingBox();
  const sidebarBox = await sidebar.boundingBox();
  assert.ok(canvasBox, 'Expected canvas to be measurable');
  assert.ok(sidebarBox, 'Expected sidebar to be measurable');
  assert.ok(Math.abs(canvasBox.x) <= 1.5, `Expected canvas x near 0, got ${canvasBox.x}`);
  assert.ok(Math.abs(canvasBox.y) <= 1.5, `Expected canvas y near 0, got ${canvasBox.y}`);
  assert.ok(
    Math.abs(canvasBox.width - (viewport.width - sidebarBox.width)) <= 2,
    `Expected canvas width ${viewport.width - sidebarBox.width}, got ${canvasBox.width}`
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
  await page.locator('[data-testid="right-sidebar"]').waitFor({
    state: 'visible',
    timeout: E2E_ASSERT_TIMEOUT_MS,
  });
  await page.waitForFunction((expectedGraphId: string) => {
    const activeGraphId = (window as Window & {
      __k8vGraphStore?: {
        getState: () => {
          graph?: { id?: string | null } | null;
        };
      };
    }).__k8vGraphStore?.getState().graph?.id;
    return activeGraphId === expectedGraphId;
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

async function waitForSidebarWidth(
  page: Page,
  predicate: (width: number) => boolean,
  timeoutMs = E2E_ASSERT_TIMEOUT_MS
): Promise<number> {
  const startedAt = Date.now();
  let lastWidth = Number.NaN;

  while ((Date.now() - startedAt) < timeoutMs) {
    const box = await page.locator('[data-testid="right-sidebar"]').boundingBox();
    lastWidth = box?.width ?? Number.NaN;
    if (Number.isFinite(lastWidth) && predicate(lastWidth)) {
      return lastWidth;
    }
    await page.waitForTimeout(60);
  }

  throw new Error(`Timed out waiting for sidebar width. Last value: ${lastWidth}`);
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
  'canvas fills the remaining workspace while docked sidebar switches and collapses',
  { timeout: 90_000 },
  async () => {
    const { graphId } = await createEmptyGraph('E2E Docked Sidebar Layout');
    const browser = await launchBrowser();
    try {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
      });
      const page = await context.newPage();
      await openCanvasForGraph(page, graphId);

      await page.locator('[data-testid="right-sidebar"]').waitFor({
        state: 'visible',
        timeout: E2E_ASSERT_TIMEOUT_MS,
      });
      await assertCanvasMatchesLayout(page);

      const expandedWidth = await waitForSidebarWidth(page, (width) => width > 300);
      await openSidebarSection(page, 'output');
      await page.locator('[data-testid="sidebar-content-output"]').waitFor({
        state: 'visible',
        timeout: E2E_ASSERT_TIMEOUT_MS,
      });
      await assertCanvasMatchesLayout(page);

      await page.locator('[data-testid="sidebar-toggle-output"]').click();
      await page.locator('[data-testid="sidebar-content-pane"]').waitFor({
        state: 'hidden',
        timeout: E2E_ASSERT_TIMEOUT_MS,
      });
      const collapsedWidth = await waitForSidebarWidth(page, (width) => width < 120);
      assert.ok(
        collapsedWidth < expandedWidth,
        `Expected collapsed width ${collapsedWidth} to be smaller than expanded width ${expandedWidth}`
      );
      await assertCanvasMatchesLayout(page);

      await page.locator('[data-testid="sidebar-toggle-output"]').click();
      await page.locator('[data-testid="sidebar-content-output"]').waitFor({
        state: 'visible',
        timeout: E2E_ASSERT_TIMEOUT_MS,
      });
      await waitForSidebarWidth(page, (width) => approxEqual(width, expandedWidth, 2));
      await assertCanvasMatchesLayout(page);

      await context.close();
    } finally {
      await browser.close();
    }
  }
);

test(
  'sidebar session state and viewport navigation persist across page refresh',
  { timeout: 90_000 },
  async () => {
    const { graphId } = await createEmptyGraph('E2E Sidebar Refresh Persistence');
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
      const canvasBox = await canvas.boundingBox();
      assert.ok(canvasBox, 'Expected canvas bounds for viewport interaction test');

      const initialViewport = await waitForViewportTransform(page, (transform) =>
        Number.isFinite(transform.x) &&
        Number.isFinite(transform.y) &&
        Number.isFinite(transform.scale)
      );

      await openSidebarSection(page, 'tools');
      const expandedToolsWidth = await waitForSidebarWidth(page, (width) => width > 300);

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

      await page.locator('[data-testid="sidebar-content-tools"]').waitFor({
        state: 'visible',
        timeout: E2E_ASSERT_TIMEOUT_MS,
      });
      await waitForSidebarWidth(page, (width) => approxEqual(width, expandedToolsWidth, 2));
      await assertCanvasMatchesLayout(page);

      const viewportAfterReload = await waitForViewportTransform(page, (transform) =>
        approxEqual(transform.x, viewportBeforeReload.x, 2) &&
        approxEqual(transform.y, viewportBeforeReload.y, 2) &&
        approxEqual(transform.scale, viewportBeforeReload.scale, 0.02)
      );
      assert.ok(
        approxEqual(viewportAfterReload.x, viewportBeforeReload.x, 2) &&
        approxEqual(viewportAfterReload.y, viewportBeforeReload.y, 2) &&
        approxEqual(viewportAfterReload.scale, viewportBeforeReload.scale, 0.02),
        'Expected viewport navigation to restore after refresh'
      );

      await page.locator('[data-testid="sidebar-toggle-tools"]').click();
      await page.locator('[data-testid="sidebar-content-pane"]').waitFor({
        state: 'hidden',
        timeout: E2E_ASSERT_TIMEOUT_MS,
      });
      const collapsedWidthBeforeReload = await waitForSidebarWidth(page, (width) => width < 120);

      await reloadCanvasForGraph(page, graphId);
      await page.locator('[data-testid="sidebar-content-pane"]').waitFor({
        state: 'hidden',
        timeout: E2E_ASSERT_TIMEOUT_MS,
      });
      await waitForSidebarWidth(page, (width) => approxEqual(width, collapsedWidthBeforeReload, 2));
      await assertCanvasMatchesLayout(page);

      await context.close();
    } finally {
      await browser.close();
    }
  }
);
