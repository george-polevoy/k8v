import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { createEmptyGraph, fetchGraph } from './support/api.ts';
import { launchBrowser, openCanvasForGraph, openSidebarSection } from './support/browser.ts';
import { E2E_ASSERT_TIMEOUT_MS } from './support/config.ts';
import { ensureE2EEnvironment, shutdownE2EEnvironment } from './support/environment.ts';

async function waitForCommandRequestCount(
  readCount: () => number,
  expectedCount: number,
  timeoutMs = E2E_ASSERT_TIMEOUT_MS
): Promise<void> {
  const startedAt = Date.now();
  while ((Date.now() - startedAt) < timeoutMs) {
    if (readCount() === expectedCount) {
      return;
    }
    await delay(40);
  }

  throw new Error(`Timed out waiting for ${expectedCount} command requests. Last count: ${readCount()}`);
}

test.before(async () => {
  await ensureE2EEnvironment();
});

test.after(async () => {
  await shutdownE2EEnvironment();
});

test(
  'same-tab overlapping graph updates queue locally instead of surfacing a remote-conflict reload',
  { timeout: 90_000 },
  async () => {
    const { graphId } = await createEmptyGraph(`e2e_local_overlap_${Date.now()}`);
    const firstName = `autotests_local_overlap_first_${Date.now()}`;
    const secondName = `autotests_local_overlap_second_${Date.now()}`;

    const browser = await launchBrowser();
    try {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
      });
      const page = await context.newPage();

      let commandRequestCount = 0;
      let releaseFirstRequest: (() => void) | null = null;
      const firstRequestReleased = new Promise<void>((resolve) => {
        releaseFirstRequest = resolve;
      });

      await page.route(`**/api/graphs/${graphId}/commands`, async (route) => {
        if (route.request().method() !== 'POST') {
          await route.continue();
          return;
        }

        commandRequestCount += 1;
        if (commandRequestCount === 1) {
          await firstRequestReleased;
        }

        await route.continue();
      });

      await openCanvasForGraph(page, graphId);

      await page.waitForFunction(() => Boolean((window as Window & {
        __k8vGraphStore?: {
          getState: () => {
            submitGraphCommands: (commands: Array<{ kind: string; name: string }>) => Promise<void>;
          };
        };
      }).__k8vGraphStore), {
        timeout: E2E_ASSERT_TIMEOUT_MS,
      });

      await page.evaluate(({ first, second }) => {
        const store = (window as Window & {
          __k8vGraphStore?: {
            getState: () => {
              submitGraphCommands: (commands: Array<{ kind: string; name: string }>) => Promise<void>;
            };
          };
        }).__k8vGraphStore?.getState();

        if (!store) {
          throw new Error('Graph store not ready');
        }

        void store.submitGraphCommands([{ kind: 'set_graph_name', name: first }]);
        void store.submitGraphCommands([{ kind: 'set_graph_name', name: second }]);
      }, { first: firstName, second: secondName });

      await delay(200);
      assert.equal(commandRequestCount, 1, 'expected the second local graph update to remain queued');

      releaseFirstRequest?.();
      await waitForCommandRequestCount(() => commandRequestCount, 2);

      await page.waitForFunction(
        (expectedName) => {
          const input = document.querySelector('[data-testid="graph-name-input"]') as HTMLInputElement | null;
          return Boolean(input && input.value === expectedName);
        },
        secondName,
        { timeout: E2E_ASSERT_TIMEOUT_MS }
      );

      const persistedGraph = await fetchGraph(graphId);
      assert.equal(persistedGraph.name, secondName);

      await openSidebarSection(page, 'diagnostics');
      await page.locator('[data-testid="diagnostics-empty"]').waitFor({
        state: 'visible',
        timeout: E2E_ASSERT_TIMEOUT_MS,
      });
      assert.equal(
        await page.locator('[data-testid="diagnostics-message"]').count(),
        0,
      );

      await context.close();
    } finally {
      await browser.close();
    }
  }
);
