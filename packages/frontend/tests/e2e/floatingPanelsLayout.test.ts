import assert from 'node:assert/strict';
import test from 'node:test';
import type { Page } from 'playwright';
import { createEmptyGraph } from './support/api.ts';
import { launchBrowser, openCanvasForGraph } from './support/browser.ts';
import { E2E_ASSERT_TIMEOUT_MS } from './support/config.ts';
import { ensureE2EEnvironment, shutdownE2EEnvironment } from './support/environment.ts';

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
