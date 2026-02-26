import assert from 'node:assert/strict';
import test from 'node:test';
import { PNG } from 'pngjs';
import { createNumericInputGraph } from './support/api.ts';
import { launchBrowser, openCanvasForGraph } from './support/browser.ts';
import { E2E_ASSERT_TIMEOUT_MS, E2E_BACKEND_URL } from './support/config.ts';
import { ensureE2EEnvironment, shutdownE2EEnvironment } from './support/environment.ts';

interface BrightRegionBounds {
  minX: number;
  maxX: number;
}

function findNodeCardCenterXInScreenshot(
  screenshotPng: Buffer,
  bounds: BrightRegionBounds
): number | null {
  const image = PNG.sync.read(screenshotPng);
  const scanXMin = Math.max(0, Math.round(bounds.minX));
  const scanXMax = Math.min(image.width - 1, Math.round(bounds.maxX));

  let brightestMin = Number.POSITIVE_INFINITY;
  let brightestMax = Number.NEGATIVE_INFINITY;
  let brightPixelCount = 0;

  for (let y = 0; y < image.height; y += 1) {
    for (let x = scanXMin; x <= scanXMax; x += 1) {
      const index = ((y * image.width) + x) * 4;
      const r = image.data[index] ?? 0;
      const g = image.data[index + 1] ?? 0;
      const b = image.data[index + 2] ?? 0;
      const a = image.data[index + 3] ?? 0;
      if (a >= 200 && r >= 220 && g >= 220 && b >= 220) {
        brightestMin = Math.min(brightestMin, x);
        brightestMax = Math.max(brightestMax, x);
        brightPixelCount += 1;
      }
    }
  }

  if (!Number.isFinite(brightestMin) || !Number.isFinite(brightestMax)) {
    return null;
  }
  if (brightPixelCount < 3_000) {
    return null;
  }

  // Ignore tiny bright fragments from anti-aliasing and focus on node-card sized spans.
  if ((brightestMax - brightestMin) < 100) {
    return null;
  }

  return (brightestMin + brightestMax) / 2;
}

async function fetchNodePosition(graphId: string, nodeId: string): Promise<{ x: number; y: number }> {
  const response = await fetch(`${E2E_BACKEND_URL}/api/graphs/${graphId}`, {
    method: 'GET',
    headers: { accept: 'application/json' },
  });
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

      const startX = canvasBox.x + (canvasBox.width / 2);
      const startY = canvasBox.y + (canvasBox.height / 2);

      await page.mouse.move(startX, startY);
      await page.mouse.down();
      await page.mouse.move(startX + 250, startY + 30, { steps: 18 });
      await page.waitForTimeout(120);

      const movedScreenshot = await canvas.screenshot();
      const movedCenterX = findNodeCardCenterXInScreenshot(movedScreenshot, {
        minX: canvasBox.width * 0.55,
        maxX: canvasBox.width - 10,
      });
      assert.ok(movedCenterX !== null, 'Expected to detect node card after drag move');

      // Hold drag beyond recompute polling interval (400ms) to force canvas rerenders.
      await page.waitForTimeout(1_000);

      const heldScreenshot = await canvas.screenshot();
      const heldCenterX = findNodeCardCenterXInScreenshot(heldScreenshot, {
        minX: canvasBox.width * 0.55,
        maxX: canvasBox.width - 10,
      });
      assert.ok(heldCenterX !== null, 'Expected to detect node card while drag is still held');
      if (movedCenterX === null || heldCenterX === null) {
        throw new Error('Node card detection should have produced non-null values before drift assertion.');
      }
      assert.ok(
        Math.abs(heldCenterX - movedCenterX) <= 18,
        `Dragged node should stay in place while held. moved=${movedCenterX} held=${heldCenterX}`
      );

      await page.mouse.up();

      const startedAt = Date.now();
      let persistedPosition: { x: number; y: number } | null = null;
      while ((Date.now() - startedAt) < E2E_ASSERT_TIMEOUT_MS) {
        const position = await fetchNodePosition(graphId, nodeId);
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
