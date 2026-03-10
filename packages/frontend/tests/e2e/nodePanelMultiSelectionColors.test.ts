import assert from 'node:assert/strict';
import test from 'node:test';
import { launchBrowser, openCanvasForGraph } from './support/browser.ts';
import { E2E_ASSERT_TIMEOUT_MS, E2E_BACKEND_URL } from './support/config.ts';
import { ensureE2EEnvironment, shutdownE2EEnvironment } from './support/environment.ts';

interface CreatedGraph {
  graphId: string;
  nodeIds: {
    left: string;
    right: string;
  };
}

interface PersistedNodeCardColors {
  backgroundColor: string | null;
  borderColor: string | null;
}

async function createTwoCardGraph(): Promise<CreatedGraph> {
  const nodeIds = {
    left: crypto.randomUUID(),
    right: crypto.randomUUID(),
  };
  const makeNode = (
    id: string,
    name: string,
    position: { x: number; y: number }
  ) => ({
    id,
    type: 'numeric_input',
    position,
    metadata: {
      name,
      inputs: [],
      outputs: [{ name: 'value', schema: { type: 'number' } }],
    },
    config: {
      type: 'numeric_input',
      config: {
        value: 0,
        min: 0,
        max: 100,
        step: 1,
      },
    },
    version: `${Date.now()}`,
  });

  const response = await fetch(`${E2E_BACKEND_URL}/api/graphs`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      name: `autotests_e2e_node_panel_multi_${Date.now()}`,
      nodes: [
        makeNode(nodeIds.left, 'Card 1', { x: 120, y: 140 }),
        makeNode(nodeIds.right, 'Card 2', { x: 430, y: 160 }),
      ],
      connections: [],
      drawings: [],
    }),
  });
  const graph = await response.json() as { id?: string };
  assert.ok(response.ok, `Create graph failed (${response.status})`);
  assert.ok(graph.id, 'Create graph response should include graph id');
  return {
    graphId: graph.id,
    nodeIds,
  };
}

async function getNodeCardColors(
  graphId: string,
  nodeId: string
): Promise<PersistedNodeCardColors> {
  const response = await fetch(`${E2E_BACKEND_URL}/api/graphs/${graphId}`, {
    method: 'GET',
    headers: {
      accept: 'application/json',
    },
  });
  const graph = await response.json() as {
    nodes?: Array<{
      id?: string;
      config?: {
        config?: {
          backgroundColor?: string;
          borderColor?: string;
        };
      };
    }>;
  };
  assert.ok(response.ok, `Fetch graph failed (${response.status})`);
  const node = graph.nodes?.find((candidate) => candidate.id === nodeId);
  assert.ok(node, `Expected node ${nodeId} in graph ${graphId}`);
  return {
    backgroundColor: node.config?.config?.backgroundColor ?? null,
    borderColor: node.config?.config?.borderColor ?? null,
  };
}

async function waitForSharedCardColors(
  graphId: string,
  nodeIds: string[],
  predicate: (colors: PersistedNodeCardColors[]) => boolean,
  timeoutMs = E2E_ASSERT_TIMEOUT_MS
): Promise<PersistedNodeCardColors[]> {
  const startedAt = Date.now();
  let lastColors: PersistedNodeCardColors[] = [];

  while ((Date.now() - startedAt) < timeoutMs) {
    lastColors = await Promise.all(nodeIds.map((nodeId) => getNodeCardColors(graphId, nodeId)));
    if (predicate(lastColors)) {
      return lastColors;
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }

  throw new Error(`Timed out waiting for shared card colors. Last value: ${JSON.stringify(lastColors)}`);
}

test.before(async () => {
  await ensureE2EEnvironment();
});

test.after(async () => {
  await shutdownE2EEnvironment();
});

test(
  'node panel shows multi-selection summary and applies shared card colors',
  { timeout: 90_000 },
  async () => {
    const { graphId, nodeIds } = await createTwoCardGraph();
    const browser = await launchBrowser();

    try {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 1,
      });
      const page = await context.newPage();

      await openCanvasForGraph(page, graphId);

      await page.evaluate((selectedIds: string[]) => {
        const store = (window as Window & {
          __k8vGraphStore?: {
            getState: () => {
              setNodeSelection: (nodeIds: string[]) => void;
            };
          };
        }).__k8vGraphStore?.getState();
        if (!store) {
          throw new Error('Expected graph store to be available in e2e environment.');
        }
        store.setNodeSelection(selectedIds);
      }, [nodeIds.left, nodeIds.right]);

      const nodeSidebarContent = page.locator('[data-testid="sidebar-content-node"]');
      await nodeSidebarContent.waitFor({ state: 'visible', timeout: E2E_ASSERT_TIMEOUT_MS });

      const summary = nodeSidebarContent.locator('[data-testid="multi-node-selection-summary"]');
      await summary.waitFor({ state: 'visible', timeout: E2E_ASSERT_TIMEOUT_MS });
      assert.equal(await summary.textContent(), '2 selected (Card 1, Card 2)');

      await nodeSidebarContent.locator('[data-testid="node-card-background-color-input"]').click();
      await page.locator('[data-testid="color-preset-9"]').click();
      await page.getByRole('button', { name: 'Apply to 2' }).click();

      const backgroundColors = await waitForSharedCardColors(
        graphId,
        [nodeIds.left, nodeIds.right],
        (colors) => colors.every((color) => color.backgroundColor === '#3b82f6')
      );
      assert.ok(backgroundColors.every((color) => color.backgroundColor === '#3b82f6'));

      await nodeSidebarContent.locator('[data-testid="node-card-border-color-input"]').click();
      await page.locator('[data-testid="color-preset-2"]').click();
      await page.getByRole('button', { name: 'Apply to 2' }).click();

      const borderColors = await waitForSharedCardColors(
        graphId,
        [nodeIds.left, nodeIds.right],
        (colors) => colors.every((color) => color.borderColor === '#ef4444')
      );
      assert.ok(borderColors.every((color) => color.borderColor === '#ef4444'));

      await context.close();
    } finally {
      await browser.close();
    }
  }
);
