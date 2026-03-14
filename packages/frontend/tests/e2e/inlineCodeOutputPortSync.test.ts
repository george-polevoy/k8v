import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { createEmptyGraph, waitForGraphNodeByName } from './support/api.ts';
import { launchBrowser, openCanvasForGraph } from './support/browser.ts';
import { E2E_ASSERT_TIMEOUT_MS } from './support/config.ts';
import { ensureE2EEnvironment, shutdownE2EEnvironment } from './support/environment.ts';

interface CanvasBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ViewportTransform {
  x: number;
  y: number;
  scale: number;
}

const NEW_NODE_POSITION = { x: 400, y: 300 };
const NEW_NODE_WIDTH = 220;
const NEW_NODE_HEIGHT = 68;

function isPointInsideRegion(x: number, y: number, region: CanvasBox): boolean {
  return (
    x >= region.x &&
    x <= (region.x + region.width) &&
    y >= region.y &&
    y <= (region.y + region.height)
  );
}

async function getFloatingWindowRegions(page: import('playwright').Page): Promise<CanvasBox[]> {
  const floatingWindows = page.locator('[data-testid^="floating-window-"]');
  const count = await floatingWindows.count();
  const regions: CanvasBox[] = [];
  for (let index = 0; index < count; index += 1) {
    const bounds = await floatingWindows.nth(index).boundingBox();
    if (bounds) {
      regions.push(bounds);
    }
  }
  return regions;
}

async function readViewportTransform(page: import('playwright').Page): Promise<ViewportTransform> {
  return page.evaluate(() => {
    const debugCounters = (window as Window & {
      __k8vCanvasDebug?: {
        viewportX?: unknown;
        viewportY?: unknown;
        viewportScale?: unknown;
      };
    }).__k8vCanvasDebug;

    return {
      x: typeof debugCounters?.viewportX === 'number' ? debugCounters.viewportX : Number.NaN,
      y: typeof debugCounters?.viewportY === 'number' ? debugCounters.viewportY : Number.NaN,
      scale: typeof debugCounters?.viewportScale === 'number' ? debugCounters.viewportScale : Number.NaN,
    };
  });
}

async function waitForViewportTransform(
  page: import('playwright').Page,
  predicate: (transform: ViewportTransform) => boolean,
  timeoutMs = E2E_ASSERT_TIMEOUT_MS
): Promise<ViewportTransform> {
  const startedAt = Date.now();
  let lastTransform = await readViewportTransform(page);

  while ((Date.now() - startedAt) < timeoutMs) {
    lastTransform = await readViewportTransform(page);
    if (predicate(lastTransform)) {
      return lastTransform;
    }
    await page.waitForTimeout(60);
  }

  throw new Error(`Timed out waiting for viewport transform. Last value: ${JSON.stringify(lastTransform)}`);
}

async function ensureNodeSelected(
  page: import('playwright').Page,
  canvasBox: CanvasBox
): Promise<void> {
  const nodeNameInput = page.locator('[data-testid="node-name-input"]');
  if (await nodeNameInput.isVisible()) {
    return;
  }

  const viewportTransform = await waitForViewportTransform(page, (transform) =>
    Number.isFinite(transform.x) &&
    Number.isFinite(transform.y) &&
    Number.isFinite(transform.scale)
  );
  const nodeRect = {
    x: canvasBox.x + viewportTransform.x + (NEW_NODE_POSITION.x * viewportTransform.scale),
    y: canvasBox.y + viewportTransform.y + (NEW_NODE_POSITION.y * viewportTransform.scale),
    width: NEW_NODE_WIDTH * viewportTransform.scale,
    height: NEW_NODE_HEIGHT * viewportTransform.scale,
  };
  const nodeClickCandidates = [
    { x: nodeRect.x + (nodeRect.width * 0.5), y: nodeRect.y + 20 * viewportTransform.scale },
    { x: nodeRect.x + 32 * viewportTransform.scale, y: nodeRect.y + 20 * viewportTransform.scale },
    { x: nodeRect.x + (nodeRect.width * 0.5), y: nodeRect.y + (nodeRect.height * 0.5) },
    { x: nodeRect.x + (nodeRect.width * 0.75), y: nodeRect.y + (nodeRect.height * 0.5) },
  ];

  const deadline = Date.now() + E2E_ASSERT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const blockedRegions = await getFloatingWindowRegions(page);

    for (const point of nodeClickCandidates) {
      if (blockedRegions.some((region) => isPointInsideRegion(point.x, point.y, region))) {
        continue;
      }
      await page.mouse.click(point.x, point.y);
      await page.waitForTimeout(60);
      if (await nodeNameInput.isVisible()) {
        return;
      }
    }

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
