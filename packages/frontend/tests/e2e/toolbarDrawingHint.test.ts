import assert from 'node:assert/strict';
import test from 'node:test';
import { createEmptyGraph } from './support/api.ts';
import { launchBrowser, openCanvasForGraph, openSidebarSection } from './support/browser.ts';
import { E2E_ASSERT_TIMEOUT_MS } from './support/config.ts';
import { ensureE2EEnvironment, shutdownE2EEnvironment } from './support/environment.ts';

test.before(async () => {
  await ensureE2EEnvironment();
});

test.after(async () => {
  await shutdownE2EEnvironment();
});

test(
  'drawing-hint text wraps inside the Tools section without horizontal overflow',
  { timeout: 90_000 },
  async () => {
    const { graphId } = await createEmptyGraph('E2E Toolbar Drawing Hint');

    const browser = await launchBrowser();
    try {
      const context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
      });
      const page = await context.newPage();
      await openCanvasForGraph(page, graphId);
      await openSidebarSection(page, 'tools');

      const drawingHint = page.getByText('Create/select drawing').first();
      await drawingHint.waitFor({ state: 'visible', timeout: E2E_ASSERT_TIMEOUT_MS });

      const metrics = await drawingHint.evaluate((node) => {
        const element = node as HTMLElement;
        const style = window.getComputedStyle(element);
        return {
          scrollWidth: element.scrollWidth,
          clientWidth: element.clientWidth,
          overflowWrap: style.overflowWrap,
          whiteSpace: style.whiteSpace,
        };
      });

      assert.ok(
        metrics.scrollWidth <= metrics.clientWidth + 1,
        `Expected wrapped text with no horizontal overflow. scrollWidth=${metrics.scrollWidth}, clientWidth=${metrics.clientWidth}`
      );
      assert.equal(metrics.overflowWrap, 'anywhere');
      assert.equal(metrics.whiteSpace, 'normal');

      await context.close();
    } finally {
      await browser.close();
    }
  }
);
