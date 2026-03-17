import assert from 'node:assert/strict';
import test from 'node:test';
import { PNG } from 'pngjs';
import { createNumericInputGraph } from './support/api.ts';
import { launchBrowser, openCanvasForGraph } from './support/browser.ts';
import { E2E_ASSERT_TIMEOUT_MS, E2E_BACKEND_URL } from './support/config.ts';
import { ensureE2EEnvironment, shutdownE2EEnvironment } from './support/environment.ts';

const DEFAULT_NUMERIC_NODE_WIDTH = 220;

interface ScreenshotDiffStats {
  changedPixels: number;
  totalPixels: number;
  changedPixelRatio: number;
}

function measureScreenshotDifference(
  firstScreenshotPng: Buffer,
  secondScreenshotPng: Buffer,
  channelDeltaThreshold = 12
): ScreenshotDiffStats {
  const firstImage = PNG.sync.read(firstScreenshotPng);
  const secondImage = PNG.sync.read(secondScreenshotPng);
  assert.equal(
    firstImage.width,
    secondImage.width,
    'Expected both screenshots to have the same width for diffing.'
  );
  assert.equal(
    firstImage.height,
    secondImage.height,
    'Expected both screenshots to have the same height for diffing.'
  );

  let changedPixels = 0;
  const totalPixels = firstImage.width * firstImage.height;

  for (let index = 0; index < firstImage.data.length; index += 4) {
    const redDelta = Math.abs((firstImage.data[index] ?? 0) - (secondImage.data[index] ?? 0));
    const greenDelta = Math.abs((firstImage.data[index + 1] ?? 0) - (secondImage.data[index + 1] ?? 0));
    const blueDelta = Math.abs((firstImage.data[index + 2] ?? 0) - (secondImage.data[index + 2] ?? 0));
    const alphaDelta = Math.abs((firstImage.data[index + 3] ?? 0) - (secondImage.data[index + 3] ?? 0));
    if (
      redDelta > channelDeltaThreshold ||
      greenDelta > channelDeltaThreshold ||
      blueDelta > channelDeltaThreshold ||
      alphaDelta > channelDeltaThreshold
    ) {
      changedPixels += 1;
    }
  }

  return {
    changedPixels,
    totalPixels,
    changedPixelRatio: changedPixels / Math.max(1, totalPixels),
  };
}

async function fetchNodePosition(graphId: string, nodeId: string): Promise<{ x: number; y: number } | null> {
  const response = await fetch(`${E2E_BACKEND_URL}/api/graphs/${graphId}`, {
    method: 'GET',
    headers: { accept: 'application/json' },
  });
  if (response.status === 404) {
    return null;
  }
  assert.equal(response.status, 200, `Expected graph ${graphId} to be readable`);
  const graph = await response.json() as {
    nodes?: Array<{ id?: string; position?: { x?: unknown; y?: unknown } }>;
  };
  const node = graph.nodes?.find((candidate) => candidate.id === nodeId);
  assert.ok(node, `Expected graph ${graphId} to include node ${nodeId}`);
  const x = node.position?.x;
  const y = node.position?.y;
  assert.equal(typeof x, 'number');
  assert.equal(typeof y, 'number');
  return {
    x,
    y,
  };
}

async function findCenteredNodeDragPoint(
  page: import('playwright').Page,
  canvasBox: { x: number; y: number; width: number; height: number }
): Promise<{ x: number; y: number }> {
  const centerX = canvasBox.x + (canvasBox.width / 2);
  const centerY = canvasBox.y + (canvasBox.height / 2);
  const nodeLeft = centerX - (DEFAULT_NUMERIC_NODE_WIDTH / 2);
  const candidatePoints: Array<{ x: number; y: number }> = [
    { x: nodeLeft + 28, y: centerY - 24 },
    { x: centerX - 18, y: centerY - 18 },
    { x: centerX, y: centerY },
    { x: centerX + 28, y: centerY + 12 },
  ];
  const nodeNameInput = page.locator('[data-testid="node-name-input"]');

  for (const point of candidatePoints) {
    await page.mouse.click(point.x, point.y);
    try {
      await nodeNameInput.waitFor({ state: 'visible', timeout: 1_500 });
      return point;
    } catch {
      // Try the next likely point inside the centered node card.
    }
  }

  throw new Error('Expected to locate the centered numeric node before dragging');
}

test.before(async () => {
  await ensureE2EEnvironment();
});

test.after(async () => {
  await shutdownE2EEnvironment();
});

test(
  'node drag stays visually stable while recompute polling re-renders canvas',
  { timeout: 90_000 },
  async () => {
    const { graphId, nodeId } = await createNumericInputGraph({
      value: 10,
      min: 0,
      max: 100,
      step: 1,
      nodePosition: { x: 120, y: 140 },
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
      assert.ok(canvasBox, 'Canvas should provide a bounding box');

      const dragStartPoint = await findCenteredNodeDragPoint(page, canvasBox);
      const baselineScreenshot = await canvas.screenshot();

      await page.mouse.move(dragStartPoint.x, dragStartPoint.y);
      await page.mouse.down();
      await page.mouse.move(dragStartPoint.x + 250, dragStartPoint.y + 30, { steps: 18 });
      await page.waitForTimeout(120);

      const movedScreenshot = await canvas.screenshot();
      const dragMoveDiff = measureScreenshotDifference(baselineScreenshot, movedScreenshot);
      assert.ok(
        dragMoveDiff.changedPixelRatio >= 0.01,
        `Expected drag move to visibly shift canvas content. ` +
          `changed=${dragMoveDiff.changedPixels}/${dragMoveDiff.totalPixels} ` +
          `ratio=${dragMoveDiff.changedPixelRatio.toFixed(4)}`
      );

      // Hold drag beyond recompute polling interval (400ms) to force canvas rerenders.
      await page.waitForTimeout(1_000);

      const heldScreenshot = await canvas.screenshot();
      const holdDriftDiff = measureScreenshotDifference(movedScreenshot, heldScreenshot);
      assert.ok(
        holdDriftDiff.changedPixelRatio <= 0.004,
        `Dragged node should stay visually stable while held. ` +
          `changed=${holdDriftDiff.changedPixels}/${holdDriftDiff.totalPixels} ` +
          `ratio=${holdDriftDiff.changedPixelRatio.toFixed(4)}`
      );

      await page.mouse.up();

      const startedAt = Date.now();
      let persistedPosition: { x: number; y: number } | null = null;
      while ((Date.now() - startedAt) < E2E_ASSERT_TIMEOUT_MS) {
        const position = await fetchNodePosition(graphId, nodeId);
        if (!position) {
          await page.waitForTimeout(120);
          continue;
        }
        if (position.x >= 300) {
          persistedPosition = position;
          break;
        }
        await page.waitForTimeout(120);
      }

      assert.ok(
        persistedPosition && persistedPosition.x >= 300,
        `Expected dragged x-position to persist >= 300. Last value: ${JSON.stringify(persistedPosition)}`
      );

      await context.close();
    } finally {
      await browser.close();
    }
  }
);
