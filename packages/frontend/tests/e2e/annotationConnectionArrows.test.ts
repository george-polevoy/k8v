import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createAnnotationArrowGraph,
  waitForGraphConnections,
} from './support/api.ts';
import {
  launchBrowser,
  openCanvasForGraph,
  waitForCursorAtPoint,
} from './support/browser.ts';
import { E2E_ASSERT_TIMEOUT_MS } from './support/config.ts';
import { ensureE2EEnvironment, shutdownE2EEnvironment } from './support/environment.ts';

const VIEWPORT_MARGIN = 100;
const GRAPH_BOUNDS = {
  minX: 100,
  minY: 100,
  maxX: 1140,
  maxY: 300,
};

interface CanvasBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface WorldPoint {
  x: number;
  y: number;
}

function resolveWorldPointToScreen(canvasBox: CanvasBox, point: WorldPoint): { x: number; y: number } {
  const graphWidth = GRAPH_BOUNDS.maxX - GRAPH_BOUNDS.minX;
  const graphHeight = GRAPH_BOUNDS.maxY - GRAPH_BOUNDS.minY;
  const scale = Math.min(
    (canvasBox.width - (VIEWPORT_MARGIN * 2)) / graphWidth,
    (canvasBox.height - (VIEWPORT_MARGIN * 2)) / graphHeight,
    1
  );
  const viewportX = (canvasBox.width / 2) - (((GRAPH_BOUNDS.minX + GRAPH_BOUNDS.maxX) * 0.5) * scale);
  const viewportY = (canvasBox.height / 2) - (((GRAPH_BOUNDS.minY + GRAPH_BOUNDS.maxY) * 0.5) * scale);

  return {
    x: canvasBox.x + viewportX + (point.x * scale),
    y: canvasBox.y + viewportY + (point.y * scale),
  };
}

async function dragConnection(
  page: import('playwright').Page,
  from: { x: number; y: number },
  to: { x: number; y: number }
): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 20 });
  await page.mouse.up();
}

test.before(async () => {
  await ensureE2EEnvironment();
});

test.after(async () => {
  await shutdownE2EEnvironment();
});

test(
  'annotation cards create persisted arrows from arbitrary card edges',
  { timeout: 90_000 },
  async () => {
    const {
      graphId,
      leftAnnotationId,
      inlineNodeId,
      rightAnnotationId,
    } = await createAnnotationArrowGraph();

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

      const leftBottomEdge = resolveWorldPointToScreen(canvasBox, {
        x: 100 + (320 * 0.25),
        y: 300,
      });
      const inlineInput = resolveWorldPointToScreen(canvasBox, {
        x: 500,
        y: 166 + 49,
      });
      const inlineOutput = resolveWorldPointToScreen(canvasBox, {
        x: 720,
        y: 166 + 49,
      });
      const rightTopEdge = resolveWorldPointToScreen(canvasBox, {
        x: 820 + (320 * 0.75),
        y: 100,
      });

      await waitForCursorAtPoint(page, leftBottomEdge.x, leftBottomEdge.y, 'crosshair');
      await waitForCursorAtPoint(page, inlineInput.x, inlineInput.y, 'crosshair');
      await dragConnection(page, leftBottomEdge, inlineInput);

      await waitForCursorAtPoint(page, inlineOutput.x, inlineOutput.y, 'crosshair');
      await waitForCursorAtPoint(page, rightTopEdge.x, rightTopEdge.y, 'crosshair');
      await dragConnection(page, inlineOutput, rightTopEdge);

      const connections = await waitForGraphConnections(
        graphId,
        (items) => items.length === 2,
        E2E_ASSERT_TIMEOUT_MS
      );

      const annotationToInline = connections.find((connection) =>
        connection.sourceNodeId === leftAnnotationId &&
        connection.targetNodeId === inlineNodeId
      );
      assert.ok(annotationToInline, 'Expected a persisted annotation-to-inline arrow');
      assert.equal(annotationToInline.sourcePort, '__annotation__');
      assert.equal(annotationToInline.targetPort, 'input');
      assert.equal(annotationToInline.sourceAnchor?.side, 'bottom');
      assert.ok(
        Math.abs((annotationToInline.sourceAnchor?.offset ?? 0) - 0.25) < 0.05,
        `Expected bottom-edge anchor near 0.25, received ${annotationToInline.sourceAnchor?.offset}`
      );

      const inlineToAnnotation = connections.find((connection) =>
        connection.sourceNodeId === inlineNodeId &&
        connection.targetNodeId === rightAnnotationId
      );
      assert.ok(inlineToAnnotation, 'Expected a persisted inline-to-annotation arrow');
      assert.equal(inlineToAnnotation.sourcePort, 'output');
      assert.equal(inlineToAnnotation.targetPort, '__annotation__');
      assert.equal(inlineToAnnotation.targetAnchor?.side, 'top');
      assert.ok(
        Math.abs((inlineToAnnotation.targetAnchor?.offset ?? 0) - 0.75) < 0.05,
        `Expected top-edge anchor near 0.75, received ${inlineToAnnotation.targetAnchor?.offset}`
      );

      await context.close();
    } finally {
      await browser.close();
    }
  }
);
