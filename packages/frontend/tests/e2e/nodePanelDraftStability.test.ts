import assert from 'node:assert/strict';
import test from 'node:test';
import { createEmptyGraph } from './support/api.ts';
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
  'node panel name draft persists during unrelated graph updates',
  { timeout: 90_000 },
  async () => {
    const { graphId } = await createEmptyGraph('E2E Node Panel Draft Stability');
    const nodeName = 'Draft Stability Node';

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
      await dialog.locator('textarea').fill('outputs.value = 1;');
      await dialog.getByRole('button', { name: 'Create' }).click();
      await dialog.waitFor({ state: 'hidden', timeout: E2E_ASSERT_TIMEOUT_MS });

      await page.evaluate(async (targetNodeName) => {
        const { useGraphStore } = await import('/src/store/graphStore.ts');
        const store = useGraphStore.getState();
        const graph = store.graph;
        if (!graph) {
          throw new Error('Expected graph to be loaded before selecting node in draft stability test.');
        }

        const targetNode = graph.nodes.find((node) => node.metadata.name === targetNodeName);
        if (!targetNode) {
          throw new Error(`Could not find node named "${targetNodeName}" in draft stability test.`);
        }

        store.selectNode(targetNode.id);
      }, nodeName);

      const nodeSidebarContent = page.locator('[data-testid="sidebar-content-node"]');
      await nodeSidebarContent.waitFor({ state: 'visible', timeout: E2E_ASSERT_TIMEOUT_MS });

      const nodeNameInput = nodeSidebarContent.locator('[data-testid="node-name-input"]');
      const draftName = 'Unsaved Node Name Draft';
      await nodeNameInput.fill(draftName);

      await page.evaluate(async () => {
        const { useGraphStore } = await import('/src/store/graphStore.ts');
        const store = useGraphStore.getState();
        const currentGraph = store.graph;
        if (!currentGraph) {
          throw new Error('Expected graph to be loaded before updating graph name in test.');
        }

        await store.updateGraph({
          name: `${currentGraph.name}_background_update`,
        });
      });

      await page.waitForTimeout(250);
      assert.equal(await nodeNameInput.inputValue(), draftName);

      await context.close();
    } finally {
      await browser.close();
    }
  }
);
