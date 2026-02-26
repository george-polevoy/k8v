import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { createEmptyGraph } from './support/api.ts';
import { launchBrowser, openCanvasForGraph } from './support/browser.ts';
import { E2E_ASSERT_TIMEOUT_MS, E2E_BACKEND_URL } from './support/config.ts';
import { ensureE2EEnvironment, shutdownE2EEnvironment } from './support/environment.ts';

interface GraphResponse {
  executionTimeoutMs?: unknown;
}

async function fetchGraphExecutionTimeoutMs(graphId: string): Promise<number> {
  const response = await fetch(`${E2E_BACKEND_URL}/api/graphs/${graphId}`);
  assert.equal(response.status, 200, `Expected graph ${graphId} to exist`);
  const graph = await response.json() as GraphResponse;
  assert.equal(
    typeof graph.executionTimeoutMs,
    'number',
    `Expected graph ${graphId} to expose executionTimeoutMs`
  );
  return graph.executionTimeoutMs as number;
}

async function waitForGraphExecutionTimeoutMs(
  graphId: string,
  expected: number,
  timeoutMs = E2E_ASSERT_TIMEOUT_MS
): Promise<void> {
  const startTime = Date.now();
  let lastValue = Number.NaN;

  while ((Date.now() - startTime) < timeoutMs) {
    lastValue = await fetchGraphExecutionTimeoutMs(graphId);
    if (lastValue === expected) {
      return;
    }
    await delay(120);
  }

  throw new Error(
    `Timed out waiting for graph ${graphId} executionTimeoutMs=${expected}. Last value: ${lastValue}`
  );
}

test.before(async () => {
  await ensureE2EEnvironment();
});

test.after(async () => {
  await shutdownE2EEnvironment();
});

test(
  'graph panel persists script timeout and supports large values',
  { timeout: 90_000 },
  async () => {
    const { graphId } = await createEmptyGraph('E2E Execution Timeout');
    const browser = await launchBrowser();

    try {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
      });
      const page = await context.newPage();

      await openCanvasForGraph(page, graphId);

      const timeoutInput = page.locator('[data-testid="graph-execution-timeout-input"]');
      await timeoutInput.waitFor({ state: 'visible', timeout: E2E_ASSERT_TIMEOUT_MS });

      await page.waitForFunction(() => {
        const input = document.querySelector('[data-testid="graph-execution-timeout-input"]') as HTMLInputElement | null;
        return Boolean(input && input.value === '30');
      }, { timeout: E2E_ASSERT_TIMEOUT_MS });

      await timeoutInput.fill('45');
      await timeoutInput.press('Enter');
      await waitForGraphExecutionTimeoutMs(graphId, 45_000);

      await timeoutInput.fill('100000');
      await timeoutInput.blur();
      await waitForGraphExecutionTimeoutMs(graphId, 100_000_000);

      await page.waitForFunction(() => {
        const input = document.querySelector('[data-testid="graph-execution-timeout-input"]') as HTMLInputElement | null;
        return Boolean(input && input.value === '100000');
      }, { timeout: E2E_ASSERT_TIMEOUT_MS });

      await context.close();
    } finally {
      await browser.close();
    }
  }
);
