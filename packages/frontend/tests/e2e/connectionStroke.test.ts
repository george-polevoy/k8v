import assert from 'node:assert/strict';
import test from 'node:test';
import { createEmptyGraph, waitForGraphConnectionStroke } from './support/api.ts';
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
  'graph panel connection stroke controls persist colors and enforce 2x width ratio',
  { timeout: 90_000 },
  async () => {
    const { graphId } = await createEmptyGraph('E2E Connection Stroke');
    const selectedForegroundColor = '#3b82f6';
    const selectedBackgroundColor = '#f59e0b';
    const foregroundWidth = 2.4;
    const backgroundWidth = 4.8;

    const browser = await launchBrowser();
    try {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
      });
      const page = await context.newPage();

      await openCanvasForGraph(page, graphId);

      const graphPanel = page.locator('[data-testid="sidebar-content-graph"]');
      if (!(await graphPanel.isVisible())) {
        await page.locator('[data-testid="sidebar-toggle-graph"]').click();
        await graphPanel.waitFor({
          state: 'visible',
          timeout: E2E_ASSERT_TIMEOUT_MS,
        });
      }

      await page.locator('[data-testid="connection-stroke-foreground-color-input"]').click();
      await page.getByText('Connection Foreground Color').waitFor({
        state: 'visible',
        timeout: E2E_ASSERT_TIMEOUT_MS,
      });
      await page.locator(`button[data-color="${selectedForegroundColor}"]`).first().click();
      await page.getByRole('button', { name: 'Use Color' }).click();

      await page.locator('[data-testid="connection-stroke-background-color-input"]').click();
      await page.getByText('Connection Background Color').waitFor({
        state: 'visible',
        timeout: E2E_ASSERT_TIMEOUT_MS,
      });
      await page.locator(`button[data-color="${selectedBackgroundColor}"]`).first().click();
      await page.getByRole('button', { name: 'Use Color' }).click();

      await page.locator('[data-testid="connection-stroke-foreground-width-input"]').fill(String(foregroundWidth));
      await page.locator('[data-testid="connection-stroke-save"]').click();

      const persisted = await waitForGraphConnectionStroke(
        graphId,
        (stroke) =>
          stroke.foregroundColor === selectedForegroundColor &&
          stroke.backgroundColor === selectedBackgroundColor &&
          Math.abs(stroke.foregroundWidth - foregroundWidth) < 0.001 &&
          Math.abs(stroke.backgroundWidth - backgroundWidth) < 0.001
      );

      assert.equal(persisted.foregroundColor, selectedForegroundColor);
      assert.equal(persisted.backgroundColor, selectedBackgroundColor);
      assert.ok(Math.abs(persisted.foregroundWidth - foregroundWidth) < 0.001);
      assert.ok(Math.abs(persisted.backgroundWidth - backgroundWidth) < 0.001);

      await context.close();
    } finally {
      await browser.close();
    }
  }
);
