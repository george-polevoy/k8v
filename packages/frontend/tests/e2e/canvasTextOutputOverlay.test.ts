import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { createInlineCodeGraph, submitGraphCommands } from './support/api.ts';
import { launchBrowser, openCanvasForGraph, openSidebarSection } from './support/browser.ts';
import { E2E_ASSERT_TIMEOUT_MS, E2E_BACKEND_URL } from './support/config.ts';
import { ensureE2EEnvironment, shutdownE2EEnvironment } from './support/environment.ts';

async function waitForNodeTextOutput(
  graphId: string,
  nodeId: string,
  predicate: (textOutput: string) => boolean,
  timeoutMs = E2E_ASSERT_TIMEOUT_MS
): Promise<string> {
  const startedAt = Date.now();

  while ((Date.now() - startedAt) < timeoutMs) {
    const response = await fetch(`${E2E_BACKEND_URL}/api/graphs/${graphId}/nodes/${nodeId}/result`);
    if (response.ok) {
      const payload = await response.json() as { textOutput?: unknown };
      if (typeof payload.textOutput === 'string' && predicate(payload.textOutput)) {
        return payload.textOutput;
      }
    }

    await delay(120);
  }

  throw new Error(`Timed out waiting for text output for node ${nodeId}`);
}

async function waitForOverlayCount(
  locator: import('playwright').Locator,
  expectedCount: number,
  timeoutMs = E2E_ASSERT_TIMEOUT_MS
): Promise<void> {
  const startedAt = Date.now();

  while ((Date.now() - startedAt) < timeoutMs) {
    if ((await locator.count()) === expectedCount) {
      return;
    }
    await delay(80);
  }

  throw new Error(`Timed out waiting for overlay count ${expectedCount}`);
}

test.before(async () => {
  await ensureE2EEnvironment();
});

test.after(async () => {
  await shutdownE2EEnvironment();
});

test(
  'canvas text output overlay supports cap and scroll modes and skips empty output',
  { timeout: 90_000 },
  async () => {
    const { graphId, nodeId } = await createInlineCodeGraph({
      code: [
        'print("alpha")',
        'print("beta")',
        'print("gamma")',
        'outputs.output = 1;',
      ].join('\n'),
    });

    const browser = await launchBrowser();
    try {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
      });
      const page = await context.newPage();
      await openCanvasForGraph(page, graphId);
      await openSidebarSection(page, 'node');

      await page.waitForFunction(() => Boolean(window.__k8vGraphStore), {
        timeout: E2E_ASSERT_TIMEOUT_MS,
      });
      await page.evaluate((targetNodeId: string) => {
        window.__k8vGraphStore?.getState().selectNode(targetNodeId);
      }, nodeId);

      await page.locator('[data-testid="display-text-outputs-toggle"]').waitFor({
        state: 'visible',
        timeout: E2E_ASSERT_TIMEOUT_MS,
      });

      const overlay = page.locator(`[data-testid="text-output-overlay-${nodeId}"]`);
      await page.locator('[data-testid="display-text-outputs-toggle"]').check();
      await page.locator('[data-testid="text-output-max-lines-input"]').fill('2');
      await page.locator('[data-testid="text-output-max-lines-input"]').evaluate((element) => {
        (element as HTMLInputElement).blur();
      });
      await page.locator('[data-testid="text-output-overflow-mode-select"]').selectOption('cap');

      assert.equal(await overlay.count(), 0, 'Expected no text overlay before the node has output.');

      await page.locator('[data-testid="run-selected-node-button"]').click();
      const textOutput = await waitForNodeTextOutput(
        graphId,
        nodeId,
        (value) => value.includes('alpha') && value.includes('gamma')
      );
      assert.equal(textOutput, 'alpha\nbeta\ngamma');

      await overlay.waitFor({ state: 'visible', timeout: E2E_ASSERT_TIMEOUT_MS });
      const cappedText = await overlay.evaluate((element) => element.textContent ?? '');
      assert.equal(cappedText, 'alpha\nbeta');
      assert.equal(
        await overlay.evaluate((element) => window.getComputedStyle(element as HTMLElement).overflowY),
        'hidden'
      );
      assert.equal(
        await overlay.evaluate((element) => element.querySelector('pre') instanceof HTMLPreElement),
        true
      );

      await page.locator('[data-testid="text-output-overflow-mode-select"]').selectOption('scroll');
      const fullTextStartedAt = Date.now();
      while ((Date.now() - fullTextStartedAt) < E2E_ASSERT_TIMEOUT_MS) {
        const nextText = await overlay.evaluate((element) => element.textContent ?? '');
        if (nextText === 'alpha\nbeta\ngamma') {
          break;
        }
        await delay(80);
      }
      assert.equal(
        await overlay.evaluate((element) => element.textContent ?? ''),
        'alpha\nbeta\ngamma'
      );
      assert.equal(
        await overlay.evaluate((element) => window.getComputedStyle(element as HTMLElement).overflowY),
        'auto'
      );

      await page.locator('[data-testid="display-text-outputs-toggle"]').uncheck();
      await waitForOverlayCount(overlay, 0);

      await context.close();
    } finally {
      await browser.close();
    }
  }
);

test(
  'canvas text output overlay renders whitespace-only output when enabled',
  { timeout: 90_000 },
  async () => {
    const { graphId, nodeId } = await createInlineCodeGraph({
      code: [
        'print("   ")',
        'outputs.output = 1;',
      ].join('\n'),
      displayTextOutputs: true,
      textOutputMaxLines: 4,
      textOutputOverflowMode: 'scroll',
    });

    await submitGraphCommands(
      graphId,
      1,
      [{ kind: 'compute_node', nodeId }],
      'Compute whitespace-only text output node'
    );
    await waitForNodeTextOutput(graphId, nodeId, (value) => value === '   ');

    const browser = await launchBrowser();
    try {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
      });
      const page = await context.newPage();
      await openCanvasForGraph(page, graphId);

      await page.waitForFunction(() => Boolean(window.__k8vGraphStore), {
        timeout: E2E_ASSERT_TIMEOUT_MS,
      });
      await page.evaluate((targetNodeId: string) => {
        window.__k8vGraphStore?.getState().selectNode(targetNodeId);
      }, nodeId);

      const overlay = page.locator(`[data-testid="text-output-overlay-${nodeId}"]`);
      await overlay.waitFor({ state: 'visible', timeout: E2E_ASSERT_TIMEOUT_MS });
      assert.equal(await overlay.evaluate((element) => element.textContent ?? ''), '   ');
      assert.equal(
        await overlay.evaluate((element) => element.querySelector('pre') instanceof HTMLPreElement),
        true
      );

      await context.close();
    } finally {
      await browser.close();
    }
  }
);
