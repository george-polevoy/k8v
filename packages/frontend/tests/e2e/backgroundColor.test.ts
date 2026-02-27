import assert from 'node:assert/strict';
import test from 'node:test';
import { createEmptyGraph, waitForGraphCanvasBackground } from './support/api.ts';
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
  'projection background color selection dialog persists chosen color',
  { timeout: 90_000 },
  async () => {
    const { graphId } = await createEmptyGraph('E2E Background Color');
    const selectedColor = '#22c55e';

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

      const colorPickerButton = page.locator('[data-testid="canvas-background-color-input"]');
      await colorPickerButton.waitFor({
        state: 'visible',
        timeout: E2E_ASSERT_TIMEOUT_MS,
      });
      await colorPickerButton.click();

      await page.getByText('Canvas Base Color').waitFor({
        state: 'visible',
        timeout: E2E_ASSERT_TIMEOUT_MS,
      });

      await page.locator(`button[data-color="${selectedColor}"]`).first().click();
      await page.getByRole('button', { name: 'Use Color' }).click();

      await page.locator('[data-testid="canvas-background-save"]').click();

      const persisted = await waitForGraphCanvasBackground(
        graphId,
        (background) => background.baseColor === selectedColor
      );
      assert.equal(persisted.baseColor, selectedColor);

      await context.close();
    } finally {
      await browser.close();
    }
  }
);
