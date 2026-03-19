import assert from 'node:assert/strict';
import test from 'node:test';
import { createEmptyGraph } from './support/api.ts';
import { launchBrowser } from './support/browser.ts';
import {
  E2E_ASSERT_TIMEOUT_MS,
  E2E_BACKEND_URL,
  E2E_FRONTEND_URL,
} from './support/config.ts';
import { ensureE2EEnvironment, shutdownE2EEnvironment } from './support/environment.ts';

test.before(async () => {
  await ensureE2EEnvironment();
});

test.after(async () => {
  await shutdownE2EEnvironment();
});

test(
  'screenshot harness renders canvas without interactive app chrome',
  { timeout: 90_000 },
  async () => {
    const { graphId } = await createEmptyGraph('E2E Screenshot Harness');
    const graph = await fetch(`${E2E_BACKEND_URL}/api/graphs/${graphId}`).then(async (response) => {
      assert.equal(response.ok, true, 'Expected screenshot harness test graph to load from backend.');
      return await response.json();
    });
    const runtimeState = await fetch(`${E2E_BACKEND_URL}/api/graphs/${graphId}/runtime-state`).then(async (response) => {
      assert.equal(response.ok, true, 'Expected screenshot harness runtime state to load from backend.');
      return await response.json();
    });
    const browser = await launchBrowser();
    try {
      const context = await browser.newContext({
        viewport: { width: 920, height: 540 },
      });
      const page = await context.newPage();

      await page.addInitScript((bootstrap) => {
        (window as any).__k8vScreenshotHarnessBootstrap = bootstrap;
      }, {
        graph,
        runtimeState,
        backendUrl: E2E_BACKEND_URL,
      });

      await page.goto(`${E2E_FRONTEND_URL}/screenshot.html`, {
        waitUntil: 'domcontentloaded',
        timeout: E2E_ASSERT_TIMEOUT_MS,
      });

      await page.locator('[data-testid="canvas-root"]').waitFor({
        state: 'visible',
        timeout: E2E_ASSERT_TIMEOUT_MS,
      });
      await page.locator('canvas').first().waitFor({
        state: 'visible',
        timeout: E2E_ASSERT_TIMEOUT_MS,
      });

      assert.equal(
        await page.locator('[data-testid="floating-window-toolbar"]').count(),
        0,
        'Expected toolbar floating window to be absent from the screenshot harness.'
      );
      assert.equal(
        await page.locator('[data-testid="floating-window-right-sidebar"]').count(),
        0,
        'Expected right sidebar floating window to be absent from the screenshot harness.'
      );

      await page.waitForFunction(() => {
        const bridge = (window as any).__k8vScreenshotHarness;
        return Boolean(
          bridge &&
            typeof bridge.isCanvasReady === 'function' &&
            typeof bridge.isGraphReady === 'function' &&
            typeof bridge.setViewportRegion === 'function' &&
            bridge.isCanvasReady() &&
            bridge.isGraphReady()
        );
      }, { timeout: E2E_ASSERT_TIMEOUT_MS });

      const applied = await page.evaluate(() => {
        const bridge = (window as any).__k8vScreenshotHarness;
        if (!bridge) {
          return false;
        }
        return bridge.setViewportRegion(
          { x: -200, y: -120, width: 920, height: 540 },
          { width: 920, height: 540 }
        );
      });
      assert.equal(applied, true, 'Expected screenshot harness bridge to accept viewport region update.');

      await context.close();
    } finally {
      await browser.close();
    }
  }
);
