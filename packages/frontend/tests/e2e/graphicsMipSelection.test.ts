import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { PNG } from 'pngjs';
import { createSeededGraph, submitGraphCommands } from './support/api.ts';
import { launchBrowser, openCanvasForGraph } from './support/browser.ts';
import { E2E_ASSERT_TIMEOUT_MS, E2E_BACKEND_URL, E2E_FRONTEND_URL } from './support/config.ts';
import { ensureE2EEnvironment, shutdownE2EEnvironment } from './support/environment.ts';

const AUTOTEST_GRAPH_PREFIX = 'autotests_';
const NUMERIC_NODE_WIDTH = 220;

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

interface CanvasDebugCounters {
  fullRenderCount: number;
  viewportSyncCount: number;
  viewportDeferredRenderCount: number;
  projectedTextureRefreshDeferredCount: number;
  projectedTextureRefreshImmediateCount: number;
  viewportScale: number;
}

async function installCanvasDebugCounters(page: import('playwright').Page): Promise<void> {
  await page.addInitScript(() => {
    (window as Window & {
      __k8vCanvasDebug?: {
        fullRenderCount?: number;
        viewportSyncCount?: number;
        viewportDeferredRenderCount?: number;
        projectedTextureRefreshDeferredCount?: number;
        projectedTextureRefreshImmediateCount?: number;
      };
    }).__k8vCanvasDebug = {
      fullRenderCount: 0,
      viewportSyncCount: 0,
      viewportDeferredRenderCount: 0,
      projectedTextureRefreshDeferredCount: 0,
      projectedTextureRefreshImmediateCount: 0,
    };
  });
}

async function readCanvasDebugCounters(page: import('playwright').Page): Promise<CanvasDebugCounters> {
  return page.evaluate(() => {
    const counters = (window as Window & {
      __k8vCanvasDebug?: {
        fullRenderCount?: number;
        viewportSyncCount?: number;
        viewportDeferredRenderCount?: number;
        projectedTextureRefreshDeferredCount?: number;
        projectedTextureRefreshImmediateCount?: number;
      };
    }).__k8vCanvasDebug;
    return {
      fullRenderCount: counters?.fullRenderCount ?? 0,
      viewportSyncCount: counters?.viewportSyncCount ?? 0,
      viewportDeferredRenderCount: counters?.viewportDeferredRenderCount ?? 0,
      projectedTextureRefreshDeferredCount: counters?.projectedTextureRefreshDeferredCount ?? 0,
      projectedTextureRefreshImmediateCount: counters?.projectedTextureRefreshImmediateCount ?? 0,
      viewportScale: counters?.viewportScale ?? 1,
    };
  });
}

async function waitForCanvasDebugCountersToSettle(
  page: import('playwright').Page,
  timeoutMs = E2E_ASSERT_TIMEOUT_MS
): Promise<CanvasDebugCounters> {
  const startedAt = Date.now();
  let previousCounters = await readCanvasDebugCounters(page);

  while ((Date.now() - startedAt) < timeoutMs) {
    await page.waitForTimeout(180);
    const nextCounters = await readCanvasDebugCounters(page);
    if (
      nextCounters.fullRenderCount === previousCounters.fullRenderCount &&
      nextCounters.viewportSyncCount === previousCounters.viewportSyncCount &&
      nextCounters.viewportDeferredRenderCount === previousCounters.viewportDeferredRenderCount
    ) {
      return nextCounters;
    }
    previousCounters = nextCounters;
  }

  throw new Error(`Timed out waiting for canvas debug counters to settle. Last counters: ${JSON.stringify(previousCounters)}`);
}

async function waitForCanvasDebugCounters(
  page: import('playwright').Page,
  predicate: (counters: CanvasDebugCounters) => boolean,
  timeoutMs = E2E_ASSERT_TIMEOUT_MS
): Promise<CanvasDebugCounters> {
  const startedAt = Date.now();
  let lastCounters = await readCanvasDebugCounters(page);

  while ((Date.now() - startedAt) < timeoutMs) {
    if (predicate(lastCounters)) {
      return lastCounters;
    }

    await page.waitForTimeout(40);
    lastCounters = await readCanvasDebugCounters(page);
  }

  throw new Error(`Timed out waiting for canvas debug counters match. Last counters: ${JSON.stringify(lastCounters)}`);
}

async function installProjectedGraphicsRequestCapture(page: import('playwright').Page): Promise<string[]> {
  const capturedUrls: string[] = [];
  await page.route('**/api/graphics/*/image*', async (route) => {
    capturedUrls.push(route.request().url());
    if (capturedUrls.length > 200) {
      capturedUrls.splice(0, capturedUrls.length - 200);
    }
    await route.continue();
  });
  return capturedUrls;
}

