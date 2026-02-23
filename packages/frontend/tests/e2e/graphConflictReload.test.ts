import assert from 'node:assert/strict';
import test from 'node:test';
import { createEmptyGraph } from './support/api.ts';
import { launchBrowser, openCanvasForGraph } from './support/browser.ts';
import { E2E_ASSERT_TIMEOUT_MS, E2E_BACKEND_URL } from './support/config.ts';
import { ensureE2EEnvironment, shutdownE2EEnvironment } from './support/environment.ts';

async function fetchGraphName(graphId: string): Promise<string> {
  const response = await fetch(`${E2E_BACKEND_URL}/api/graphs/${graphId}`);
  assert.equal(response.status, 200, `Expected graph ${graphId} to exist`);
  const graph = await response.json();
  return graph.name as string;
}

async function updateGraphName(graphId: string, name: string): Promise<void> {
  const response = await fetch(`${E2E_BACKEND_URL}/api/graphs/${graphId}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  });

  assert.equal(response.status, 200, `Expected graph ${graphId} name update to succeed`);
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

      await openCanvasForGraph(page, graphId);

      const graphNameInput = page.locator('[data-testid="graph-name-input"]');
      await graphNameInput.waitFor({ state: 'visible', timeout: E2E_ASSERT_TIMEOUT_MS });

      await updateGraphName(graphId, remoteName);

      await graphNameInput.fill(localAttemptedName);
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
