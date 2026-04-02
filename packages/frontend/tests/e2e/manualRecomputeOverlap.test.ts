import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import {
  createEmptyGraph,
  fetchGraph,
  submitGraphCommands,
} from './support/api.ts';
import { launchBrowser, openCanvasForGraph, openSidebarSection } from './support/browser.ts';
import { E2E_ASSERT_TIMEOUT_MS, E2E_BACKEND_URL } from './support/config.ts';
import { ensureE2EEnvironment, shutdownE2EEnvironment } from './support/environment.ts';

interface RuntimeStateResponse {
  queueLength?: number;
  nodeStates?: Record<string, {
    isPending?: boolean;
    isComputing?: boolean;
    hasError?: boolean;
    errorMessage?: string | null;
  }>;
}

function createPythonNode(params: {
  id: string;
  name: string;
  x: number;
  y: number;
  code: string;
  inputName?: string;
  autoRecompute?: boolean;
}) {
  const inputs = params.inputName
    ? [{ name: params.inputName, schema: { type: 'number' } }]
    : [];

  return {
    id: params.id,
    type: 'inline_code',
    position: { x: params.x, y: params.y },
    metadata: {
      name: params.name,
      inputs,
      outputs: [{ name: 'result', schema: { type: 'number' } }],
    },
    config: {
      code: params.code,
      runtime: 'python_process',
      pythonEnv: 'e2e_python',
      autoRecompute: params.autoRecompute ?? true,
      displayTextOutputs: true,
    },
    version: `${Date.now()}-${params.id}`,
  };
}

async function fetchRuntimeState(graphId: string): Promise<RuntimeStateResponse> {
  const response = await fetch(`${E2E_BACKEND_URL}/api/graphs/${graphId}/runtime-state`);
  assert.equal(response.ok, true, `Expected runtime state for graph ${graphId}`);
  return await response.json() as RuntimeStateResponse;
}

async function waitForRuntimeDrainWithoutErrors(
  graphId: string,
  nodeIds: string[],
  timeoutMs = E2E_ASSERT_TIMEOUT_MS
): Promise<void> {
  const startedAt = Date.now();
  let lastState: RuntimeStateResponse | null = null;

  while ((Date.now() - startedAt) < timeoutMs) {
    lastState = await fetchRuntimeState(graphId);
    const nodeStates = lastState.nodeStates ?? {};
    const hasActiveWork =
      (lastState.queueLength ?? 0) > 0 ||
      nodeIds.some((nodeId) => {
        const state = nodeStates[nodeId];
        return Boolean(state?.isPending || state?.isComputing);
      });
    const hasErrors = nodeIds.some((nodeId) => nodeStates[nodeId]?.hasError === true);

    if (!hasActiveWork && !hasErrors) {
      return;
    }

    await delay(120);
  }

  throw new Error(
    `Timed out waiting for runtime drain without errors for graph ${graphId}. Last state: ${JSON.stringify(lastState)}`
  );
}

test.before(async () => {
  await ensureE2EEnvironment();
});

test.after(async () => {
  await shutdownE2EEnvironment();
});

test(
  'manual node recompute can be triggered repeatedly before completion without leaving python dependents errored',
  { timeout: 90_000 },
  async () => {
    const rootNodeId = randomUUID();
    const dependentNodeIds = Array.from({ length: 6 }, () => randomUUID());
    const nodes = [
      createPythonNode({
        id: rootNodeId,
        name: 'Root Python',
        x: 120,
        y: 180,
        code: [
          'import time',
          'time.sleep(0.35)',
          'outputs.result = 1',
        ].join('\n'),
      }),
      ...dependentNodeIds.map((nodeId, index) =>
        createPythonNode({
          id: nodeId,
          name: `Dependent ${index + 1}`,
          x: 420,
          y: 40 + (index * 110),
          inputName: 'source',
          code: [
            'import time',
            'time.sleep(0.12)',
            'outputs.result = inputs.source + 1',
          ].join('\n'),
        })
      ),
    ];
    const connections = dependentNodeIds.map((nodeId, index) => ({
      id: `root-dependent-${index}`,
      sourceNodeId: rootNodeId,
      sourcePort: 'result',
      targetNodeId: nodeId,
      targetPort: 'source',
    }));

    const { graphId } = await createEmptyGraph(`e2e_manual_recompute_overlap_${Date.now()}`);
    const createdGraph = await fetchGraph(graphId);
    const configuredGraph = await submitGraphCommands(
      graphId,
      createdGraph.revision ?? 0,
      [
        {
          kind: 'replace_python_envs',
          pythonEnvs: [
            {
              name: 'e2e_python',
              pythonPath: process.env.K8V_PYTHON_BIN || 'python3',
              cwd: process.cwd(),
            },
          ],
        },
        {
          kind: 'set_recompute_concurrency',
          recomputeConcurrency: 6,
        },
        {
          kind: 'replace_nodes',
          nodes,
        },
        {
          kind: 'replace_connections',
          connections,
        },
      ],
      'Configure manual recompute overlap graph'
    );
    await fetchGraph(configuredGraph.id);

    const browser = await launchBrowser();
    try {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 1000 },
      });
      const page = await context.newPage();
      await openCanvasForGraph(page, configuredGraph.id);
      await openSidebarSection(page, 'node');

      await page.waitForFunction(() => Boolean(window.__k8vGraphStore), {
        timeout: E2E_ASSERT_TIMEOUT_MS,
      });
      await page.evaluate((targetNodeId: string) => {
        window.__k8vGraphStore?.getState().selectNode(targetNodeId);
      }, rootNodeId);

      const runButton = page.locator('[data-testid="run-selected-node-button"]');
      await runButton.waitFor({
        state: 'visible',
        timeout: E2E_ASSERT_TIMEOUT_MS,
      });

      await runButton.click();
      await page.waitForTimeout(60);
      await runButton.click();

      await waitForRuntimeDrainWithoutErrors(configuredGraph.id, [rootNodeId, ...dependentNodeIds]);

      const finalState = await fetchRuntimeState(configuredGraph.id);
      for (const nodeId of [rootNodeId, ...dependentNodeIds]) {
        const nodeState = finalState.nodeStates?.[nodeId];
        assert.equal(nodeState?.hasError ?? false, false, `Expected node ${nodeId} to finish without error`);
      }

      const rootError = page.locator('[data-testid="node-execution-error"]');
      assert.equal(await rootError.count(), 0);
    } finally {
      await browser.close();
    }
  }
);
