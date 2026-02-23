import assert from 'node:assert/strict';
import test from 'node:test';
import { createEmptyGraph } from './support/api.ts';
import { launchBrowser, openCanvasForGraph } from './support/browser.ts';
import { E2E_ASSERT_TIMEOUT_MS, E2E_BACKEND_URL } from './support/config.ts';
import { ensureE2EEnvironment, shutdownE2EEnvironment } from './support/environment.ts';

async function waitForCurrentGraphToChange(
  page: import('playwright').Page,
  previousGraphId: string
): Promise<string> {
  const startedAt = Date.now();
  while ((Date.now() - startedAt) < E2E_ASSERT_TIMEOUT_MS) {
    const currentGraphId = await page.evaluate(() => window.localStorage.getItem('k8v-current-graph-id'));
    if (currentGraphId && currentGraphId !== previousGraphId) {
      return currentGraphId;
    }
    await page.waitForTimeout(80);
  }

  throw new Error(`Timed out waiting for active graph to change from ${previousGraphId}`);
}

test.before(async () => {
  await ensureE2EEnvironment();
});

test.after(async () => {
  await shutdownE2EEnvironment();
});

test(
  'graph deletion uses inline confirmation and does not open browser modal dialogs',
  { timeout: 90_000 },
  async () => {
    await createEmptyGraph('E2E Keep Graph');
    const { graphId: deleteGraphId } = await createEmptyGraph('E2E Delete Graph');

    const browser = await launchBrowser();
    try {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
      });
      const page = await context.newPage();

      let dialogCount = 0;
      page.on('dialog', async (dialog) => {
        dialogCount += 1;
        await dialog.dismiss();
      });

      await openCanvasForGraph(page, deleteGraphId);

      const deleteButton = page.locator('[data-testid="delete-graph-button"]');
      await deleteButton.waitFor({ state: 'visible', timeout: E2E_ASSERT_TIMEOUT_MS });
      await deleteButton.click();

      assert.equal(dialogCount, 0, 'Delete action should not trigger native confirm dialogs');

      const confirmDeleteButton = page.locator('[data-testid="confirm-delete-graph-button"]');
      await confirmDeleteButton.waitFor({ state: 'visible', timeout: E2E_ASSERT_TIMEOUT_MS });
      await confirmDeleteButton.click();

      const nextGraphId = await waitForCurrentGraphToChange(page, deleteGraphId);
      assert.notEqual(nextGraphId, deleteGraphId);
      assert.equal(dialogCount, 0, 'Deletion flow should stay modal-free');

      const deletedStatus = await page.evaluate(async ({ backendUrl, graphId }) => {
        const response = await fetch(`${backendUrl}/api/graphs/${graphId}`);
        return response.status;
      }, {
        backendUrl: E2E_BACKEND_URL,
        graphId: deleteGraphId,
      });
      assert.equal(deletedStatus, 404);

      await context.close();
    } finally {
      await browser.close();
    }
  }
);
