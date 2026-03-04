import assert from 'node:assert/strict';
import test from 'node:test';
import { createEmptyGraph } from './support/api.ts';
import { launchBrowser, openCanvasForGraph } from './support/browser.ts';
import { E2E_ASSERT_TIMEOUT_MS } from './support/config.ts';
import { ensureE2EEnvironment, shutdownE2EEnvironment } from './support/environment.ts';

interface CanvasBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ScreenRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

function isPointInsideRegion(x: number, y: number, region: ScreenRegion): boolean {
  return (
    x >= region.x &&
    x <= (region.x + region.width) &&
    y >= region.y &&
    y <= (region.y + region.height)
  );
}

async function getFloatingWindowRegions(page: import('playwright').Page): Promise<ScreenRegion[]> {
  const floatingWindows = page.locator('[data-testid^="floating-window-"]');
  const count = await floatingWindows.count();
  const regions: ScreenRegion[] = [];
  for (let index = 0; index < count; index += 1) {
    const bounds = await floatingWindows.nth(index).boundingBox();
    if (bounds) {
      regions.push(bounds);
    }
  }
  return regions;
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
    const blockedRegions = await getFloatingWindowRegions(page);
    for (let y = canvasBox.y + 40; y <= (canvasBox.y + canvasBox.height - 40); y += 70) {
      for (let x = canvasBox.x + 40; x <= (canvasBox.x + canvasBox.width - 40); x += 70) {
        if (blockedRegions.some((region) => isPointInsideRegion(x, y, region))) {
          continue;
        }
        await page.mouse.click(x, y);
        await page.waitForTimeout(60);
        if (await nodeNameInput.isVisible()) {
          return;
        }
      }
    }
  }

  throw new Error('Failed to select node for node panel draft stability test.');
}

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

      const canvas = page.locator('canvas').first();
      const canvasBox = await canvas.boundingBox();
      assert.ok(canvasBox, 'Canvas element should provide a bounding box');
      await ensureNodeSelected(page, canvasBox);

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

