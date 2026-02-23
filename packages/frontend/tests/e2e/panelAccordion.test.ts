import assert from 'node:assert/strict';
import test from 'node:test';
import { createEmptyGraph } from './support/api.ts';
import { launchBrowser, openCanvasForGraph } from './support/browser.ts';
import { E2E_ASSERT_TIMEOUT_MS } from './support/config.ts';
import { ensureE2EEnvironment, shutdownE2EEnvironment } from './support/environment.ts';

test.before(async () => {
  await ensureE2EEnvironment();
});

test.after(async () => {
  await shutdownE2EEnvironment();
});

test(
  'right sidebar panels behave as accordion and graph controls live in graph panel',
  { timeout: 90_000 },
  async () => {
    const { graphId } = await createEmptyGraph('E2E Accordion Graph');

    const browser = await launchBrowser();
    try {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
      });
      const page = await context.newPage();

      await openCanvasForGraph(page, graphId);

      const graphSelect = page.locator('[data-testid="graph-select"]');
      await graphSelect.waitFor({ state: 'visible', timeout: E2E_ASSERT_TIMEOUT_MS });

      await page.locator('[data-testid="sidebar-toggle-node"]').click();
      await page.locator('[data-testid="sidebar-content-node"]').waitFor({
        state: 'visible',
        timeout: E2E_ASSERT_TIMEOUT_MS,
      });
      await page.locator('[data-testid="sidebar-content-graph"]').waitFor({
        state: 'hidden',
        timeout: E2E_ASSERT_TIMEOUT_MS,
      });

      const emptyNodeSelectionText = page.locator('text=Select a node or drawing to edit');
      await emptyNodeSelectionText.waitFor({ state: 'visible', timeout: E2E_ASSERT_TIMEOUT_MS });

      await page.locator('[data-testid="sidebar-toggle-output"]').click();
      await page.locator('[data-testid="sidebar-content-output"]').waitFor({
        state: 'visible',
        timeout: E2E_ASSERT_TIMEOUT_MS,
      });
      await page.locator('[data-testid="sidebar-content-node"]').waitFor({
        state: 'hidden',
        timeout: E2E_ASSERT_TIMEOUT_MS,
      });

      const outputEmptyText = page.locator('text=Select a node to view its output');
      await outputEmptyText.waitFor({ state: 'visible', timeout: E2E_ASSERT_TIMEOUT_MS });

      await page.locator('[data-testid="sidebar-toggle-graph"]').click();
      await page.locator('[data-testid="sidebar-content-graph"]').waitFor({
        state: 'visible',
        timeout: E2E_ASSERT_TIMEOUT_MS,
      });
      await page.locator('[data-testid="sidebar-content-output"]').waitFor({
        state: 'hidden',
        timeout: E2E_ASSERT_TIMEOUT_MS,
      });

      assert.equal(await graphSelect.isVisible(), true);

      await context.close();
    } finally {
      await browser.close();
    }
  }
);
