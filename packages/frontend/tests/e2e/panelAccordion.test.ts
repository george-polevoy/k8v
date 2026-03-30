import assert from 'node:assert/strict';
import test from 'node:test';
import type { Page } from 'playwright';
import { createEmptyGraph, createNumericInputGraph } from './support/api.ts';
import { launchBrowser, openCanvasForGraph, openSidebarSection } from './support/browser.ts';
import { E2E_ASSERT_TIMEOUT_MS } from './support/config.ts';
import { ensureE2EEnvironment, shutdownE2EEnvironment } from './support/environment.ts';

const NUMERIC_NODE_WIDTH = 220;

interface NodeScreenPosition {
  centerX: number;
  centerY: number;
  left: number;
}

interface CanvasBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

function resolveCenteredNodePosition(canvasBox: CanvasBox): NodeScreenPosition {
  const centerX = canvasBox.x + (canvasBox.width / 2);
  const centerY = canvasBox.y + (canvasBox.height / 2);
  return {
    centerX,
    centerY,
    left: centerX - (NUMERIC_NODE_WIDTH / 2),
  };
}

async function ensureNodeSelected(page: Page, nodeBox: NodeScreenPosition): Promise<void> {
  const alreadySelected = await page.evaluate(() =>
    Boolean(window.__k8vGraphStore?.getState().selectedNodeId)
  );
  if (alreadySelected) {
    return;
  }

  const selectionClicks = [
    { x: nodeBox.centerX, y: nodeBox.centerY },
    { x: nodeBox.left + 24, y: nodeBox.centerY - 30 },
    { x: nodeBox.left + 24, y: nodeBox.centerY - 12 },
    { x: nodeBox.centerX - 80, y: nodeBox.centerY - 12 },
    { x: nodeBox.centerX + 80, y: nodeBox.centerY - 12 },
    { x: nodeBox.centerX, y: nodeBox.centerY - 56 },
    { x: nodeBox.centerX, y: nodeBox.centerY + 28 },
  ];

  const deadline = Date.now() + E2E_ASSERT_TIMEOUT_MS;
  let index = 0;
  while (Date.now() < deadline) {
    const click = selectionClicks[index % selectionClicks.length];
    index += 1;
    await page.mouse.click(click.x, click.y);
    await page.waitForTimeout(120);
    const isSelected = await page.evaluate(() =>
      Boolean(window.__k8vGraphStore?.getState().selectedNodeId)
    );
    if (isSelected) {
      return;
    }
  }

  throw new Error('Failed to select centered node before sidebar assertion.');
}

test.before(async () => {
  await ensureE2EEnvironment();
});

test.after(async () => {
  await shutdownE2EEnvironment();
});

test(
  'right sidebar switches sections from the icon rail and active icon toggles collapse',
  { timeout: 90_000 },
  async () => {
    const { graphId } = await createEmptyGraph('E2E Sidebar Navigation Graph');

    const browser = await launchBrowser();
    try {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
      });
      const page = await context.newPage();

      await openCanvasForGraph(page, graphId);

      const graphSelect = page.locator('[data-testid="graph-select"]');
      await graphSelect.waitFor({ state: 'visible', timeout: E2E_ASSERT_TIMEOUT_MS });
      await page.locator('[data-testid="sidebar-content-graph"]').waitFor({
        state: 'visible',
        timeout: E2E_ASSERT_TIMEOUT_MS,
      });

      await openSidebarSection(page, 'node');
      await page.locator('[data-testid="sidebar-content-graph"]').waitFor({
        state: 'hidden',
        timeout: E2E_ASSERT_TIMEOUT_MS,
      });
      await page.getByText('Select a node or drawing to edit').waitFor({
        state: 'visible',
        timeout: E2E_ASSERT_TIMEOUT_MS,
      });

      await openSidebarSection(page, 'output');
      await page.locator('[data-testid="sidebar-content-node"]').waitFor({
        state: 'hidden',
        timeout: E2E_ASSERT_TIMEOUT_MS,
      });
      await page.getByText('Select a node to view its output').waitFor({
        state: 'visible',
        timeout: E2E_ASSERT_TIMEOUT_MS,
      });

      await page.locator('[data-testid="sidebar-toggle-output"]').click();
      await page.locator('[data-testid="sidebar-content-output"]').waitFor({
        state: 'hidden',
        timeout: E2E_ASSERT_TIMEOUT_MS,
      });
      await page.locator('[data-testid="sidebar-content-pane"]').waitFor({
        state: 'hidden',
        timeout: E2E_ASSERT_TIMEOUT_MS,
      });

      await page.locator('[data-testid="sidebar-toggle-output"]').click();
      await page.locator('[data-testid="sidebar-content-output"]').waitFor({
        state: 'visible',
        timeout: E2E_ASSERT_TIMEOUT_MS,
      });

      await context.close();
    } finally {
      await browser.close();
    }
  }
);

test(
  'selecting a node preserves the current sidebar section instead of auto-switching to node',
  { timeout: 90_000 },
  async () => {
    const { graphId } = await createNumericInputGraph({
      value: 25,
      min: 0,
      max: 100,
      step: 1,
    });

    const browser = await launchBrowser();
    try {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
      });
      const page = await context.newPage();

      await openCanvasForGraph(page, graphId);
      await openSidebarSection(page, 'output');

      const canvas = page.locator('canvas').first();
      const canvasBox = await canvas.boundingBox();
      assert.ok(canvasBox, 'Canvas element should provide a bounding box');

      const nodeBox = resolveCenteredNodePosition(canvasBox);
      await ensureNodeSelected(page, nodeBox);

      await page.locator('[data-testid="sidebar-content-output"]').waitFor({
        state: 'visible',
        timeout: E2E_ASSERT_TIMEOUT_MS,
      });
      await page.locator('[data-testid="sidebar-content-node"]').waitFor({
        state: 'hidden',
        timeout: E2E_ASSERT_TIMEOUT_MS,
      });

      await context.close();
    } finally {
      await browser.close();
    }
  }
);
