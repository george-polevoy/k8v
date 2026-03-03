import { Graph, GraphConnectionStrokeSettings } from '../types';
import { normalizeHexColor } from './color';

const MIN_CONNECTION_STROKE_WIDTH = 0.25;
const MAX_CONNECTION_STROKE_WIDTH = 24;
const MIN_CONNECTION_BRIGHTNESS_DELTA = 24;
const CONNECTION_BRIGHTNESS_ADJUSTMENT = 42;

export const DEFAULT_GRAPH_CONNECTION_STROKE: GraphConnectionStrokeSettings = {
  foregroundColor: '#334155',
  backgroundColor: '#cbd5e1',
  foregroundWidth: 1,
  backgroundWidth: 2,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function normalizeWidth(value: number): number {
  return Math.round(clamp(value, MIN_CONNECTION_STROKE_WIDTH, MAX_CONNECTION_STROKE_WIDTH) * 1000) / 1000;
}

function toHexChannel(value: number): string {
  return clamp(Math.round(value), 0, 255).toString(16).padStart(2, '0');
}

function adjustHexBrightness(color: string, delta: number): string {
  const r = Number.parseInt(color.slice(1, 3), 16);
  const g = Number.parseInt(color.slice(3, 5), 16);
  const b = Number.parseInt(color.slice(5, 7), 16);
  return `#${toHexChannel(r + delta)}${toHexChannel(g + delta)}${toHexChannel(b + delta)}`;
}

function resolveBrightness(color: string): number {
  const r = Number.parseInt(color.slice(1, 3), 16);
  const g = Number.parseInt(color.slice(3, 5), 16);
  const b = Number.parseInt(color.slice(5, 7), 16);
  return (0.299 * r) + (0.587 * g) + (0.114 * b);
}

function normalizeBackgroundColor(
  foregroundColor: string,
  requestedBackgroundColor: string
): string {
  const foregroundBrightness = resolveBrightness(foregroundColor);
  const backgroundBrightness = resolveBrightness(requestedBackgroundColor);
  if (Math.abs(foregroundBrightness - backgroundBrightness) >= MIN_CONNECTION_BRIGHTNESS_DELTA) {
    return requestedBackgroundColor;
  }

  const lighterCandidate = adjustHexBrightness(requestedBackgroundColor, CONNECTION_BRIGHTNESS_ADJUSTMENT);
  const darkerCandidate = adjustHexBrightness(requestedBackgroundColor, -CONNECTION_BRIGHTNESS_ADJUSTMENT);
  const lighterDelta = Math.abs(resolveBrightness(lighterCandidate) - foregroundBrightness);
  const darkerDelta = Math.abs(resolveBrightness(darkerCandidate) - foregroundBrightness);
  const preferred = lighterDelta >= darkerDelta ? lighterCandidate : darkerCandidate;
  if (Math.abs(resolveBrightness(preferred) - foregroundBrightness) >= MIN_CONNECTION_BRIGHTNESS_DELTA) {
    return preferred;
  }

  return foregroundBrightness >= 128 ? '#111827' : '#e2e8f0';
}

export function normalizeGraphConnectionStroke(
  value: Partial<GraphConnectionStrokeSettings> | null | undefined
): GraphConnectionStrokeSettings {
  const foregroundColor = normalizeHexColor(
    value?.foregroundColor,
    DEFAULT_GRAPH_CONNECTION_STROKE.foregroundColor
  );
  const requestedBackgroundColor = normalizeHexColor(
    value?.backgroundColor,
    DEFAULT_GRAPH_CONNECTION_STROKE.backgroundColor
  );

  const rawForegroundWidth = typeof value?.foregroundWidth === 'number' && Number.isFinite(value.foregroundWidth)
    ? value.foregroundWidth
    : Number.NaN;
  const rawBackgroundWidth = typeof value?.backgroundWidth === 'number' && Number.isFinite(value.backgroundWidth)
    ? value.backgroundWidth
    : Number.NaN;

  const inferredForegroundWidth = rawForegroundWidth > 0
    ? rawForegroundWidth
    : rawBackgroundWidth > 0
      ? rawBackgroundWidth * 0.5
      : DEFAULT_GRAPH_CONNECTION_STROKE.foregroundWidth;
  const foregroundWidth = normalizeWidth(inferredForegroundWidth);
  const backgroundWidth = Math.round((foregroundWidth * 2) * 1000) / 1000;

  return {
    foregroundColor,
    backgroundColor: normalizeBackgroundColor(foregroundColor, requestedBackgroundColor),
    foregroundWidth,
    backgroundWidth,
  };
}

export function resolveGraphConnectionStroke(
  graph: Pick<Graph, 'connectionStroke'> | null | undefined
): GraphConnectionStrokeSettings {
  return normalizeGraphConnectionStroke(graph?.connectionStroke);
}
