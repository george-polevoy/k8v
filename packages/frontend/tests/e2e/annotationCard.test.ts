import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createAnnotationGraph,
  waitForAnnotationNodeFontSize,
  getNodePosition,
  waitForAnnotationNodeText,
  waitForNodeCardSize,
  waitForNodePosition,
} from './support/api.ts';
import { launchBrowser, openCanvasForGraph, readCanvasCursor } from './support/browser.ts';
import { E2E_ASSERT_TIMEOUT_MS } from './support/config.ts';
import { ensureE2EEnvironment, shutdownE2EEnvironment } from './support/environment.ts';

const DEFAULT_ANNOTATION_WIDTH = 320;
const DEFAULT_ANNOTATION_HEIGHT = 200;

interface CanvasBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface NodeScreenPosition {
  centerX: number;
  centerY: number;
  left: number;
  top: number;
}

interface SearchRegion {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

function resolveCenteredNodePosition(canvasBox: CanvasBox): NodeScreenPosition {
  const centerX = canvasBox.x + (canvasBox.width / 2);
  const centerY = canvasBox.y + (canvasBox.height / 2);
  return {
    centerX,
    centerY,
    left: centerX - (DEFAULT_ANNOTATION_WIDTH / 2),
    top: centerY - (DEFAULT_ANNOTATION_HEIGHT / 2),
  };
}

async function locateCursorPoint(
  page: import('playwright').Page,
  region: SearchRegion,
  expectedCursor: string
): Promise<{ x: number; y: number }> {
  for (let y = region.minY; y <= region.maxY; y += 3) {
    for (let x = region.minX; x <= region.maxX; x += 3) {
      await page.mouse.move(x, y);
      if ((await readCanvasCursor(page)) === expectedCursor) {
        return { x, y };
      }
    }
  }

  throw new Error(`Failed to find cursor "${expectedCursor}" within region ${JSON.stringify(region)}`);
}

async function ensureNodeSelected(
  page: import('playwright').Page,
  nodeBox: NodeScreenPosition
): Promise<void> {
  const nodeNameInput = page.locator('[data-testid="node-name-input"]');
  if (await nodeNameInput.isVisible()) {
    return;
  }

  const clicks = [
    { x: nodeBox.centerX, y: nodeBox.centerY },
    { x: nodeBox.left + 28, y: nodeBox.top + 28 },
    { x: nodeBox.centerX + 90, y: nodeBox.centerY - 40 },
    { x: nodeBox.centerX - 90, y: nodeBox.centerY + 40 },
  ];

  const deadline = Date.now() + E2E_ASSERT_TIMEOUT_MS;
  let index = 0;
  while (Date.now() < deadline) {
    const click = clicks[index % clicks.length];
    index += 1;
    await page.mouse.click(click.x, click.y);
    await page.waitForTimeout(120);
    if (await nodeNameInput.isVisible()) {
      return;
    }
  }

  throw new Error('Failed to select centered annotation node before resize interaction.');
}

test.before(async () => {
  await ensureE2EEnvironment();
});

test.after(async () => {
  await shutdownE2EEnvironment();
});

test(
  'annotation card supports markdown + TeX and can resize from left/top handles',
  { timeout: 90_000 },
  async () => {
    const { graphId, nodeId } = await createAnnotationGraph({
      text: '# Heading\n\n**Bold** text with $e^{i\\pi} + 1 = 0$.',
      backgroundColor: 'rgba(254,243,199,0)',
      borderColor: '#334155',
      cardWidth: DEFAULT_ANNOTATION_WIDTH,
      cardHeight: DEFAULT_ANNOTATION_HEIGHT,
    });
    const initialPosition = await getNodePosition(graphId, nodeId);

    const browser = await launchBrowser();
    try {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
      });
      const page = await context.newPage();
      await openCanvasForGraph(page, graphId);

      const canvas = page.locator('canvas').first();
      const canvasBox = await canvas.boundingBox();
      assert.ok(canvasBox, 'Canvas element should provide a bounding box');
      const nodeBox = resolveCenteredNodePosition(canvasBox);
      await ensureNodeSelected(page, nodeBox);

      const annotationOverlay = page.locator(`[data-testid="annotation-overlay-${nodeId}"]`);
      await annotationOverlay.waitFor({ state: 'visible', timeout: E2E_ASSERT_TIMEOUT_MS });
      assert.ok((await annotationOverlay.locator('.katex').count()) > 0, 'Expected rendered KaTeX content');

      const leftHandle = await locateCursorPoint(page, {
        minX: Math.round(nodeBox.left - 16),
        maxX: Math.round(nodeBox.left + 18),
        minY: Math.round(nodeBox.centerY - 36),
        maxY: Math.round(nodeBox.centerY + 36),
      }, 'ew-resize');

      await page.mouse.move(leftHandle.x, leftHandle.y);
      await page.mouse.down();
      await page.mouse.move(leftHandle.x - 72, leftHandle.y, { steps: 18 });
      await page.mouse.up();

      const widened = await waitForNodeCardSize(
        graphId,
        nodeId,
        (size) => (size.width ?? 0) >= 380,
        E2E_ASSERT_TIMEOUT_MS
      );
      const movedLeft = await waitForNodePosition(
        graphId,
        nodeId,
        (position) => position.x <= initialPosition.x - 40,
        E2E_ASSERT_TIMEOUT_MS
      );
      assert.ok((widened.width ?? 0) >= 380, `Expected width >= 380 after left resize. Received: ${widened.width}`);
      assert.ok(movedLeft.x <= initialPosition.x - 40, `Expected node x to decrease after left resize.`);

      const topHandle = await locateCursorPoint(page, {
        minX: Math.round(nodeBox.centerX - 40),
        maxX: Math.round(nodeBox.centerX + 40),
        minY: Math.round(nodeBox.top - 20),
        maxY: Math.round(nodeBox.centerY - 14),
      }, 'ns-resize');

      await page.mouse.move(topHandle.x, topHandle.y);
      await page.mouse.down();
      await page.mouse.move(topHandle.x, topHandle.y - 56, { steps: 16 });
      await page.mouse.up();

      const taller = await waitForNodeCardSize(
        graphId,
        nodeId,
        (size) => (size.height ?? 0) >= 250,
        E2E_ASSERT_TIMEOUT_MS
      );
      const movedUp = await waitForNodePosition(
        graphId,
        nodeId,
        (position) => position.y <= initialPosition.y - 24,
        E2E_ASSERT_TIMEOUT_MS
      );
      assert.ok((taller.height ?? 0) >= 250, `Expected height >= 250 after top resize. Received: ${taller.height}`);
      assert.ok(movedUp.y <= initialPosition.y - 24, 'Expected node y to decrease after top resize.');

      await context.close();
    } finally {
      await browser.close();
    }
  }
);

