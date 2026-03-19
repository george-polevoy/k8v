import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { PNG } from 'pngjs';
import { createSeededGraph, submitGraphCommands } from './support/api.ts';
import { launchBrowser, openCanvasForGraph } from './support/browser.ts';
import { E2E_ASSERT_TIMEOUT_MS, E2E_BACKEND_URL } from './support/config.ts';
import { ensureE2EEnvironment, shutdownE2EEnvironment } from './support/environment.ts';

interface GraphicsArtifact {
  id: string;
  levels: Array<{
    level: number;
    pixelCount: number;
  }>;
}

interface RuntimeStateResponse {
  graphId: string;
  revision: number;
  statusVersion: number;
  queueLength: number;
  workerConcurrency: number;
  nodeStates: Record<string, unknown>;
  results: Record<string, {
    graphics?: GraphicsArtifact;
  }>;
}

function createSolidPngDataUrl(width: number, height: number): string {
  const png = new PNG({ width, height });
  for (let index = 0; index < png.data.length; index += 4) {
    png.data[index] = 20;
    png.data[index + 1] = 100;
    png.data[index + 2] = 220;
    png.data[index + 3] = 255;
  }
  const base64 = PNG.sync.write(png).toString('base64');
  return `data:image/png;base64,${base64}`;
}

async function createGraphWithGraphicsNode(): Promise<{ graphId: string; nodeId: string }> {
  const nodeId = `gfx-node-${Date.now()}`;
  const pngDataUrl = createSolidPngDataUrl(1024, 1024);
  const code = `outputPng(${JSON.stringify(pngDataUrl)})\noutputs.output = 1`;

  const graph = await createSeededGraph({
    name: `graphics_refresh_persistence_${Date.now()}`,
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
    context: 'Create graphics refresh graph',
  });

  await submitGraphCommands(
    graph.id,
    graph.revision ?? 0,
    [{ kind: 'compute_node', nodeId }],
    'Compute graphics refresh node'
  );

  return { graphId: graph.id, nodeId };
}

async function waitForRuntimeStateWithGraphics(
  graphId: string,
  nodeId: string,
  timeoutMs = E2E_ASSERT_TIMEOUT_MS
): Promise<RuntimeStateResponse> {
  const startedAt = Date.now();
  let lastPayload: RuntimeStateResponse | null = null;

  while ((Date.now() - startedAt) < timeoutMs) {
    const response = await fetch(`${E2E_BACKEND_URL}/api/graphs/${graphId}/runtime-state`);
    if (response.ok) {
      const payload = await response.json() as RuntimeStateResponse;
      lastPayload = payload;
      if (payload.results?.[nodeId]?.graphics?.id) {
        return payload;
      }
    }
    await delay(120);
  }

  throw new Error(
    `Timed out waiting for runtime-state graphics for node ${nodeId}. Last payload: ${JSON.stringify(lastPayload)}`
  );
}

async function waitForRuntimeStateCalls(
  readCount: () => number,
  minimumCalls: number,
  timeoutMs = E2E_ASSERT_TIMEOUT_MS
): Promise<void> {
  const startedAt = Date.now();
  while ((Date.now() - startedAt) < timeoutMs) {
    if (readCount() >= minimumCalls) {
      return;
    }
    await delay(80);
  }

  throw new Error(`Timed out waiting for runtime-state call count ${minimumCalls}. Current: ${readCount()}`);
}

async function reloadCanvasForGraph(
  page: import('playwright').Page,
  graphId: string
): Promise<void> {
  const graphLoadResponse = page.waitForResponse((response) =>
    response.request().method() === 'GET' &&
    response.url().endsWith(`/api/graphs/${graphId}`) &&
    response.ok()
  , {
    timeout: E2E_ASSERT_TIMEOUT_MS,
  });

  await page.reload({
    waitUntil: 'domcontentloaded',
    timeout: E2E_ASSERT_TIMEOUT_MS,
  });
  await page.locator('canvas').first().waitFor({
    state: 'visible',
    timeout: E2E_ASSERT_TIMEOUT_MS,
  });
  await graphLoadResponse;
  await page.waitForFunction((expectedGraphId: string) => {
    const graphSelect = document.querySelector('[data-testid="graph-select"]');
    return graphSelect instanceof HTMLSelectElement && graphSelect.value === expectedGraphId;
  }, graphId, {
    timeout: E2E_ASSERT_TIMEOUT_MS,
  });
}

