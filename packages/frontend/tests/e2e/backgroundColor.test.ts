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
  'projection background color dialog supports hue and saturation/value selection',
  { timeout: 90_000 },
  async () => {
    const { graphId } = await createEmptyGraph('E2E Background Color');

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

      const hueSlider = page.locator('[data-testid="color-selection-hue-slider"]');
      const saturationValuePicker = page.locator('[data-testid="color-selection-sv-picker"]');
      const hueBounds = await hueSlider.boundingBox();
      const saturationValueBounds = await saturationValuePicker.boundingBox();
      assert.ok(hueBounds, 'Expected hue slider bounds');
      assert.ok(saturationValueBounds, 'Expected saturation/value picker bounds');

      await page.mouse.click(
        hueBounds.x + (hueBounds.width * 0.33),
        hueBounds.y + (hueBounds.height * 0.5)
      );
      await page.mouse.click(
        saturationValueBounds.x + (saturationValueBounds.width * 0.78),
        saturationValueBounds.y + (saturationValueBounds.height * 0.22)
      );

      const selectedColor = await page.locator('[data-testid="color-selection-dialog"]').getAttribute('data-current-color');
      assert.ok(selectedColor, 'Expected dialog to expose the currently selected color');

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