test(
  'annotation card preserves empty text and hides overlay after clearing content',
  { timeout: 90_000 },
  async () => {
    const { graphId, nodeId } = await createAnnotationGraph({
      text: '# Heading\n\n**Bold** text with $e^{i\\pi} + 1 = 0$.',
      backgroundColor: 'rgba(254,243,199,0)',
      borderColor: '#334155',
      cardWidth: DEFAULT_ANNOTATION_WIDTH,
      cardHeight: DEFAULT_ANNOTATION_HEIGHT,
    });

    const browser = await launchBrowser();
    try {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
      });
      const page = await context.newPage();
      await openCanvasForGraph(page, graphId);

      const canvas = page.locator('canvas').first();
      const canvasBox = await canvas.boundingBox();
      assert.ok(canvasBox, 'Canvas element should provide a bounding box');
      const nodeBox = resolveCenteredNodePosition(canvasBox);
      await ensureNodeSelected(page, nodeBox);

      const annotationOverlay = page.locator(`[data-testid="annotation-overlay-${nodeId}"]`);
      await annotationOverlay.waitFor({ state: 'visible', timeout: E2E_ASSERT_TIMEOUT_MS });

      const annotationInput = page.locator('[data-testid="annotation-markdown-input"]');
      const annotationFontSizeInput = page.locator('[data-testid="annotation-font-size-input"]');
      await annotationFontSizeInput.fill('22');
      await annotationFontSizeInput.evaluate((element) => {
        (element as HTMLInputElement).blur();
      });
      const persistedFontSize = await waitForAnnotationNodeFontSize(
        graphId,
        nodeId,
        (fontSize) => fontSize === 22,
        E2E_ASSERT_TIMEOUT_MS
      );
      assert.equal(persistedFontSize, 22, 'Expected annotation font size to persist after panel edit.');

      const renderedFontSize = await annotationOverlay.locator('.annotation-markdown').evaluate((element) => {
        return window.getComputedStyle(element as HTMLElement).fontSize;
      });
      assert.equal(renderedFontSize, '22px', 'Expected overlay markdown to render with updated font size.');

      await annotationInput.fill('');
      await annotationInput.evaluate((element) => {
        (element as HTMLTextAreaElement).blur();
      });

      const persistedText = await waitForAnnotationNodeText(
        graphId,
        nodeId,
        (text) => text === '',
        E2E_ASSERT_TIMEOUT_MS
      );
      assert.equal(persistedText, '', 'Expected cleared annotation text to persist as an empty string.');

      const overlayDetachedAt = Date.now() + E2E_ASSERT_TIMEOUT_MS;
      while (Date.now() < overlayDetachedAt) {
        if ((await annotationOverlay.count()) === 0) {
          break;
        }
        await page.waitForTimeout(120);
      }
      assert.equal(
        await annotationOverlay.count(),
        0,
        'Expected no annotation overlay when annotation text is empty.'
      );

      await context.close();
    } finally {
      await browser.close();
    }
  }
);