async function waitForProjectedGraphicsRequest(
  capturedUrls: string[],
  predicate: (urls: string[]) => boolean,
  timeoutMs = E2E_ASSERT_TIMEOUT_MS
): Promise<string[]> {
  const startedAt = Date.now();
  while ((Date.now() - startedAt) < timeoutMs) {
    if (predicate(capturedUrls)) {
      return [...capturedUrls];
    }
    await delay(80);
  }

  throw new Error(`Timed out waiting for projected graphics request. Captured: ${JSON.stringify(capturedUrls)}`);
}

async function waitForProjectedGraphicsRequestChange(
  capturedUrls: string[],
  previousUrl: string,
  timeoutMs = E2E_ASSERT_TIMEOUT_MS
): Promise<string> {
  const startedAt = Date.now();
  while ((Date.now() - startedAt) < timeoutMs) {
    const nextUrl = capturedUrls[capturedUrls.length - 1] ?? '';
    if (nextUrl && nextUrl !== previousUrl) {
      return nextUrl;
    }
    await delay(80);
  }

  throw new Error(`Timed out waiting for projected graphics URL to change from ${previousUrl}`);
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
  const code = `outputPng(${JSON.stringify(pngDataUrl)})\noutputs.output = 1`;

  const createdGraph = await createSeededGraph({
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
          runtime: 'python_process',
          code,
        },
        version: `${Date.now()}`,
      },
    ],
    context: 'Create graphics mip graph',
  });
  await submitGraphCommands(
    createdGraph.id,
    createdGraph.revision ?? 0,
    [{ kind: 'compute_node', nodeId }],
    'Compute graphics mip node'
  );

  return { graphId: createdGraph.id, nodeId };
}

async function waitForNodeGraphics(
  graphId: string,
  nodeId: string,
  timeoutMs = E2E_ASSERT_TIMEOUT_MS
): Promise<GraphicsArtifact> {
  const startedAt = Date.now();
  while ((Date.now() - startedAt) < timeoutMs) {
    const response = await fetch(`${E2E_BACKEND_URL}/api/graphs/${graphId}/nodes/${nodeId}/result`);
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
    const graphics = await waitForNodeGraphics(graphId, nodeId);
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

test(
  'projected graphics do not swap mip levels during active viewport zooming',
  { timeout: 90_000 },
  async () => {
    const { graphId, nodeId } = await createGraphWithGraphicsNode();
    await waitForNodeGraphics(graphId, nodeId);

    const browser = await launchBrowser();
    try {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 1,
      });
      const page = await context.newPage();
      await installCanvasDebugCounters(page);
      const projectedGraphicsUrls = await installProjectedGraphicsRequestCapture(page);

      await openCanvasForGraph(page, graphId);

      const canvas = page.locator('canvas').first();
      const canvasBox = await canvas.boundingBox();
      assert.ok(canvasBox, 'Canvas element should provide a bounding box');

      const centerX = canvasBox.x + (canvasBox.width / 2);
      const centerY = canvasBox.y + (canvasBox.height / 2);

      await waitForProjectedGraphicsRequest(
        projectedGraphicsUrls,
        (urls) => urls.length > 0
      );

      const initialProjectedUrl = projectedGraphicsUrls[projectedGraphicsUrls.length - 1] ?? '';
      assert.ok(initialProjectedUrl, 'Expected an initial projected graphics URL');
      const baselineCounters = await waitForCanvasDebugCountersToSettle(page);
      const baselineViewportScale = baselineCounters.viewportScale;
      let zoomedViewportScale = baselineViewportScale;

      for (let step = 0; step < 16; step += 1) {
        await page.evaluate(({ x, y }) => {
          const mainCanvas = document.querySelector('canvas');
          if (!(mainCanvas instanceof HTMLCanvasElement)) {
            throw new Error('Main canvas not found');
          }
          mainCanvas.dispatchEvent(new WheelEvent('wheel', {
            deltaX: 0,
            deltaY: -60,
            ctrlKey: true,
            clientX: x,
            clientY: y,
            bubbles: true,
            cancelable: true,
          }));
        }, { x: centerX, y: centerY });
        await delay(30);
        zoomedViewportScale = (await readCanvasDebugCounters(page)).viewportScale;
        if (zoomedViewportScale >= (baselineViewportScale * 1.8)) {
          break;
        }
      }
      assert.ok(
        zoomedViewportScale >= (baselineViewportScale * 1.8),
        `Expected the zoom burst to materially increase viewport scale (${baselineViewportScale} -> ${zoomedViewportScale})`
      );

      await delay(140);
      const duringZoomUrl = projectedGraphicsUrls[projectedGraphicsUrls.length - 1] ?? '';
      assert.equal(
        duringZoomUrl,
        initialProjectedUrl,
        `Expected projected graphics URL to remain stable during active zoom burst (${initialProjectedUrl} vs ${duringZoomUrl})`
      );

      const settledUrl = await waitForProjectedGraphicsRequestChange(
        projectedGraphicsUrls,
        initialProjectedUrl
      );
      assert.notEqual(
        settledUrl,
        initialProjectedUrl,
        'Expected projected graphics URL to update after viewport zooming settled'
      );

      await context.close();
    } finally {
      await browser.close();
    }
  }
);