async function openOutputForNode(
  page: import('playwright').Page,
  nodeId: string
): Promise<void> {
  await page.waitForFunction(() => Boolean((window as Window & {
    __k8vGraphStore?: {
      getState: () => {
        selectNode: (nodeId: string | null) => void;
        selectedNodeId: string | null;
      };
    };
  }).__k8vGraphStore), {
    timeout: E2E_ASSERT_TIMEOUT_MS,
  });

  await page.evaluate((targetNodeId: string) => {
    (window as Window & {
      __k8vGraphStore?: {
        getState: () => {
          selectNode: (nodeId: string | null) => void;
        };
      };
    }).__k8vGraphStore?.getState().selectNode(targetNodeId);
  }, nodeId);

  await page.waitForFunction((targetNodeId: string) => {
    const store = (window as Window & {
      __k8vGraphStore?: {
        getState: () => {
          selectedNodeId: string | null;
        };
      };
    }).__k8vGraphStore;
    return store?.getState().selectedNodeId === targetNodeId;
  }, nodeId, {
    timeout: E2E_ASSERT_TIMEOUT_MS,
  });

  const outputSection = page.locator('[data-testid="sidebar-content-output"]');
  const outputVisible = await outputSection.isVisible().catch(() => false);
  if (!outputVisible) {
    await page.locator('[data-testid="sidebar-toggle-output"]').click();
  }

  await outputSection.waitFor({
    state: 'visible',
    timeout: E2E_ASSERT_TIMEOUT_MS,
  });
}

async function assertGraphicsRemainVisible(
  page: import('playwright').Page,
  nodeId: string,
  expectedGraphicsId: string
): Promise<void> {
  const outputSection = page.locator('[data-testid="sidebar-content-output"]');
  const outputImage = page.locator('img[alt="Node output"]');

  await page.waitForFunction(({ targetNodeId, targetGraphicsId }) => {
    const store = (window as Window & {
      __k8vGraphStore?: {
        getState: () => {
          nodeResults: Record<string, { graphics?: { id?: string } } | null>;
          nodeGraphicsOutputs: Record<string, { id?: string } | null>;
        };
      };
    }).__k8vGraphStore;
    const state = store?.getState();
    return (
      state?.nodeResults?.[targetNodeId]?.graphics?.id === targetGraphicsId &&
      state?.nodeGraphicsOutputs?.[targetNodeId]?.id === targetGraphicsId
    );
  }, {
    targetNodeId: nodeId,
    targetGraphicsId: expectedGraphicsId,
  }, {
    timeout: E2E_ASSERT_TIMEOUT_MS,
  });

  await outputImage.waitFor({
    state: 'visible',
    timeout: E2E_ASSERT_TIMEOUT_MS,
  });

  const imageSrc = await outputImage.getAttribute('src');
  assert.ok(
    imageSrc?.includes(`/api/graphics/${encodeURIComponent(expectedGraphicsId)}/image`),
    `Expected output image to reference graphics ${expectedGraphicsId}. Received: ${imageSrc}`
  );

  const outputText = await outputSection.textContent() ?? '';
  assert.equal(
    outputText.includes('No graphics output'),
    false,
    `Expected graphics output to stay visible. Section text: ${outputText}`
  );
}

test.before(async () => {
  await ensureE2EEnvironment();
});

test.after(async () => {
  await shutdownE2EEnvironment();
});

test(
  'graphics stay visible when sparse runtime-state refreshes follow graph load and page reload',
  { timeout: 90_000 },
  async () => {
    const { graphId, nodeId } = await createGraphWithGraphicsNode();
    const runtimeState = await waitForRuntimeStateWithGraphics(graphId, nodeId);
    const expectedGraphicsId = runtimeState.results[nodeId]?.graphics?.id;
    assert.ok(expectedGraphicsId, 'Expected runtime-state to include graphics metadata');

    const browser = await launchBrowser();
    try {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
      });
      const page = await context.newPage();
      let runtimeStateCalls = 0;
      let allowNextFullRuntimeState = true;

      await page.addInitScript(() => {
        Object.defineProperty(window, 'EventSource', {
          configurable: true,
          writable: true,
          value: undefined,
        });
      });

      await page.route(`**/api/graphs/${graphId}/runtime-state`, async (route) => {
        runtimeStateCalls += 1;
        const payload: RuntimeStateResponse = allowNextFullRuntimeState
          ? {
              ...runtimeState,
              statusVersion: runtimeState.statusVersion + runtimeStateCalls,
            }
          : {
              ...runtimeState,
              statusVersion: runtimeState.statusVersion + runtimeStateCalls,
              results: {},
            };
        allowNextFullRuntimeState = false;

        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(payload),
        });
      });

      await openCanvasForGraph(page, graphId);
      await openOutputForNode(page, nodeId);
      await waitForRuntimeStateCalls(() => runtimeStateCalls, 2);
      await assertGraphicsRemainVisible(page, nodeId, expectedGraphicsId);

      allowNextFullRuntimeState = true;
      const callsBeforeReload = runtimeStateCalls;
      await reloadCanvasForGraph(page, graphId);
      await openOutputForNode(page, nodeId);
      await waitForRuntimeStateCalls(() => runtimeStateCalls, callsBeforeReload + 2);
      await assertGraphicsRemainVisible(page, nodeId, expectedGraphicsId);

      await context.close();
    } finally {
      await browser.close();
    }
  }
);
