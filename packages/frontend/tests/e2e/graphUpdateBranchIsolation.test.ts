import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import {
  createEmptyGraph,
  fetchGraph,
  getNumericNodeValue,
  submitGraphCommands,
} from './support/api.ts';
import {
  launchBrowser,
  openCanvasForGraph,
  readCanvasCursor,
  waitForCursorAtPoint,
} from './support/browser.ts';
import { E2E_ASSERT_TIMEOUT_MS, E2E_BACKEND_URL } from './support/config.ts';
import { ensureE2EEnvironment, shutdownE2EEnvironment } from './support/environment.ts';

const NUMERIC_NODE_WIDTH = 220;

interface RuntimeNodeState {
  isPending?: boolean;
  isComputing?: boolean;
  hasError?: boolean;
  errorMessage?: string | null;
  lastRunAt?: number | null;
}

interface RuntimeResult {
  timestamp?: number;
  outputs?: Record<string, unknown>;
}

interface RuntimeStateResponse {
  queueLength?: number;
  nodeStates?: Record<string, RuntimeNodeState>;
  results?: Record<string, RuntimeResult>;
}

interface ViewportTransform {
  x: number;
  y: number;
  scale: number;
}

interface BranchIsolationFixture {
  graphId: string;
  sharedSourceId: string;
  laneAAdapterId: string;
  laneASolverId: string;
  laneAFinalId: string;
  laneBAdapterId: string;
  laneBSliderId: string;
  laneBFinalId: string;
  laneBSliderPosition: {
    x: number;
    y: number;
  };
}

function createInlineNode(params: {
  id: string;
  name: string;
  position: { x: number; y: number };
  inputs: string[];
  output: string;
  code: string;
  runtime?: 'javascript_vm' | 'python_process';
  autoRecompute?: boolean;
}) {
  const runtime = params.runtime ?? 'javascript_vm';
  return {
    id: params.id,
    type: 'inline_code',
    position: params.position,
    metadata: {
      name: params.name,
      inputs: params.inputs.map((name) => ({
        name,
        schema: { type: 'number' },
      })),
      outputs: [{
        name: params.output,
        schema: { type: 'number' },
      }],
    },
    config: {
      code: params.code,
      runtime,
      ...(runtime === 'python_process' ? { pythonEnv: 'e2e_python' } : {}),
      autoRecompute: params.autoRecompute ?? true,
    },
    version: `${Date.now()}-${params.id}`,
  };
}

async function fetchRuntimeState(graphId: string): Promise<RuntimeStateResponse> {
  const response = await fetch(`${E2E_BACKEND_URL}/api/graphs/${graphId}/runtime-state`);
  assert.equal(response.ok, true, `Expected runtime state for graph ${graphId}`);
  return await response.json() as RuntimeStateResponse;
}

function hasActiveRuntimeWork(runtimeState: RuntimeStateResponse): boolean {
  return (
    (runtimeState.queueLength ?? 0) > 0 ||
    Object.values(runtimeState.nodeStates ?? {}).some((nodeState) =>
      nodeState?.isPending === true || nodeState?.isComputing === true
    )
  );
}

function readResultTimestamp(runtimeState: RuntimeStateResponse, nodeId: string): number {
  const timestamp = runtimeState.results?.[nodeId]?.timestamp;
  assert.equal(typeof timestamp, 'number', `Expected result timestamp for node ${nodeId}`);
  return timestamp;
}

async function waitForRuntimeIdleWithResults(
  graphId: string,
  requiredNodeIds: string[],
  timeoutMs = E2E_ASSERT_TIMEOUT_MS
): Promise<RuntimeStateResponse> {
  const startedAt = Date.now();
  let lastState: RuntimeStateResponse | null = null;

  while ((Date.now() - startedAt) < timeoutMs) {
    lastState = await fetchRuntimeState(graphId);
    const nodeStates = lastState.nodeStates ?? {};
    const errorEntry = requiredNodeIds
      .map((nodeId) => ({ nodeId, state: nodeStates[nodeId] }))
      .find(({ state }) => state?.hasError === true);
    if (errorEntry) {
      throw new Error(
        `Node ${errorEntry.nodeId} failed while preparing branch-isolation fixture: ` +
        `${errorEntry.state?.errorMessage ?? 'unknown execution error'}`
      );
    }

    const hasAllResults = requiredNodeIds.every((nodeId) =>
      typeof lastState?.results?.[nodeId]?.timestamp === 'number'
    );
    if (hasAllResults && !hasActiveRuntimeWork(lastState)) {
      return lastState;
    }

    await delay(25);
  }

  throw new Error(
    `Timed out waiting for graph ${graphId} to become idle with results. ` +
    `Last state: ${JSON.stringify(lastState)}`
  );
}

