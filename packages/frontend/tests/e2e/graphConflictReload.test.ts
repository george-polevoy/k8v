import assert from 'node:assert/strict';
import test from 'node:test';
import { createEmptyGraph, fetchGraph, updateGraphName } from './support/api.ts';
import { launchBrowser, openCanvasForGraph } from './support/browser.ts';
import { E2E_ASSERT_TIMEOUT_MS } from './support/config.ts';
import { ensureE2EEnvironment, shutdownE2EEnvironment } from './support/environment.ts';

async function fetchGraphName(graphId: string): Promise<string> {
  const graph = await fetchGraph(graphId);
  return graph.name as string;
}

test.before(async () => {
  await ensureE2EEnvironment();
});

test.after(async () => {
  await shutdownE2EEnvironment();
});

test(
  'graph panel reloads latest graph state when save conflicts with remote update',
  { timeout: 90_000 },
  async () => {
    const { graphId } = await createEmptyGraph('E2E Conflict Graph');
    const remoteName = `autotests_remote_conflict_${Date.now()}`;
    const localAttemptedName = `autotests_local_conflict_${Date.now()}`;

    const browser = await launchBrowser();
    try {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
      });
      const page = await context.newPage();

      await page.addInitScript(() => {
        Object.defineProperty(window, 'EventSource', {
          configurable: true,
          writable: true,
          value: undefined,
        });
      });

      await openCanvasForGraph(page, graphId);

      const graphNameInput = page.locator('[data-testid="graph-name-input"]');
      await graphNameInput.waitFor({ state: 'visible', timeout: E2E_ASSERT_TIMEOUT_MS });

      await graphNameInput.fill(localAttemptedName);
      assert.equal(await graphNameInput.inputValue(), localAttemptedName);

      await updateGraphName(graphId, remoteName);
      const remoteGraph = await fetchGraph(graphId);
      let conflictInjected = false;

      await page.route(`**/api/graphs/${graphId}/commands`, async (route) => {
        if (!conflictInjected && route.request().method() === 'POST') {
          conflictInjected = true;
          await route.fulfill({
            status: 409,
            contentType: 'application/json',
            body: JSON.stringify({
              error: 'Graph revision conflict. Reload the latest graph and retry.',
              currentRevision: remoteGraph.revision ?? 1,
            }),
          });
          return;
        }

        await route.continue();
      });

      await graphNameInput.blur();

      await page.waitForFunction(
        (targetName) => {
          const input = document.querySelector('[data-testid="graph-name-input"]') as HTMLInputElement | null;
          return Boolean(input && input.value === targetName);
        },
        remoteName,
        { timeout: E2E_ASSERT_TIMEOUT_MS }
      );

      const persistedName = await fetchGraphName(graphId);
      assert.equal(persistedName, remoteName);

      await context.close();
    } finally {
      await browser.close();
    }
  }
);
