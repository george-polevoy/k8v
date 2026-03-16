import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
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

async function waitForNodeOutputs(
  graphId: string,
  nodeName: string,
  predicate: (outputs: string[]) => boolean,
  timeoutMs = E2E_ASSERT_TIMEOUT_MS
): Promise<string[]> {
  const startedAt = Date.now();
  let lastOutputNames: string[] = [];

  while ((Date.now() - startedAt) < timeoutMs) {
    const node = await waitForGraphNodeByName(graphId, nodeName, timeoutMs);
    lastOutputNames = (node.metadata?.outputs ?? [])
      .map((port) => port?.name)
      .filter((name): name is string => typeof name === 'string');

    if (predicate(lastOutputNames)) {
      return lastOutputNames;
    }

    await delay(120);
  }

  throw new Error(
    `Timed out waiting for output ports on node "${nodeName}" in graph ${graphId}. Last outputs: ${JSON.stringify(lastOutputNames)}`
  );
}

test(
  'editing inline code in node panel syncs inferred output ports',
  { timeout: 90_000 },
  async () => {
    const { graphId } = await createEmptyGraph('E2E Inline Code Output Port Sync');
    const nodeName = 'Inline Output Sync';

    const browser = await launchBrowser();
    try {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
      });
      const page = await context.newPage();

      await page.addInitScript(() => {
        (window as Window & {
          __k8vCanvasDebug?: Record<string, unknown>;
        }).__k8vCanvasDebug = {};
      });
      await openCanvasForGraph(page, graphId);

      await page.locator('button[title="Add Node"]').click();

      const dialog = page.locator('div', {
        has: page.locator('h2', { hasText: 'Create New Node' }),
      }).last();
      await dialog.waitFor({ state: 'visible', timeout: E2E_ASSERT_TIMEOUT_MS });

      await dialog.locator('input[type="text"]').fill(nodeName);
      await dialog.locator('textarea').fill('outputs.initial = inputs.input;');

      await dialog.getByRole('button', { name: 'Create' }).click();
      await dialog.waitFor({ state: 'hidden', timeout: E2E_ASSERT_TIMEOUT_MS });

      const initialOutputNames = await waitForNodeOutputs(
        graphId,
        nodeName,
        (outputs) => outputs.length === 1 && outputs[0] === 'initial'
      );
      assert.deepEqual(initialOutputNames, ['initial']);

      const node = await waitForGraphNodeByName(graphId, nodeName, E2E_ASSERT_TIMEOUT_MS);
      assert.equal(typeof node.id, 'string', 'Created inline node should expose an id');
      await page.waitForFunction(() => Boolean(window.__k8vGraphStore), {
        timeout: E2E_ASSERT_TIMEOUT_MS,
      });
      await page.evaluate((nodeId: string) => {
        window.__k8vGraphStore?.getState().selectNode(nodeId);
      }, node.id);

      const nodeSidebarContent = page.locator('[data-testid="sidebar-content-node"]');
      await nodeSidebarContent.waitFor({ state: 'visible', timeout: E2E_ASSERT_TIMEOUT_MS });

      const codeEditor = nodeSidebarContent.locator('textarea').first();
      await codeEditor.fill('outputs.updated = inputs.input;');
      await codeEditor.evaluate((element) => {
        (element as HTMLTextAreaElement).blur();
      });

      const updatedOutputNames = await waitForNodeOutputs(
        graphId,
        nodeName,
        (outputs) => outputs.length === 1 && outputs[0] === 'updated'
      );
      assert.deepEqual(updatedOutputNames, ['updated']);

      await context.close();
    } finally {
      await browser.close();
    }
  }
);
