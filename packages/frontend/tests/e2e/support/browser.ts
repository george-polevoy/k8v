import { chromium, type Browser, type Page } from 'playwright';
import { E2E_ASSERT_TIMEOUT_MS, E2E_FRONTEND_URL } from './config.ts';

export async function launchBrowser(): Promise<Browser> {
  return chromium.launch({
    headless: true,
    args: ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
  });
}

const ACTIVE_GRAPH_WAIT_PREDICATE = (expectedGraphId: string) => {
  const graphSelect = document.querySelector('[data-testid="graph-select"]');
  const selectMatches = graphSelect instanceof HTMLSelectElement && graphSelect.value === expectedGraphId;
  const activeGraphId = (window as Window & {
    __k8vGraphStore?: {
      getState: () => {
        graph?: { id?: string | null } | null;
      };
    };
  }).__k8vGraphStore?.getState().graph?.id;

  return selectMatches || activeGraphId === expectedGraphId;
};

async function openCanvasForGraphOnce(page: Page, graphId: string): Promise<void> {
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
  await graphLoadResponse.catch(() => undefined);
  await page.locator('[data-testid="graph-select"]').first().waitFor({
    state: 'visible',
    timeout: E2E_ASSERT_TIMEOUT_MS,
  });
  try {
    await page.waitForFunction(ACTIVE_GRAPH_WAIT_PREDICATE, graphId, {
      timeout: Math.floor(E2E_ASSERT_TIMEOUT_MS / 2),
    });
  } catch {
    await page.waitForFunction(() => Boolean((window as Window & {
      __k8vGraphStore?: {
        getState: () => {
          graph?: { id?: string | null } | null;
          loadGraph: (graphId: string) => Promise<void>;
          refreshGraphSummaries?: () => Promise<void>;
        };
      };
    }).__k8vGraphStore), {
      timeout: E2E_ASSERT_TIMEOUT_MS,
    });
    await page.evaluate(async (expectedGraphId: string) => {
      const store = (window as Window & {
        __k8vGraphStore?: {
          getState: () => {
            graph?: { id?: string | null } | null;
            loadGraph: (graphId: string) => Promise<void>;
            refreshGraphSummaries?: () => Promise<void>;
          };
        };
      }).__k8vGraphStore;
      const state = store?.getState();
      if (!state) {
        throw new Error('Graph store not ready');
      }
      await state.refreshGraphSummaries?.().catch(() => undefined);

      const graphSelect = document.querySelector('[data-testid="graph-select"]');
      if (graphSelect instanceof HTMLSelectElement && graphSelect.value !== expectedGraphId) {
        const matchingOption = Array.from(graphSelect.options).some((option) => option.value === expectedGraphId);
        if (matchingOption) {
          graphSelect.value = expectedGraphId;
          graphSelect.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }

      if (store.getState().graph?.id !== expectedGraphId) {
        await state.loadGraph(expectedGraphId).catch(() => undefined);
      }
    }, graphId);
    await page.waitForFunction(ACTIVE_GRAPH_WAIT_PREDICATE, graphId, {
      timeout: E2E_ASSERT_TIMEOUT_MS,
    });
  }
}

export async function openCanvasForGraph(page: Page, graphId: string): Promise<void> {
  let lastError: unknown;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await openCanvasForGraphOnce(page, graphId);
      return;
    } catch (error) {
      lastError = error;
      if (attempt === 1) {
        break;
      }
      await page.goto('about:blank', { waitUntil: 'load', timeout: E2E_ASSERT_TIMEOUT_MS }).catch(() => undefined);
    }
  }

  throw lastError;
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