test(
  'projected graphics texture load does not trigger a full rerender during active viewport motion',
  { timeout: 90_000 },
  async () => {
    const { graphId, nodeId } = await createGraphWithGraphicsNode();
    await waitForNodeGraphics(graphId, nodeId);

    const browser = await launchBrowser();
    try {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 1,
      });
      const page = await context.newPage();
      let delayedProjectedRequestCount = 0;
      let releaseDelayedProjectedRequest: (() => void) | null = null;
      let delayedProjectedRequestReleased = false;
      const waitForDelayedProjectedRequestRelease = new Promise<void>((resolveRelease) => {
        releaseDelayedProjectedRequest = () => {
          if (delayedProjectedRequestReleased) {
            return;
          }
          delayedProjectedRequestReleased = true;
          resolveRelease();
        };
      });

      await page.route('**/api/graphics/*/image*', async (route) => {
        delayedProjectedRequestCount += 1;
        if (delayedProjectedRequestCount === 1) {
          await waitForDelayedProjectedRequestRelease;
        }
        await route.continue();
      });
      await installCanvasDebugCounters(page);

      await openCanvasForGraph(page, graphId);

      const canvas = page.locator('canvas').first();
      const canvasBox = await canvas.boundingBox();
      assert.ok(canvasBox, 'Canvas element should provide a bounding box');

      const centerX = canvasBox.x + (canvasBox.width / 2);
      const centerY = canvasBox.y + (canvasBox.height / 2);

      const requestSeenStartedAt = Date.now();
      while (delayedProjectedRequestCount < 1 && (Date.now() - requestSeenStartedAt) < E2E_ASSERT_TIMEOUT_MS) {
        await page.waitForTimeout(40);
      }
      assert.ok(delayedProjectedRequestCount >= 1, 'Expected the initial projected graphics request to start');
      const baselineCounters = await waitForCanvasDebugCountersToSettle(page);

      for (let step = 0; step < 18; step += 1) {
        if (step === 2) {
          releaseDelayedProjectedRequest?.();
        }
        await page.evaluate(({ x, y }) => {
          const mainCanvas = document.querySelector('canvas');
          if (!(mainCanvas instanceof HTMLCanvasElement)) {
            throw new Error('Main canvas not found');
          }
          mainCanvas.dispatchEvent(new WheelEvent('wheel', {
            deltaX: 14,
            deltaY: 10,
            clientX: x,
            clientY: y,
            bubbles: true,
            cancelable: true,
          }));
        }, { x: centerX, y: centerY });
        await page.waitForTimeout(50);
      }

      releaseDelayedProjectedRequest?.();

      const duringInteractionCounters = await readCanvasDebugCounters(page);
      assert.equal(
        duringInteractionCounters.projectedTextureRefreshImmediateCount,
        baselineCounters.projectedTextureRefreshImmediateCount,
        `Expected no immediate projected texture refresh while wheel motion is still active (${baselineCounters.projectedTextureRefreshImmediateCount} vs ${duringInteractionCounters.projectedTextureRefreshImmediateCount})`
      );
      const postMotionRefreshCounters = await waitForCanvasDebugCounters(
        page,
        (counters) =>
          counters.projectedTextureRefreshDeferredCount >
            baselineCounters.projectedTextureRefreshDeferredCount ||
          counters.projectedTextureRefreshImmediateCount >
            baselineCounters.projectedTextureRefreshImmediateCount
      );
      assert.ok(
        postMotionRefreshCounters.projectedTextureRefreshDeferredCount >
          baselineCounters.projectedTextureRefreshDeferredCount ||
        postMotionRefreshCounters.projectedTextureRefreshImmediateCount >
          baselineCounters.projectedTextureRefreshImmediateCount,
        `Expected projected texture refresh bookkeeping to advance after viewport motion settled (${JSON.stringify(baselineCounters)} -> ${JSON.stringify(postMotionRefreshCounters)})`
      );

      const refreshedCounters = await waitForCanvasDebugCounters(
        page,
        (counters) => counters.fullRenderCount > duringInteractionCounters.fullRenderCount
      );
      assert.ok(
        refreshedCounters.fullRenderCount > duringInteractionCounters.fullRenderCount,
        'Expected the delayed projected texture to trigger a rerender after viewport motion settled'
      );

      await context.close();
    } finally {
      await browser.close();
    }
  }
);
