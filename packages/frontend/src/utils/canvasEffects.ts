import type { Position } from '../types';
import { clamp } from './canvasHelpers';
import type { NodeExecutionStateLike } from './canvasAnimation';

export interface ConnectionGeometry {
  id: string;
  startX: number;
  startY: number;
  c1X: number;
  c1Y: number;
  c2X: number;
  c2Y: number;
  endX: number;
  endY: number;
}

export interface LightningPulse {
  connectionId: string;
  startAt: number;
  durationMs: number;
}

export interface NodeShock {
  nodeId: string;
  startAt: number;
  durationMs: number;
}

export interface SmokePuff {
  nodeId: string;
  startAt: number;
  durationMs: number;
  originX: number;
  originY: number;
  driftX: number;
  driftY: number;
  startRadius: number;
  startAlpha: number;
  wobblePhase: number;
}

export interface CanvasEffectsNodeVisual {
  width: number;
  height: number;
}

export interface CanvasEffectsLayer {
  clear(): void;
  lineStyle(lineWidth: number, color: number, alpha?: number): void;
  beginFill(color: number, alpha?: number): void;
  endFill(): void;
  drawCircle(x: number, y: number, radius: number): void;
  drawRoundedRect(x: number, y: number, width: number, height: number, radius: number): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  bezierCurveTo(cp1x: number, cp1y: number, cp2x: number, cp2y: number, x: number, y: number): void;
}

export interface RunCanvasEffectsPassArgs {
  effectsLayer: CanvasEffectsLayer;
  now: number;
  hasGraph: boolean;
  nodeExecutionStates: Record<string, NodeExecutionStateLike | undefined>;
  nodeVisuals: Map<string, CanvasEffectsNodeVisual>;
  nodePositions: Map<string, Position>;
  connectionGeometries: Map<string, ConnectionGeometry>;
  smokePuffs: SmokePuff[];
  lightningPulses: LightningPulse[];
  nodeShocks: NodeShock[];
  lastSmokeEmitAtByNode: Map<string, number>;
  smokeEmitIntervalMs: number;
  smokeMinDurationMs: number;
  smokeMaxDurationMs: number;
  smokeMaxParticles: number;
  random?: () => number;
}

export interface CanvasEffectsPassResult {
  smokePuffs: SmokePuff[];
  lightningPulses: LightningPulse[];
  nodeShocks: NodeShock[];
  lastSmokeEmitAtByNode: Map<string, number>;
}

function pointOnBezier(geometry: ConnectionGeometry, t: number): { x: number; y: number } {
  const oneMinus = 1 - t;
  const oneMinus2 = oneMinus * oneMinus;
  const oneMinus3 = oneMinus2 * oneMinus;
  const t2 = t * t;
  const t3 = t2 * t;

  return {
    x:
      oneMinus3 * geometry.startX +
      3 * oneMinus2 * t * geometry.c1X +
      3 * oneMinus * t2 * geometry.c2X +
      t3 * geometry.endX,
    y:
      oneMinus3 * geometry.startY +
      3 * oneMinus2 * t * geometry.c1Y +
      3 * oneMinus * t2 * geometry.c2Y +
      t3 * geometry.endY,
  };
}

function tangentOnBezier(geometry: ConnectionGeometry, t: number): { x: number; y: number } {
  const oneMinus = 1 - t;
  const t2 = t * t;
  const oneMinus2 = oneMinus * oneMinus;

  return {
    x:
      3 * oneMinus2 * (geometry.c1X - geometry.startX) +
      6 * oneMinus * t * (geometry.c2X - geometry.c1X) +
      3 * t2 * (geometry.endX - geometry.c2X),
    y:
      3 * oneMinus2 * (geometry.c1Y - geometry.startY) +
      6 * oneMinus * t * (geometry.c2Y - geometry.c1Y) +
      3 * t2 * (geometry.endY - geometry.c2Y),
  };
}

function normalizeVector(x: number, y: number): { x: number; y: number } {
  const len = Math.hypot(x, y) || 1;
  return { x: x / len, y: y / len };
}

