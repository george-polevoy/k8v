import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { createEmptyGraph, waitForGraphNodeByName } from './support/api.ts';
import { launchBrowser } from './support/browser.ts';
import { E2E_ASSERT_TIMEOUT_MS, E2E_FRONTEND_URL } from './support/config.ts';
import { ensureE2EEnvironment, shutdownE2EEnvironment } from './support/environment.ts';

interface CanvasBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function ensureNodeSelected(
  page: import('playwright').Page,
  canvasBox: CanvasBox
): Promise<void> {
  const nodeNameInput = page.locator('[data-testid="node-name-input"]');
  if (await nodeNameInput.isVisible()) {
    return;
  }

  const deadline = Date.now() + E2E_ASSERT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    for (let y = canvasBox.y + 40; y <= (canvasBox.y + canvasBox.height - 40); y += 70) {
      for (let x = canvasBox.x + 40; x <= (canvasBox.x + canvasBox.width - 40); x += 70) {
        await page.mouse.click(x, y);
        await page.waitForTimeout(60);
        if (await nodeNameInput.isVisible()) {
          return;
        }
      }
    }
  }

  throw new Error('Failed to select node for inline code edit test.');
}

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

async function openGraphForTest(
  page: import('playwright').Page,
  graphId: string
): Promise<void> {
  await page.addInitScript((savedGraphId: string) => {
    window.localStorage.clear();
    window.localStorage.setItem('k8v-current-graph-id', savedGraphId);
  }, graphId);

  await page.goto(E2E_FRONTEND_URL, {
    waitUntil: 'domcontentloaded',
    timeout: E2E_ASSERT_TIMEOUT_MS,
  });
  await page.locator('canvas').first().waitFor({
    state: 'visible',
    timeout: E2E_ASSERT_TIMEOUT_MS,
  });
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

      await openGraphForTest(page, graphId);

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

      const canvas = page.locator('canvas').first();
      const canvasBox = await canvas.boundingBox();
      assert.ok(canvasBox, 'Canvas element should provide a bounding box');
      await ensureNodeSelected(page, canvasBox);

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
