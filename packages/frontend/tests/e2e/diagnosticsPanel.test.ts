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
  'diagnostics panel shows human-readable backend error and collapsed alert status',
  { timeout: 90_000 },
  async () => {
    const { graphId } = await createEmptyGraph('E2E Diagnostics Panel');
    const browser = await launchBrowser();

    try {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
      });
      const page = await context.newPage();

      let failedGraphUpdate = false;
      await page.route('**/api/graphs/**', async (route) => {
        const request = route.request();
        if (
          !failedGraphUpdate &&
          request.method() === 'POST' &&
          request.url().includes('/commands')
        ) {
          failedGraphUpdate = true;
          await route.fulfill({
            status: 413,
            contentType: 'application/json',
            body: JSON.stringify({
              error: 'PayloadTooLargeError: request entity too large\n    at readStream (...)',
            }),
          });
          return;
        }
        await route.continue();
      });

      await openCanvasForGraph(page, graphId);

      const graphNameInput = page.locator('[data-testid="graph-name-input"]');
      await graphNameInput.waitFor({ state: 'visible', timeout: E2E_ASSERT_TIMEOUT_MS });
      const originalName = await graphNameInput.inputValue();
      await graphNameInput.fill(`${originalName} updated`);
      await graphNameInput.press('Enter');

      const diagnosticsAlert = page.locator('[data-testid="sidebar-alert-diagnostics"]');
      await diagnosticsAlert.waitFor({ state: 'visible', timeout: E2E_ASSERT_TIMEOUT_MS });

      await page.locator('[data-testid="sidebar-content-diagnostics"]').waitFor({
        state: 'hidden',
        timeout: E2E_ASSERT_TIMEOUT_MS,
      });

      await page.locator('[data-testid="sidebar-toggle-diagnostics"]').click();
      const diagnosticsMessage = page.locator('[data-testid="diagnostics-message"]');
      await diagnosticsMessage.waitFor({ state: 'visible', timeout: E2E_ASSERT_TIMEOUT_MS });

      const messageText = await diagnosticsMessage.textContent();
      assert.equal(
        messageText?.trim(),
        'The request is too large for the backend. Reduce the graph payload and try again.'
      );
      assert.equal(messageText?.includes('PayloadTooLargeError'), false);
      assert.equal(messageText?.includes('readStream'), false);

      await context.close();
    } finally {
      await browser.close();
    }
  }
);
