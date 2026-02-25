import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { createEmptyGraph } from './support/api.ts';
import { launchBrowser, openCanvasForGraph } from './support/browser.ts';
import { E2E_ASSERT_TIMEOUT_MS, E2E_BACKEND_URL } from './support/config.ts';
import { ensureE2EEnvironment, shutdownE2EEnvironment } from './support/environment.ts';

interface GraphResponse {
  recomputeConcurrency?: unknown;
}

async function fetchGraphRecomputeConcurrency(graphId: string): Promise<number> {
  const response = await fetch(`${E2E_BACKEND_URL}/api/graphs/${graphId}`);
  assert.equal(response.status, 200, `Expected graph ${graphId} to exist`);
  const graph = await response.json() as GraphResponse;
  assert.equal(
    typeof graph.recomputeConcurrency,
    'number',
    `Expected graph ${graphId} to expose recomputeConcurrency`
  );
  return graph.recomputeConcurrency as number;
}

async function waitForGraphRecomputeConcurrency(
  graphId: string,
  expected: number,
  timeoutMs = E2E_ASSERT_TIMEOUT_MS
): Promise<void> {
  const startTime = Date.now();
  let lastValue = Number.NaN;

  while ((Date.now() - startTime) < timeoutMs) {
    lastValue = await fetchGraphRecomputeConcurrency(graphId);
    if (lastValue === expected) {
      return;
    }
    await delay(120);
  }

  throw new Error(
    `Timed out waiting for graph ${graphId} recomputeConcurrency=${expected}. Last value: ${lastValue}`
  );
}

test.before(async () => {
  await ensureE2EEnvironment();
});

test.after(async () => {
  await shutdownE2EEnvironment();
});

test(
  'graph panel persists recompute worker concurrency and clamps max value',
  { timeout: 90_000 },
  async () => {
    const { graphId } = await createEmptyGraph('E2E Recompute Concurrency');
    const browser = await launchBrowser();

    try {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
      });
      const page = await context.newPage();

      await openCanvasForGraph(page, graphId);

      const concurrencyInput = page.locator('[data-testid="graph-recompute-concurrency-input"]');
      await concurrencyInput.waitFor({ state: 'visible', timeout: E2E_ASSERT_TIMEOUT_MS });

      await concurrencyInput.fill('4');
      await concurrencyInput.press('Enter');
      await waitForGraphRecomputeConcurrency(graphId, 4);

      await concurrencyInput.fill('100');
      await concurrencyInput.blur();
      await waitForGraphRecomputeConcurrency(graphId, 32);

      await page.waitForFunction(() => {
        const input = document.querySelector('[data-testid="graph-recompute-concurrency-input"]') as HTMLInputElement | null;
        return Boolean(input && input.value === '32');
      }, { timeout: E2E_ASSERT_TIMEOUT_MS });

      await context.close();
    } finally {
      await browser.close();
    }
  }
);
