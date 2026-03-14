import { chromium, type Browser, type Page } from 'playwright';
import { E2E_ASSERT_TIMEOUT_MS, E2E_FRONTEND_URL } from './config.ts';

export async function launchBrowser(): Promise<Browser> {
  return chromium.launch({
    headless: true,
    args: ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
  });
}

export async function openCanvasForGraph(page: Page, graphId: string): Promise<void> {
  const graphLoadResponse = page.waitForResponse((response) =>
    response.request().method() === 'GET' &&
    response.url().endsWith(`/api/graphs/${graphId}`) &&
    response.ok()
  , {
    timeout: E2E_ASSERT_TIMEOUT_MS,
  });

  await page.addInitScript((savedGraphId: string) => {
    window.localStorage.setItem('k8v-current-graph-id', savedGraphId);
  }, graphId);

  await page.goto(E2E_FRONTEND_URL, {
    // App-level status polling can keep the network active; avoid networkidle flakiness.
    waitUntil: 'domcontentloaded',
    timeout: E2E_ASSERT_TIMEOUT_MS,
  });
  await page.locator('canvas').first().waitFor({
    state: 'visible',
    timeout: E2E_ASSERT_TIMEOUT_MS,
  });
  await graphLoadResponse;
  await page.locator('[data-testid="graph-select"]').first().waitFor({
    state: 'visible',
    timeout: E2E_ASSERT_TIMEOUT_MS,
  });
  await page.waitForFunction((expectedGraphId: string) => {
    const graphSelect = document.querySelector('[data-testid="graph-select"]');
    return graphSelect instanceof HTMLSelectElement && graphSelect.value === expectedGraphId;
  }, graphId, {
    timeout: E2E_ASSERT_TIMEOUT_MS,
  });
}

export async function readCanvasCursor(page: Page): Promise<string> {
  return page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    return canvas instanceof HTMLCanvasElement ? canvas.style.cursor : '';
  });
}

export async function waitForCursorAtPoint(
  page: Page,
  x: number,
  y: number,
  expectedCursor: string,
  timeoutMs = E2E_ASSERT_TIMEOUT_MS
): Promise<void> {
  const startedAt = Date.now();
  while ((Date.now() - startedAt) < timeoutMs) {
    await page.mouse.move(x, y);
    const cursor = await readCanvasCursor(page);
    if (cursor === expectedCursor) {
      return;
    }
    await page.waitForTimeout(40);
  }

  const cursor = await readCanvasCursor(page);
  throw new Error(
    `Timed out waiting for cursor "${expectedCursor}" at (${x.toFixed(1)}, ${y.toFixed(1)}). Current: "${cursor}".`
  );
}
