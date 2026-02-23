import assert from 'node:assert/strict';
import test from 'node:test';
import { createEmptyGraph, waitForGraphNodeByName } from './support/api.ts';
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
  'creating python inline node infers input/output ports from code',
  { timeout: 90_000 },
  async () => {
    const { graphId } = await createEmptyGraph('E2E Python Inline Port Inference');
    const nodeName = 'Python Inferred Ports';

    const browser = await launchBrowser();
    try {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
      });
      const page = await context.newPage();

      await openCanvasForGraph(page, graphId);

      await page.locator('button[title="Add Node"]').click();

      const dialog = page.locator('div', {
        has: page.locator('h2', { hasText: 'Create New Node' }),
      }).last();
      await dialog.waitFor({ state: 'visible', timeout: E2E_ASSERT_TIMEOUT_MS });

      await dialog.locator('input[type="text"]').fill(nodeName);

      await dialog.locator('label', { hasText: 'Runtime:' })
        .locator('xpath=following-sibling::select[1]')
        .selectOption('python_process');

      await dialog.locator('textarea').fill([
        'a = inputs.a',
        'b = inputs["b"]',
        'outputs.status = a + b',
      ].join('\n'));

      await dialog.getByRole('button', { name: 'Create' }).click();
      await dialog.waitFor({ state: 'hidden', timeout: E2E_ASSERT_TIMEOUT_MS });

      const node = await waitForGraphNodeByName(graphId, nodeName, E2E_ASSERT_TIMEOUT_MS);

      assert.equal(node.config?.runtime, 'python_process');
      assert.deepEqual(node.metadata?.inputs?.map((port) => port.name), ['a', 'b']);
      assert.deepEqual(node.metadata?.outputs?.map((port) => port.name), ['status']);

      await context.close();
    } finally {
      await browser.close();
    }
  }
);
