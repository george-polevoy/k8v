import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { launchBrowser } from './support/browser.ts';
import { E2E_ASSERT_TIMEOUT_MS, E2E_BACKEND_URL, E2E_FRONTEND_URL } from './support/config.ts';
import { ensureE2EEnvironment, shutdownE2EEnvironment } from './support/environment.ts';

const NUMERIC_NODE_WIDTH = 220;

interface CanvasBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface NodeScreenPosition {
  centerX: number;
  centerY: number;
}

async function openCanvasForGraphWithTimeout(
  page: import('playwright').Page,
  graphId: string
): Promise<void> {
  await page.addInitScript((savedGraphId: string) => {
    window.localStorage.clear();
    window.localStorage.setItem('k8v-current-graph-id', savedGraphId);
  }, graphId);

  await page.goto(E2E_FRONTEND_URL, {
    waitUntil: 'networkidle',
    timeout: 60_000,
  });
  await page.locator('canvas').first().waitFor({
    state: 'visible',
    timeout: 60_000,
  });
}

function resolveCenteredNodePosition(canvasBox: CanvasBox): NodeScreenPosition {
  const centerX = canvasBox.x + (canvasBox.width / 2);
  const centerY = canvasBox.y + (canvasBox.height / 2);
  return {
    centerX,
    centerY,
  };
}

async function createTwoNumericNodeGraph(): Promise<{ graphId: string; selectedNodeId: string; otherNodeId: string }> {
  const selectedNodeId = randomUUID();
  const otherNodeId = randomUUID();

  const response = await fetch(`${E2E_BACKEND_URL}/api/graphs`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      name: `autotests_output_panel_refresh_flicker_${Date.now()}`,
      nodes: [
        {
          id: selectedNodeId,
          type: 'numeric_input',
          position: { x: 0, y: 0 },
          metadata: {
            name: 'Selected Numeric Input',
            inputs: [],
            outputs: [{ name: 'value', schema: { type: 'number' } }],
          },
          config: {
            type: 'numeric_input',
            config: {
              value: 10,
              min: 0,
              max: 100,
              step: 1,
            },
          },
          version: Date.now().toString(),
        },
        {
          id: otherNodeId,
          type: 'numeric_input',
          position: { x: 300, y: 0 },
          metadata: {
            name: 'Other Numeric Input',
            inputs: [],
            outputs: [{ name: 'value', schema: { type: 'number' } }],
          },
          config: {
            type: 'numeric_input',
            config: {
              value: 20,
              min: 0,
              max: 100,
              step: 1,
            },
          },
          version: Date.now().toString(),
        },
      ],
      connections: [],
      drawings: [],
    }),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Create graph failed (${response.status}): ${text}`);
  }

  const parsed = JSON.parse(text) as { id?: string };
  assert.ok(parsed.id, 'Create graph response should include graph id');
  return { graphId: parsed.id, selectedNodeId, otherNodeId };
}

test.before(async () => {
  await ensureE2EEnvironment();
});

test.after(async () => {
  await shutdownE2EEnvironment();
});

test(
  'output panel does not flicker refreshing status for non-selected node recompute updates',
  { timeout: 90_000 },
  async () => {
    const { graphId, selectedNodeId, otherNodeId } = await createTwoNumericNodeGraph();
    const browser = await launchBrowser();

    try {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
      });
      const page = await context.newPage();
      let recomputeStatusCalls = 0;

      await page.route('**/api/nodes/*/result', async (route) => {
        const requestUrl = new URL(route.request().url());
        const segments = requestUrl.pathname.split('/').filter(Boolean);
        const nodeId = segments[segments.length - 2] ?? selectedNodeId;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            nodeId,
            outputs: { value: 10 },
            schema: { value: { type: 'number' } },
            timestamp: Date.now(),
            version: `v-${nodeId}`,
            textOutput: 'stable output',
          }),
        });
      });

      await page.route(`**/api/graphs/${graphId}/recompute-status`, async (route) => {
        recomputeStatusCalls += 1;
        const otherNodePending = recomputeStatusCalls % 2 === 1;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            graphId,
            statusVersion: recomputeStatusCalls,
            nodeStates: {
              [selectedNodeId]: {
                isPending: false,
                isComputing: false,
              },
              [otherNodeId]: {
                isPending: otherNodePending,
                isComputing: false,
              },
            },
          }),
        });
      });

      await openCanvasForGraphWithTimeout(page, graphId);

      const canvas = page.locator('canvas').first();
      const canvasBox = await canvas.boundingBox();
      assert.ok(canvasBox, 'Canvas element should provide a bounding box');
      const nodeBox = resolveCenteredNodePosition(canvasBox);

      await page.locator('[data-testid="sidebar-toggle-node"]').click();
      const nodeNameInput = page.locator('[data-testid="node-name-input"]');
      const candidateOffsets = [-360, -260, -160, -80, 0, 80, 160, 260, 360];
      let selectedExpectedNode = false;
      for (const offset of candidateOffsets) {
        const headerClickX = nodeBox.centerX + offset + (NUMERIC_NODE_WIDTH / 2) - 96;
        const headerClickY = nodeBox.centerY - 30;
        await page.mouse.click(headerClickX, headerClickY);

        try {
          await nodeNameInput.waitFor({
            state: 'visible',
            timeout: 1_000,
          });
          const selectedName = await nodeNameInput.inputValue();
          if (selectedName === 'Selected Numeric Input') {
            selectedExpectedNode = true;
            break;
          }
        } catch {
          // Continue scanning candidate click locations until the expected node is selected.
        }
      }
      assert.equal(selectedExpectedNode, true);

      await page.locator('[data-testid="sidebar-toggle-output"]').click();
      const outputSection = page.locator('[data-testid="sidebar-content-output"]');
      await outputSection.waitFor({
        state: 'visible',
        timeout: E2E_ASSERT_TIMEOUT_MS,
      });

      await page.locator('text=stable output').waitFor({
        state: 'visible',
        timeout: E2E_ASSERT_TIMEOUT_MS,
      });

      let sawRefreshing = false;
      const sampleDurationMs = 4_000;
      const sampleIntervalMs = 200;
      const sampleCount = Math.ceil(sampleDurationMs / sampleIntervalMs);
      for (let index = 0; index < sampleCount; index += 1) {
        const sectionText = await outputSection.textContent() ?? '';
        if (sectionText.includes('Refreshing...')) {
          sawRefreshing = true;
          break;
        }
        await page.waitForTimeout(sampleIntervalMs);
      }

      assert.ok(recomputeStatusCalls >= 4, 'Expected multiple recompute status polls during sampling');
      assert.equal(sawRefreshing, false);

      await context.close();
    } finally {
      await browser.close();
    }
  }
);
