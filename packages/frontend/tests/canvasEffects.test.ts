import assert from 'node:assert/strict';
import test from 'node:test';
import {
  enqueueLightningPulse,
  enqueueNodeShock,
  runCanvasEffectsPass,
  type CanvasEffectsLayer,
  type ConnectionGeometry,
  type LightningPulse,
  type NodeShock,
  type SmokePuff,
} from '../src/utils/canvasEffects.ts';

function createLayerSpy(): {
  layer: CanvasEffectsLayer;
  getCallCount: (name: string) => number;
} {
  const callCounts = new Map<string, number>();
  const countCall = (name: string) => {
    callCounts.set(name, (callCounts.get(name) ?? 0) + 1);
  };

  const layer: CanvasEffectsLayer = {
    clear: () => countCall('clear'),
    lineStyle: () => countCall('lineStyle'),
    beginFill: () => countCall('beginFill'),
    endFill: () => countCall('endFill'),
    drawCircle: () => countCall('drawCircle'),
    drawRoundedRect: () => countCall('drawRoundedRect'),
    moveTo: () => countCall('moveTo'),
    lineTo: () => countCall('lineTo'),
    bezierCurveTo: () => countCall('bezierCurveTo'),
  };

  return {
    layer,
    getCallCount: (name: string) => callCounts.get(name) ?? 0,
  };
}

function createConnectionGeometry(id: string): ConnectionGeometry {
  return {
    id,
    startX: 10,
    startY: 10,
    c1X: 40,
    c1Y: 10,
    c2X: 70,
    c2Y: 30,
    endX: 100,
    endY: 30,
  };
}

function createSmokePuff(index: number): SmokePuff {
  return {
    nodeId: `node-${index}`,
    startAt: 0,
    durationMs: 1_000,
    originX: 10 + index,
    originY: 20 + index,
    driftX: 0,
    driftY: -20,
    startRadius: 3,
    startAlpha: 0.2,
    wobblePhase: 0,
  };
}

test('enqueueLightningPulse replaces a recent pulse for the same connection', () => {
  const pulses: LightningPulse[] = [
    { connectionId: 'c-1', startAt: 100, durationMs: 1_000 },
    { connectionId: 'c-2', startAt: 0, durationMs: 1_000 },
  ];

  const next = enqueueLightningPulse(pulses, 'c-1', 200, 900);

  assert.equal(next.length, 2);
  assert.equal(next.some((pulse) => pulse.connectionId === 'c-1' && pulse.startAt === 100), false);
  assert.equal(next.some((pulse) => pulse.connectionId === 'c-1' && pulse.startAt === 200), true);
  assert.equal(next.some((pulse) => pulse.connectionId === 'c-2'), true);
});

test('enqueueNodeShock replaces a recent shock for the same node', () => {
  const nodeShocks: NodeShock[] = [
    { nodeId: 'n-1', startAt: 100, durationMs: 1_000 },
    { nodeId: 'n-2', startAt: 0, durationMs: 1_000 },
  ];

  const next = enqueueNodeShock(nodeShocks, 'n-1', 250, 800);

  assert.equal(next.length, 2);
  assert.equal(next.some((shock) => shock.nodeId === 'n-1' && shock.startAt === 100), false);
  assert.equal(next.some((shock) => shock.nodeId === 'n-1' && shock.startAt === 250), true);
  assert.equal(next.some((shock) => shock.nodeId === 'n-2'), true);
});

test('runCanvasEffectsPass emits smoke for errored nodes and cleans stale emit timestamps', () => {
  const layerSpy = createLayerSpy();

  const result = runCanvasEffectsPass({
    effectsLayer: layerSpy.layer,
    now: 1_000,
    hasGraph: true,
    nodeExecutionStates: {
      'node-a': { hasError: true },
      stale: { hasError: false },
    },
    nodeVisuals: new Map([['node-a', { width: 120, height: 90 }]]),
    nodePositions: new Map([['node-a', { x: 30, y: 40 }]]),
    connectionGeometries: new Map([['conn-1', createConnectionGeometry('conn-1')]]),
    smokePuffs: [
      {
        nodeId: 'old',
        startAt: 0,
        durationMs: 100,
        originX: 0,
        originY: 0,
        driftX: 0,
        driftY: 0,
        startRadius: 2,
        startAlpha: 0.2,
        wobblePhase: 0,
      },
    ],
    lightningPulses: [{ connectionId: 'conn-1', startAt: 900, durationMs: 400 }],
    nodeShocks: [{ nodeId: 'node-a', startAt: 900, durationMs: 400 }],
    lastSmokeEmitAtByNode: new Map([
      ['node-a', 800],
      ['stale', 800],
    ]),
    smokeEmitIntervalMs: 120,
    smokeMinDurationMs: 700,
    smokeMaxDurationMs: 900,
    smokeMaxParticles: 96,
    random: () => 0.5,
  });

  assert.equal(result.lastSmokeEmitAtByNode.has('node-a'), true);
  assert.equal(result.lastSmokeEmitAtByNode.has('stale'), false);
  assert.equal(result.smokePuffs.length, 1);
  assert.equal(result.lightningPulses.length, 1);
  assert.equal(result.nodeShocks.length, 1);
  assert.equal(layerSpy.getCallCount('clear'), 1);
  assert.ok(layerSpy.getCallCount('drawCircle') > 0);
});

test('runCanvasEffectsPass trims smoke particles to max limit', () => {
  const layerSpy = createLayerSpy();
  const smokePuffs = [0, 1, 2, 3, 4].map((index) => createSmokePuff(index));

  const result = runCanvasEffectsPass({
    effectsLayer: layerSpy.layer,
    now: 100,
    hasGraph: false,
    nodeExecutionStates: {},
    nodeVisuals: new Map(),
    nodePositions: new Map(),
    connectionGeometries: new Map(),
    smokePuffs,
    lightningPulses: [],
    nodeShocks: [],
    lastSmokeEmitAtByNode: new Map([['node-a', 10]]),
    smokeEmitIntervalMs: 120,
    smokeMinDurationMs: 700,
    smokeMaxDurationMs: 900,
    smokeMaxParticles: 3,
  });

  assert.equal(result.smokePuffs.length, 3);
  assert.deepEqual(
    result.smokePuffs.map((puff) => puff.nodeId),
    ['node-2', 'node-3', 'node-4']
  );
  assert.equal(result.lastSmokeEmitAtByNode.has('node-a'), true);
});
