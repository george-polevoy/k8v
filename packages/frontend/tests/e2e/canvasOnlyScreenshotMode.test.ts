import assert from 'node:assert/strict';
import test from 'node:test';
import { createEmptyGraph } from './support/api.ts';
import { launchBrowser } from './support/browser.ts';
import { E2E_ASSERT_TIMEOUT_MS, E2E_FRONTEND_URL } from './support/config.ts';
import { ensureE2EEnvironment, shutdownE2EEnvironment } from './support/environment.ts';

test.before(async () => {
  await ensureE2EEnvironment();
});

test.after(async () => {
  await shutdownE2EEnvironment();
});

test(
  'canvasOnly mode hides floating windows and exposes screenshot bridge',
  { timeout: 90_000 },
  async () => {
    const { graphId } = await createEmptyGraph('E2E Canvas Only Screenshot');
    const browser = await launchBrowser();
    try {
      const context = await browser.newContext({
        viewport: { width: 920, height: 540 },
      });
      const page = await context.newPage();

      await page.addInitScript((savedGraphId: string) => {
        window.localStorage.clear();
        window.localStorage.setItem('k8v-current-graph-id', savedGraphId);
      }, graphId);

      await page.goto(`${E2E_FRONTEND_URL}?canvasOnly=1&mcpScreenshot=1`, {
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
        'Expected toolbar floating window to be hidden in canvasOnly mode.'
      );
      assert.equal(
        await page.locator('[data-testid="floating-window-right-sidebar"]').count(),
        0,
        'Expected right sidebar floating window to be hidden in canvasOnly mode.'
      );

      await page.waitForFunction(() => {
        const bridge = (window as any).__k8vMcpScreenshotBridge;
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
        const bridge = (window as any).__k8vMcpScreenshotBridge;
        if (!bridge) {
          return false;
        }
        return bridge.setViewportRegion(
          { x: -200, y: -120, width: 920, height: 540 },
          { width: 920, height: 540 }
        );
      });
      assert.equal(applied, true, 'Expected canvas screenshot bridge to accept viewport region update.');

      await context.close();
    } finally {
      await browser.close();
    }
  }
);