async function waitForViewportTransform(
  page: import('playwright').Page,
  timeoutMs = E2E_ASSERT_TIMEOUT_MS
): Promise<ViewportTransform> {
  const startedAt = Date.now();
  let lastTransform: ViewportTransform = {
    x: Number.NaN,
    y: Number.NaN,
    scale: Number.NaN,
  };

  while ((Date.now() - startedAt) < timeoutMs) {
    lastTransform = await page.evaluate(() => {
      const debug = window.__k8vCanvasDebug;
      return {
        x: Number(debug?.viewportX ?? Number.NaN),
        y: Number(debug?.viewportY ?? Number.NaN),
        scale: Number(debug?.viewportScale ?? Number.NaN),
      };
    });
    if (
      Number.isFinite(lastTransform.x) &&
      Number.isFinite(lastTransform.y) &&
      Number.isFinite(lastTransform.scale) &&
      lastTransform.scale > 0
    ) {
      return lastTransform;
    }
    await page.waitForTimeout(40);
  }

  throw new Error(`Timed out waiting for viewport transform. Last value: ${JSON.stringify(lastTransform)}`);
}

async function locateSliderY(
  page: import('playwright').Page,
  scanX: number,
  centerY: number,
  scale: number
): Promise<number> {
  const scanStart = centerY - (40 * scale);
  const scanEnd = centerY + (120 * scale);
  const scanStep = Math.max(1, 2 * scale);
  for (let y = scanStart; y <= scanEnd; y += scanStep) {
    await page.mouse.move(scanX, y);
    if ((await readCanvasCursor(page)) === 'ew-resize') {
      return y;
    }
  }

  throw new Error(
    `Failed to locate slider row near x=${scanX.toFixed(1)} around y=${centerY.toFixed(1)}`
  );
}