function drawBezierPath(effectsLayer: CanvasEffectsLayer, geometry: ConnectionGeometry): void {
  effectsLayer.moveTo(geometry.startX, geometry.startY);
  effectsLayer.bezierCurveTo(
    geometry.c1X,
    geometry.c1Y,
    geometry.c2X,
    geometry.c2Y,
    geometry.endX,
    geometry.endY
  );
}

export function enqueueLightningPulse(
  lightningPulses: LightningPulse[],
  connectionId: string,
  now: number,
  durationMs: number
): LightningPulse[] {
  return [
    ...lightningPulses.filter(
      (pulse) => !(pulse.connectionId === connectionId && now - pulse.startAt < pulse.durationMs * 0.35)
    ),
    {
      connectionId,
      startAt: now,
      durationMs,
    },
  ];
}

export function enqueueNodeShock(
  nodeShocks: NodeShock[],
  nodeId: string,
  now: number,
  durationMs: number
): NodeShock[] {
  return [
    ...nodeShocks.filter(
      (shock) => !(shock.nodeId === nodeId && now - shock.startAt < shock.durationMs * 0.4)
    ),
    {
      nodeId,
      startAt: now,
      durationMs,
    },
  ];
}

export function runCanvasEffectsPass({
  effectsLayer,
  now,
  hasGraph,
  nodeExecutionStates,
  nodeVisuals,
  nodePositions,
  connectionGeometries,
  smokePuffs,
  lightningPulses,
  nodeShocks,
  lastSmokeEmitAtByNode,
  smokeEmitIntervalMs,
  smokeMinDurationMs,
  smokeMaxDurationMs,
  smokeMaxParticles,
  random = Math.random,
}: RunCanvasEffectsPassArgs): CanvasEffectsPassResult {
  effectsLayer.clear();
  let nextSmokePuffs = smokePuffs;
  const nextLastSmokeEmitAtByNode = new Map(lastSmokeEmitAtByNode);

  if (hasGraph) {
    const erroredNodeIds = new Set<string>();
    for (const [nodeId, state] of Object.entries(nodeExecutionStates)) {
      if (state?.hasError) {
        erroredNodeIds.add(nodeId);
      }
    }

    for (const nodeId of erroredNodeIds) {
      const visual = nodeVisuals.get(nodeId);
      const position = nodePositions.get(nodeId);
      if (!visual || !position) {
        continue;
      }

      const lastEmittedAt = nextLastSmokeEmitAtByNode.get(nodeId) ?? (now - smokeEmitIntervalMs);
      if (now - lastEmittedAt >= smokeEmitIntervalMs) {
        nextSmokePuffs = [
          ...nextSmokePuffs,
          {
            nodeId,
            startAt: now,
            durationMs: smokeMinDurationMs + random() * (smokeMaxDurationMs - smokeMinDurationMs),
            originX: position.x + visual.width - 14 + (random() - 0.5) * 5,
            originY: position.y + 12 + (random() - 0.5) * 3,
            driftX: (random() - 0.5) * 18,
            driftY: -24 - random() * 24,
            startRadius: 2.8 + random() * 2.2,
            startAlpha: 0.2 + random() * 0.18,
            wobblePhase: random() * Math.PI * 2,
          },
        ];
        nextLastSmokeEmitAtByNode.set(nodeId, now);
      }
    }

    for (const nodeId of Array.from(nextLastSmokeEmitAtByNode.keys())) {
      if (!erroredNodeIds.has(nodeId)) {
        nextLastSmokeEmitAtByNode.delete(nodeId);
      }
    }
  }

  nextSmokePuffs = nextSmokePuffs.filter((puff) => {
    const age = (now - puff.startAt) / puff.durationMs;
    if (age < 0 || age >= 1) {
      return false;
    }

    const fade = 1 - age;
    const radius = puff.startRadius + (age * 7.5);
    const x = puff.originX + (puff.driftX * age) + Math.sin((age * 10) + puff.wobblePhase) * (1 + age * 1.8);
    const y = puff.originY + (puff.driftY * age);
    const alpha = puff.startAlpha * fade * fade;

    effectsLayer.beginFill(0x020617, alpha);
    effectsLayer.drawCircle(x, y, radius);
    effectsLayer.endFill();
    effectsLayer.beginFill(0x0f172a, alpha * 0.55);
    effectsLayer.drawCircle(x - (radius * 0.15), y - (radius * 0.25), radius * 0.58);
    effectsLayer.endFill();

    return true;
  });

  if (nextSmokePuffs.length > smokeMaxParticles) {
    nextSmokePuffs = nextSmokePuffs.slice(nextSmokePuffs.length - smokeMaxParticles);
  }

  const nextLightningPulses = lightningPulses.filter((pulse) => {
    const geometry = connectionGeometries.get(pulse.connectionId);
    if (!geometry) {
      return now - pulse.startAt < pulse.durationMs;
    }

    const progress = (now - pulse.startAt) / pulse.durationMs;
    if (progress < 0 || progress >= 1) {
      return false;
    }

    const headT = clamp(progress, 0, 1);
    const tailT = clamp(headT - 0.5, 0, headT);
    const alpha = 1 - progress;
    const samples = 20;

    effectsLayer.lineStyle(8, 0x93c5fd, 0.55 * alpha);
    drawBezierPath(effectsLayer, geometry);

    effectsLayer.lineStyle(5.5, 0xe0f2fe, 1 * alpha);
    let started = false;
    for (let i = 0; i <= samples; i += 1) {
      const ratio = i / samples;
      const t = tailT + (headT - tailT) * ratio;
      const point = pointOnBezier(geometry, t);
      const tangent = tangentOnBezier(geometry, t);
      const normal = normalizeVector(-tangent.y, tangent.x);
      const jitter =
        Math.sin((t * 52) + (progress * 22) + (i * 0.7)) * (2.8 * (1 - ratio * 0.45));
      const x = point.x + normal.x * jitter;
      const y = point.y + normal.y * jitter;

      if (!started) {
        effectsLayer.moveTo(x, y);
        started = true;
      } else {
        effectsLayer.lineTo(x, y);
      }
    }

    effectsLayer.lineStyle(2, 0xffffff, 0.95 * alpha);
    started = false;
    for (let i = 0; i <= samples; i += 1) {
      const ratio = i / samples;
      const t = tailT + (headT - tailT) * ratio;
      const point = pointOnBezier(geometry, t);
      if (!started) {
        effectsLayer.moveTo(point.x, point.y);
        started = true;
      } else {
        effectsLayer.lineTo(point.x, point.y);
      }
    }

    const headPoint = pointOnBezier(geometry, headT);
    effectsLayer.beginFill(0xf8fbff, 0.95 * alpha);
    effectsLayer.drawCircle(headPoint.x, headPoint.y, 4.5);
    effectsLayer.endFill();
    effectsLayer.lineStyle(1.4, 0xbfdbfe, 0.8 * alpha);
    effectsLayer.drawCircle(headPoint.x, headPoint.y, 8.5);

    return true;
  });

  const nextNodeShocks = nodeShocks.filter((shock) => {
    const visual = nodeVisuals.get(shock.nodeId);
    const position = nodePositions.get(shock.nodeId);
    if (!visual || !position) {
      return now - shock.startAt < shock.durationMs;
    }

    const progress = (now - shock.startAt) / shock.durationMs;
    if (progress < 0 || progress >= 1) {
      return false;
    }

    const alpha = 1 - progress;
    const glowExpand = 6 + progress * 10;
    effectsLayer.lineStyle(2.2, 0xe2f0ff, 0.75 * alpha);
    effectsLayer.drawRoundedRect(
      position.x - glowExpand,
      position.y - glowExpand,
      visual.width + glowExpand * 2,
      visual.height + glowExpand * 2,
      12 + glowExpand * 0.35
    );

    const statusX = position.x + visual.width - 14;
    const statusY = position.y + 14;
    effectsLayer.lineStyle(1.6, 0xffffff, 0.65 * alpha);
    effectsLayer.drawCircle(statusX, statusY, 7 + progress * 11);
    effectsLayer.lineStyle(1, 0x93c5fd, 0.55 * alpha);
    effectsLayer.drawCircle(statusX, statusY, 4 + progress * 7);

    return true;
  });

  return {
    smokePuffs: nextSmokePuffs,
    lightningPulses: nextLightningPulses,
    nodeShocks: nextNodeShocks,
    lastSmokeEmitAtByNode: nextLastSmokeEmitAtByNode,
  };
}
