import assert from 'node:assert/strict';
import test from 'node:test';
import type { Page } from 'playwright';
import { createEmptyGraph, createNumericInputGraph } from './support/api.ts';
import { launchBrowser, openCanvasForGraph } from './support/browser.ts';
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
  const nodeNameInput = page.locator('[data-testid="node-name-input"]');
  if (await nodeNameInput.isVisible()) {
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
    if (await nodeNameInput.isVisible()) {
      return;
    }
  }

  throw new Error('Failed to select centered node before accordion assertion.');
}

test.before(async () => {
  await ensureE2EEnvironment();
});

test.after(async () => {
  await shutdownE2EEnvironment();
});

test(
  'right sidebar panels behave as accordion and graph controls live in graph panel',
  { timeout: 90_000 },
  async () => {
    const { graphId } = await createEmptyGraph('E2E Accordion Graph');

    const browser = await launchBrowser();
    try {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
      });
      const page = await context.newPage();

      await openCanvasForGraph(page, graphId);

      const graphSelect = page.locator('[data-testid="graph-select"]');
      await graphSelect.waitFor({ state: 'visible', timeout: E2E_ASSERT_TIMEOUT_MS });

      await page.locator('[data-testid="sidebar-toggle-node"]').click();
      await page.locator('[data-testid="sidebar-content-node"]').waitFor({
        state: 'visible',
        timeout: E2E_ASSERT_TIMEOUT_MS,
      });
      await page.locator('[data-testid="sidebar-content-graph"]').waitFor({
        state: 'hidden',
        timeout: E2E_ASSERT_TIMEOUT_MS,
      });

      const emptyNodeSelectionText = page.locator('text=Select a node or drawing to edit');
      await emptyNodeSelectionText.waitFor({ state: 'visible', timeout: E2E_ASSERT_TIMEOUT_MS });

      await page.locator('[data-testid="sidebar-toggle-output"]').click();
      await page.locator('[data-testid="sidebar-content-output"]').waitFor({
        state: 'visible',
        timeout: E2E_ASSERT_TIMEOUT_MS,
      });
      await page.locator('[data-testid="sidebar-content-node"]').waitFor({
        state: 'hidden',
        timeout: E2E_ASSERT_TIMEOUT_MS,
      });

      const outputEmptyText = page.locator('text=Select a node to view its output');
      await outputEmptyText.waitFor({ state: 'visible', timeout: E2E_ASSERT_TIMEOUT_MS });

      await page.locator('[data-testid="sidebar-toggle-graph"]').click();
      await page.locator('[data-testid="sidebar-content-graph"]').waitFor({
        state: 'visible',
        timeout: E2E_ASSERT_TIMEOUT_MS,
      });
      await page.locator('[data-testid="sidebar-content-output"]').waitFor({
        state: 'hidden',
        timeout: E2E_ASSERT_TIMEOUT_MS,
      });

      assert.equal(await graphSelect.isVisible(), true);

      await context.close();
    } finally {
      await browser.close();
    }
  }
);

test(
  'selecting a node auto-expands the node sidebar panel',
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

      await page.locator('[data-testid="sidebar-toggle-output"]').click();
      await page.locator('[data-testid="sidebar-content-output"]').waitFor({
        state: 'visible',
        timeout: E2E_ASSERT_TIMEOUT_MS,
      });
      await page.locator('[data-testid="sidebar-content-node"]').waitFor({
        state: 'hidden',
        timeout: E2E_ASSERT_TIMEOUT_MS,
      });

      const canvas = page.locator('canvas').first();
      const canvasBox = await canvas.boundingBox();
      assert.ok(canvasBox, 'Canvas element should provide a bounding box');

      const nodeBox = resolveCenteredNodePosition(canvasBox);
      await ensureNodeSelected(page, nodeBox);

      await page.locator('[data-testid="sidebar-content-node"]').waitFor({
        state: 'visible',
        timeout: E2E_ASSERT_TIMEOUT_MS,
      });
      await page.locator('[data-testid="sidebar-content-output"]').waitFor({
        state: 'hidden',
        timeout: E2E_ASSERT_TIMEOUT_MS,
      });

      const nodeNameInput = page.locator('[data-testid="node-name-input"]');
      await nodeNameInput.waitFor({ state: 'visible', timeout: E2E_ASSERT_TIMEOUT_MS });

      await context.close();
    } finally {
      await browser.close();
    }
  }
);
