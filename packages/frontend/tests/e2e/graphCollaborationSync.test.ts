import assert from 'node:assert/strict';
import test from 'node:test';
import { createNumericInputGraph, fetchGraph as fetchPersistedGraph } from './support/api.ts';
import { launchBrowser, openCanvasForGraph } from './support/browser.ts';
import { E2E_ASSERT_TIMEOUT_MS } from './support/config.ts';
import { ensureE2EEnvironment, shutdownE2EEnvironment } from './support/environment.ts';

interface GraphSnapshot {
  name?: string;
  nodes?: Array<{
    id?: string;
    position?: {
      x?: unknown;
      y?: unknown;
    };
  }>;
}

async function fetchGraph(graphId: string): Promise<GraphSnapshot> {
  return await fetchPersistedGraph(graphId) as GraphSnapshot;
}

async function waitForGraphState(
  graphId: string,
  predicate: (graph: GraphSnapshot) => boolean,
  timeoutMs = E2E_ASSERT_TIMEOUT_MS
): Promise<GraphSnapshot> {
  const startedAt = Date.now();
  let lastGraph: GraphSnapshot | null = null;

  while ((Date.now() - startedAt) < timeoutMs) {
    lastGraph = await fetchGraph(graphId);
    if (predicate(lastGraph)) {
      return lastGraph;
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }

  throw new Error(`Timed out waiting for graph ${graphId} state. Last snapshot: ${JSON.stringify(lastGraph)}`);
}

test.before(async () => {
  await ensureE2EEnvironment();
});

test.after(async () => {
  await shutdownE2EEnvironment();
});

test(
  'multiple browser sessions detect remote updates and preserve unrelated subset edits',
  { timeout: 90_000 },
  async () => {
    const { graphId, nodeId } = await createNumericInputGraph({
      value: 5,
      min: 0,
      max: 100,
      step: 1,
      nodePosition: { x: 120, y: 140 },
    });
    const remoteName = `autotests_multi_user_${Date.now()}`;

    const browser = await launchBrowser();
    try {
      const contextA = await browser.newContext({
        viewport: { width: 1440, height: 900 },
      });
      const contextB = await browser.newContext({
        viewport: { width: 1440, height: 900 },
      });
      const pageA = await contextA.newPage();
      const pageB = await contextB.newPage();

      await openCanvasForGraph(pageA, graphId);
      await openCanvasForGraph(pageB, graphId);

      const graphNameInputA = pageA.locator('[data-testid="graph-name-input"]');
      await graphNameInputA.waitFor({ state: 'visible', timeout: E2E_ASSERT_TIMEOUT_MS });
      await graphNameInputA.fill(remoteName);
      await graphNameInputA.blur();

      await pageB.waitForFunction((targetName) => {
        const input = document.querySelector('[data-testid="graph-name-input"]');
        return input instanceof HTMLInputElement && input.value === targetName;
      }, remoteName, {
        timeout: E2E_ASSERT_TIMEOUT_MS,
      });

      const canvasB = pageB.locator('canvas').first();
      const canvasBox = await canvasB.boundingBox();
      assert.ok(canvasBox, 'Canvas should provide a bounding box');

      const startX = canvasBox.x + (canvasBox.width / 2);
      const startY = canvasBox.y + (canvasBox.height / 2);
      await pageB.mouse.move(startX, startY);
      await pageB.mouse.down();
      await pageB.mouse.move(startX + 250, startY + 40, { steps: 18 });
      await pageB.waitForTimeout(120);
      await pageB.mouse.up();

      const persistedGraph = await waitForGraphState(graphId, (graph) => {
        const node = graph.nodes?.find((candidate) => candidate.id === nodeId);
        return (
          graph.name === remoteName &&
          typeof node?.position?.x === 'number' &&
          node.position.x >= 300
        );
      });

      const persistedNode = persistedGraph.nodes?.find((candidate) => candidate.id === nodeId);
      assert.ok(persistedNode, `Expected graph ${graphId} to contain node ${nodeId}`);
      assert.equal(persistedGraph.name, remoteName);

      await pageA.waitForFunction(({ targetNodeId, minimumX }) => {
        const state = (window as Window & {
          __k8vGraphStore?: {
            getState: () => {
              graph?: {
                nodes?: Array<{ id?: string; position?: { x?: unknown } }>;
              };
            };
          };
        }).__k8vGraphStore?.getState();
        const node = state?.graph?.nodes?.find((candidate) => candidate.id === targetNodeId);
        return typeof node?.position?.x === 'number' && node.position.x >= minimumX;
      }, {
        targetNodeId: nodeId,
        minimumX: 300,
      }, {
        timeout: E2E_ASSERT_TIMEOUT_MS,
      });

      assert.equal(await pageA.locator('[data-testid="graph-name-input"]').inputValue(), remoteName);

      await contextA.close();
      await contextB.close();
    } finally {
      await browser.close();
    }
  }
);
