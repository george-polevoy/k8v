import assert from 'node:assert/strict';
import test from 'node:test';
import { createEmptyGraph } from './support/api.ts';
import { launchBrowser, openCanvasForGraph, openSidebarSection } from './support/browser.ts';
import { E2E_ASSERT_TIMEOUT_MS } from './support/config.ts';
import { ensureE2EEnvironment, shutdownE2EEnvironment } from './support/environment.ts';

test.before(async () => {
  await ensureE2EEnvironment();
});

test.after(async () => {
  await shutdownE2EEnvironment();
});

test(
  'node creation dialog renders outside docked sidebar content',
  { timeout: 90_000 },
  async () => {
    const { graphId } = await createEmptyGraph('E2E Toolbar Dialog Layering');
    const browser = await launchBrowser();

    try {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
      });
      const page = await context.newPage();

      await openCanvasForGraph(page, graphId);
      await openSidebarSection(page, 'tools');

      await page.locator('button[title="Add Node"]').click();

      const dialog = page.locator('[data-testid="node-creation-dialog"]');
      await dialog.waitFor({ state: 'visible', timeout: E2E_ASSERT_TIMEOUT_MS });

      const sidebarContainsDialog = await page.evaluate(() => {
        const toolsContent = document.querySelector('[data-testid="sidebar-content-tools"]');
        const nodeCreationDialog = document.querySelector('[data-testid="node-creation-dialog"]');
        return Boolean(toolsContent && nodeCreationDialog && toolsContent.contains(nodeCreationDialog));
      });
      assert.equal(sidebarContainsDialog, false, 'Expected node creation dialog to be mounted outside docked sidebar content.');

      const dialogBounds = await dialog.boundingBox();
      assert.ok(dialogBounds, 'Expected node creation dialog to have measurable bounds.');
      assert.ok(dialogBounds.width >= 380, `Expected full-size dialog width, got ${dialogBounds.width}.`);

      const viewport = page.viewportSize();
      assert.ok(viewport, 'Expected viewport to be set.');
      const dialogCenterX = dialogBounds.x + (dialogBounds.width / 2);
      const dialogCenterY = dialogBounds.y + (dialogBounds.height / 2);
      assert.ok(
        Math.abs(dialogCenterX - (viewport.width / 2)) < 24,
        `Expected dialog horizontal center near viewport center, got ${dialogCenterX}.`
      );
      assert.ok(
        Math.abs(dialogCenterY - (viewport.height / 2)) < 24,
        `Expected dialog vertical center near viewport center, got ${dialogCenterY}.`
      );

      await context.close();
    } finally {
      await browser.close();
    }
  }
);