async function createBranchIsolationFixture(): Promise<BranchIsolationFixture> {
  const sharedSourceId = randomUUID();
  const laneAAdapterId = randomUUID();
  const laneASolverId = randomUUID();
  const laneAFinalId = randomUUID();
  const laneBAdapterId = randomUUID();
  const laneBSliderId = randomUUID();
  const laneBFinalId = randomUUID();
  const laneBSliderPosition = { x: 120, y: 140 };
  const laneASolverCode = [
    'import time',
    'time.sleep(0.35)',
    'outputs.result = inputs.adapted * 2',
  ].join('\n');

  const nodes = [
    createInlineNode({
      id: sharedSourceId,
      name: 'Shared Source',
      position: { x: -760, y: 140 },
      inputs: [],
      output: 'value',
      code: 'outputs.value = 10;',
    }),
    createInlineNode({
      id: laneAAdapterId,
      name: 'Lane A Input Adapter',
      position: { x: -440, y: -80 },
      inputs: ['source'],
      output: 'adapted',
      code: 'outputs.adapted = inputs.source;',
    }),
    createInlineNode({
      id: laneASolverId,
      name: 'Lane A Manual Solver',
      position: { x: -120, y: -80 },
      inputs: ['adapted'],
      output: 'result',
      code: laneASolverCode,
      runtime: 'python_process',
      autoRecompute: false,
    }),
    createInlineNode({
      id: laneAFinalId,
      name: 'Lane A Final',
      position: { x: 200, y: -80 },
      inputs: ['solved'],
      output: 'result',
      code: 'outputs.result = inputs.solved;',
    }),
    createInlineNode({
      id: laneBAdapterId,
      name: 'Lane B Input Adapter',
      position: { x: -440, y: 300 },
      inputs: ['source'],
      output: 'adapted',
      code: 'outputs.adapted = inputs.source;',
    }),
    {
      id: laneBSliderId,
      type: 'numeric_input',
      position: laneBSliderPosition,
      metadata: {
        name: 'Lane B Iteration Budget',
        inputs: [],
        outputs: [{ name: 'value', schema: { type: 'number' } }],
      },
      config: {
        value: 1,
        min: 0,
        max: 10,
        step: 1,
        propagateWhileDragging: false,
        dragDebounceSeconds: 0.1,
        autoRecompute: true,
      },
      version: `${Date.now()}-${laneBSliderId}`,
    },
    createInlineNode({
      id: laneBFinalId,
      name: 'Lane B Final',
      position: { x: 440, y: 300 },
      inputs: ['adapted', 'budget'],
      output: 'result',
      code: 'outputs.result = inputs.adapted + inputs.budget;',
    }),
  ];

  const connections = [
    {
      id: randomUUID(),
      sourceNodeId: sharedSourceId,
      sourcePort: 'value',
      targetNodeId: laneAAdapterId,
      targetPort: 'source',
    },
    {
      id: randomUUID(),
      sourceNodeId: laneAAdapterId,
      sourcePort: 'adapted',
      targetNodeId: laneASolverId,
      targetPort: 'adapted',
    },
    {
      id: randomUUID(),
      sourceNodeId: laneASolverId,
      sourcePort: 'result',
      targetNodeId: laneAFinalId,
      targetPort: 'solved',
    },
    {
      id: randomUUID(),
      sourceNodeId: sharedSourceId,
      sourcePort: 'value',
      targetNodeId: laneBAdapterId,
      targetPort: 'source',
    },
    {
      id: randomUUID(),
      sourceNodeId: laneBAdapterId,
      sourcePort: 'adapted',
      targetNodeId: laneBFinalId,
      targetPort: 'adapted',
    },
    {
      id: randomUUID(),
      sourceNodeId: laneBSliderId,
      sourcePort: 'value',
      targetNodeId: laneBFinalId,
      targetPort: 'budget',
    },
  ];

  const { graphId } = await createEmptyGraph(`e2e_graph_update_branch_isolation_${Date.now()}`);
  const emptyGraph = await fetchGraph(graphId);
  await submitGraphCommands(
    graphId,
    emptyGraph.revision ?? 0,
    [
      {
        kind: 'replace_python_envs',
        pythonEnvs: [{
          name: 'e2e_python',
          pythonPath: process.env.K8V_PYTHON_BIN || 'python3',
          cwd: process.cwd(),
        }],
      },
      {
        kind: 'set_recompute_concurrency',
        recomputeConcurrency: 1,
      },
      {
        kind: 'replace_cameras',
        cameras: [{
          id: 'default-camera',
          name: 'Default Camera',
          viewport: {
            x: 350,
            y: 200,
            scale: 1,
          },
          floatingWindows: {},
        }],
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
    'Configure graph-update branch-isolation fixture'
  );

  const requiredResultNodeIds = [
    sharedSourceId,
    laneAAdapterId,
    laneASolverId,
    laneAFinalId,
    laneBAdapterId,
    laneBSliderId,
    laneBFinalId,
  ];
  await waitForRuntimeIdleWithResults(graphId, requiredResultNodeIds);

  const graphBeforeStaleUpdate = await fetchGraph(graphId);
  const staleLaneANodes = graphBeforeStaleUpdate.nodes.map((node) =>
    node.id === laneASolverId
      ? {
          ...node,
          version: `${Date.now()}-${laneASolverId}-stale`,
          config: {
            ...node.config,
            code: `${laneASolverCode}\n# intentionally staged stale without recompute`,
          },
        }
      : node
  );
  await submitGraphCommands(
    graphId,
    graphBeforeStaleUpdate.revision ?? 0,
    [{
      kind: 'replace_nodes',
      nodes: staleLaneANodes,
    }],
    'Stage stale lane A without recompute',
    { noRecompute: true }
  );

  return {
    graphId,
    sharedSourceId,
    laneAAdapterId,
    laneASolverId,
    laneAFinalId,
    laneBAdapterId,
    laneBSliderId,
    laneBFinalId,
    laneBSliderPosition,
  };
}

test.before(async () => {
  await ensureE2EEnvironment();
});

test.after(async () => {
  await shutdownE2EEnvironment();
});

test(
  'slider graph_update stays inside its downstream branch when another branch is stale',
  { timeout: 90_000 },
  async () => {
    const fixture = await createBranchIsolationFixture();
    const laneANodeIds = [
      fixture.laneAAdapterId,
      fixture.laneASolverId,
      fixture.laneAFinalId,
    ];
    const unrelatedNodeIds = [
      fixture.sharedSourceId,
      ...laneANodeIds,
    ];
    const baselineState = await fetchRuntimeState(fixture.graphId);
    assert.equal(hasActiveRuntimeWork(baselineState), false, 'Fixture should be idle before slider interaction');

    const baselineTimestamps = new Map<string, number>(
      [
        fixture.sharedSourceId,
        ...laneANodeIds,
        fixture.laneBAdapterId,
        fixture.laneBFinalId,
      ].map((nodeId) => [nodeId, readResultTimestamp(baselineState, nodeId)])
    );

    const browser = await launchBrowser();
    try {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
      });
      const page = await context.newPage();
      await page.addInitScript(() => {
        window.__k8vCanvasDebug = {};
      });
      await openCanvasForGraph(page, fixture.graphId);

      const canvas = page.locator('canvas').first();
      const canvasBox = await canvas.boundingBox();
      assert.ok(canvasBox, 'Canvas element should provide a bounding box');
      const viewportTransform = await waitForViewportTransform(page);
      const sliderLeft = (
        canvasBox.x +
        viewportTransform.x +
        (fixture.laneBSliderPosition.x * viewportTransform.scale)
      );
      const sliderTop = (
        canvasBox.y +
        viewportTransform.y +
        (fixture.laneBSliderPosition.y * viewportTransform.scale)
      );
      const sliderStartX = sliderLeft + (12 * viewportTransform.scale);
      const sliderTargetX = sliderLeft + ((NUMERIC_NODE_WIDTH - 12) * viewportTransform.scale);
      const sliderY = await locateSliderY(
        page,
        sliderLeft + (80 * viewportTransform.scale),
        sliderTop + (54 * viewportTransform.scale),
        viewportTransform.scale
      );

      await waitForCursorAtPoint(page, sliderStartX, sliderY, 'ew-resize');
      await page.mouse.down();
      await page.mouse.move(sliderTargetX, sliderY, { steps: 24 });
      await page.waitForTimeout(150);
      assert.equal(
        await getNumericNodeValue(fixture.graphId, fixture.laneBSliderId),
        1,
        'propagateWhileDragging=false should not persist lane B slider before release'
      );

      let observedUnrelatedPending = false;
      let observedUnrelatedComputing = false;
      let settledState: RuntimeStateResponse | null = null;
      const observeUntilSettled = async () => {
        const startedAt = Date.now();
        let sawUpdatedLaneBResult = false;
        let idleSamplesAfterUpdate = 0;

        while ((Date.now() - startedAt) < E2E_ASSERT_TIMEOUT_MS) {
          const runtimeState = await fetchRuntimeState(fixture.graphId);
          const nodeStates = runtimeState.nodeStates ?? {};
          observedUnrelatedPending ||= unrelatedNodeIds.some(
            (nodeId) => nodeStates[nodeId]?.isPending === true
          );
          observedUnrelatedComputing ||= unrelatedNodeIds.some(
            (nodeId) => nodeStates[nodeId]?.isComputing === true
          );

          const laneBResultTimestamp = runtimeState.results?.[fixture.laneBFinalId]?.timestamp;
          if (
            typeof laneBResultTimestamp === 'number' &&
            laneBResultTimestamp > (baselineTimestamps.get(fixture.laneBFinalId) ?? Number.POSITIVE_INFINITY)
          ) {
            sawUpdatedLaneBResult = true;
          }

          if (sawUpdatedLaneBResult && !hasActiveRuntimeWork(runtimeState)) {
            idleSamplesAfterUpdate += 1;
            settledState = runtimeState;
            if (idleSamplesAfterUpdate >= 3) {
              return;
            }
          } else {
            idleSamplesAfterUpdate = 0;
          }

          await delay(20);
        }

        throw new Error(
          `Timed out waiting for lane B recompute to settle. Last state: ${JSON.stringify(settledState)}`
        );
      };

      const settledObservation = observeUntilSettled();
      await page.mouse.up();
      await settledObservation;
      assert.ok(settledState, 'Expected a settled runtime state after lane B slider release');

      assert.equal(
        observedUnrelatedPending,
        false,
        'Lane A nodes and the shared source must never become pending'
      );
      assert.equal(
        observedUnrelatedComputing,
        false,
        'Lane A nodes and the shared source must never become computing'
      );
      for (const nodeId of laneANodeIds) {
        assert.equal(
          readResultTimestamp(settledState, nodeId),
          baselineTimestamps.get(nodeId),
          `Lane A node ${nodeId} timestamp must remain unchanged`
        );
      }
      assert.equal(
        readResultTimestamp(settledState, fixture.sharedSourceId),
        baselineTimestamps.get(fixture.sharedSourceId),
        'Shared source must not be force-recomputed by a lane B graph update'
      );
      assert.equal(
        readResultTimestamp(settledState, fixture.laneBAdapterId),
        baselineTimestamps.get(fixture.laneBAdapterId),
        'Fresh lane B dependency should be reused'
      );
      assert.ok(
        readResultTimestamp(settledState, fixture.laneBFinalId) >
        (baselineTimestamps.get(fixture.laneBFinalId) ?? Number.POSITIVE_INFINITY),
        'Lane B auto-recompute descendant should receive a newer result'
      );
      assert.equal(
        settledState.results?.[fixture.laneBFinalId]?.outputs?.result,
        20,
        'Lane B result should use the committed slider value and existing shared-source input'
      );
      assert.equal(
        await getNumericNodeValue(fixture.graphId, fixture.laneBSliderId),
        10,
        'Lane B slider should persist its released value'
      );

      await context.close();
    } finally {
      await browser.close();
    }
  }
);
