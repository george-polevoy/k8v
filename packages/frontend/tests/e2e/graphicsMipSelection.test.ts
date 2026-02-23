import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { PNG } from 'pngjs';
import { launchBrowser, openCanvasForGraph } from './support/browser.ts';
import { E2E_ASSERT_TIMEOUT_MS, E2E_BACKEND_URL, E2E_FRONTEND_URL } from './support/config.ts';
import { ensureE2EEnvironment, shutdownE2EEnvironment } from './support/environment.ts';

const AUTOTEST_GRAPH_PREFIX = 'autotests_';
const NUMERIC_NODE_WIDTH = 220;

interface CreatedGraph {
  id: string;
}

interface GraphicsArtifact {
  id: string;
  levels: Array<{
    level: number;
    pixelCount: number;
  }>;
}

interface CanvasBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

function toAutotestGraphName(name: string): string {
  return name.startsWith(AUTOTEST_GRAPH_PREFIX)
    ? name
    : `${AUTOTEST_GRAPH_PREFIX}${name}`;
}

function createSolidPngDataUrl(width: number, height: number): string {
  const png = new PNG({ width, height });
  for (let index = 0; index < png.data.length; index += 4) {
    png.data[index] = 20; // R
    png.data[index + 1] = 100; // G
    png.data[index + 2] = 220; // B
    png.data[index + 3] = 255; // A
  }
  const base64 = PNG.sync.write(png).toString('base64');
  return `data:image/png;base64,${base64}`;
}

async function createGraphWithGraphicsNode(): Promise<{ graphId: string; nodeId: string }> {
  const nodeId = `gfx-node-${Date.now()}`;
  const pngDataUrl = createSolidPngDataUrl(1024, 1024);
  const code = `outputGraphics(${JSON.stringify(pngDataUrl)}); outputs.output = 1;`;

  const createResponse = await fetch(`${E2E_BACKEND_URL}/api/graphs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: toAutotestGraphName(`e2e_graphics_mip_${Date.now()}`),
      nodes: [
        {
          id: nodeId,
          type: 'inline_code',
          position: { x: 120, y: 140 },
          metadata: {
            name: 'Graphics Node',
            inputs: [],
            outputs: [{ name: 'output', schema: { type: 'number' } }],
          },
          config: {
            type: 'inline_code',
            runtime: 'javascript_vm',
            code,
          },
          version: `${Date.now()}`,
        },
      ],
      connections: [],
      drawings: [],
    }),
  });
  assert.equal(createResponse.status, 200, 'graph create should succeed');
  const createdGraph = await createResponse.json() as CreatedGraph;
  assert.ok(createdGraph.id, 'created graph should include id');

  const computeResponse = await fetch(`${E2E_BACKEND_URL}/api/graphs/${createdGraph.id}/compute`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ nodeId }),
  });
  assert.equal(computeResponse.status, 200, 'compute should succeed');

  return { graphId: createdGraph.id, nodeId };
}

async function waitForNodeGraphics(nodeId: string, timeoutMs = E2E_ASSERT_TIMEOUT_MS): Promise<GraphicsArtifact> {
  const startedAt = Date.now();
  while ((Date.now() - startedAt) < timeoutMs) {
    const response = await fetch(`${E2E_BACKEND_URL}/api/nodes/${nodeId}/result`);
    if (response.status === 200) {
      const payload = await response.json() as { graphics?: GraphicsArtifact };
      if (payload.graphics?.id && Array.isArray(payload.graphics.levels) && payload.graphics.levels.length > 0) {
        return payload.graphics;
      }
    }
    await delay(120);
  }

  throw new Error(`Timed out waiting for graphics output for node ${nodeId}`);
}

async function selectCenteredNode(
  page: import('playwright').Page,
  canvasBox: CanvasBox
): Promise<void> {
  const centerX = canvasBox.x + (canvasBox.width / 2);
  const centerY = canvasBox.y + (canvasBox.height / 2);
  const nodeLeft = centerX - (NUMERIC_NODE_WIDTH / 2);
  const clickTargets: Array<{ x: number; y: number }> = [
    { x: nodeLeft + 24, y: centerY - 30 },
    { x: centerX, y: centerY - 24 },
    { x: centerX, y: centerY },
    { x: nodeLeft + 96, y: centerY - 18 },
  ];

  const nodeNameInput = page.locator('[data-testid="node-name-input"]');
  for (const target of clickTargets) {
    await page.mouse.click(target.x, target.y);
    try {
      await nodeNameInput.waitFor({ state: 'visible', timeout: 2_000 });
      return;
    } catch {
      // Try next target.
    }
  }

  throw new Error('Failed to select centered node on canvas');
}

test.before(async () => {
  await ensureE2EEnvironment();
});

test.after(async () => {
  await shutdownE2EEnvironment();
});

test(
  'output image requests sharper mip level (2x pixel budget bias)',
  { timeout: 90_000 },
  async () => {
    const { graphId, nodeId } = await createGraphWithGraphicsNode();
    const graphics = await waitForNodeGraphics(nodeId);
    assert.ok(graphics.levels.some((level) => level.pixelCount === 262_144), 'expected 512x512 mip level');

    const browser = await launchBrowser();
    try {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 1,
      });
      const page = await context.newPage();

      await openCanvasForGraph(page, graphId);

      const canvas = page.locator('canvas').first();
      const canvasBox = await canvas.boundingBox();
      assert.ok(canvasBox, 'Canvas element should provide a bounding box');
      await selectCenteredNode(page, canvasBox);

      await page.locator('[data-testid="sidebar-toggle-output"]').click();
      await page.locator('[data-testid="sidebar-content-output"]').waitFor({
        state: 'visible',
        timeout: E2E_ASSERT_TIMEOUT_MS,
      });

      const outputImage = page.locator('img[alt="Node output"]');
      await outputImage.waitFor({ state: 'visible', timeout: E2E_ASSERT_TIMEOUT_MS });

      await page.evaluate(() => {
        const img = document.querySelector('img[alt="Node output"]');
        const viewport = img?.parentElement as HTMLDivElement | null;
        if (viewport) {
          viewport.style.width = '360px';
          viewport.style.height = '420px';
        }
      });

      await page.waitForFunction(
        (frontendUrl) => {
          const img = document.querySelector('img[alt="Node output"]') as HTMLImageElement | null;
          if (!img || !img.src) {
            return false;
          }
          const srcUrl = new URL(img.src, frontendUrl);
          return srcUrl.searchParams.get('maxPixels') === '262144';
        },
        E2E_FRONTEND_URL,
        { timeout: E2E_ASSERT_TIMEOUT_MS }
      );

      const finalImageSrc = await outputImage.getAttribute('src');
      assert.ok(finalImageSrc, 'output image src should be present');
      const finalImageUrl = new URL(finalImageSrc, E2E_FRONTEND_URL);
      assert.equal(finalImageUrl.searchParams.get('maxPixels'), '262144');

      await context.close();
    } finally {
      await browser.close();
    }
  }
);
