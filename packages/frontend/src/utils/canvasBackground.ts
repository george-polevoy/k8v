import { CanvasBackgroundSettings, Graph } from '../types';
import { normalizeHexColor } from './color';

export const DEFAULT_CANVAS_BACKGROUND: CanvasBackgroundSettings = {
  mode: 'gradient',
  baseColor: '#1d437e',
};

interface RgbColor {
  r: number;
  g: number;
  b: number;
}

function clampByte(value: number): number {
  return Math.min(255, Math.max(0, Math.round(value)));
}

function parseHexColor(hexColor: string): RgbColor {
  return {
    r: Number.parseInt(hexColor.slice(1, 3), 16),
    g: Number.parseInt(hexColor.slice(3, 5), 16),
    b: Number.parseInt(hexColor.slice(5, 7), 16),
  };
}

function rgbToHex(color: RgbColor): string {
  const r = clampByte(color.r).toString(16).padStart(2, '0');
  const g = clampByte(color.g).toString(16).padStart(2, '0');
  const b = clampByte(color.b).toString(16).padStart(2, '0');
  return `#${r}${g}${b}`;
}

function mixRgb(from: RgbColor, to: RgbColor, amount: number): RgbColor {
  const t = Math.min(1, Math.max(0, amount));
  return {
    r: from.r + (to.r - from.r) * t,
    g: from.g + (to.g - from.g) * t,
    b: from.b + (to.b - from.b) * t,
  };
}

function normalizeMode(value: unknown): CanvasBackgroundSettings['mode'] {
  if (value === 'solid' || value === 'gradient') {
    return value;
  }
  return DEFAULT_CANVAS_BACKGROUND.mode;
}

export function normalizeCanvasBackground(
  value: Partial<CanvasBackgroundSettings> | null | undefined
): CanvasBackgroundSettings {
  return {
    mode: normalizeMode(value?.mode),
    baseColor: normalizeHexColor(value?.baseColor, DEFAULT_CANVAS_BACKGROUND.baseColor),
  };
}

export function resolveGraphCanvasBackground(
  graph: Pick<Graph, 'canvasBackground'> | null | undefined
): CanvasBackgroundSettings {
  return normalizeCanvasBackground(graph?.canvasBackground);
}

export function deriveGradientStops(baseColor: string): [string, string, string, string] {
  const normalizedBase = normalizeHexColor(baseColor, DEFAULT_CANVAS_BACKGROUND.baseColor);
  const base = parseHexColor(normalizedBase);
  const white = { r: 255, g: 255, b: 255 };
  const black = { r: 0, g: 0, b: 0 };

  return [
    rgbToHex(mixRgb(base, white, 0.2)),
    normalizedBase,
    rgbToHex(mixRgb(base, black, 0.34)),
    rgbToHex(mixRgb(base, black, 0.64)),
  ];
}
