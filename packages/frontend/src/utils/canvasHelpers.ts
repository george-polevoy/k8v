import { CanvasBackgroundSettings } from '../types';
import { normalizeCanvasBackground } from './canvasBackground';

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function easeInOutCubic(value: number): number {
  const t = clamp(value, 0, 1);
  return t < 0.5
    ? 4 * t * t * t
    : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function parseHexColor(hexColor: string): { r: number; g: number; b: number } {
  const normalized = normalizeCanvasBackground({
    mode: 'gradient',
    baseColor: hexColor,
  }).baseColor;
  return {
    r: Number.parseInt(normalized.slice(1, 3), 16),
    g: Number.parseInt(normalized.slice(3, 5), 16),
    b: Number.parseInt(normalized.slice(5, 7), 16),
  };
}

function rgbToHex(color: { r: number; g: number; b: number }): string {
  const channel = (value: number) => clamp(Math.round(value), 0, 255).toString(16).padStart(2, '0');
  return `#${channel(color.r)}${channel(color.g)}${channel(color.b)}`;
}

export function interpolateCanvasBackground(
  from: CanvasBackgroundSettings,
  to: CanvasBackgroundSettings,
  amount: number
): CanvasBackgroundSettings {
  const t = clamp(amount, 0, 1);
  const fromRgb = parseHexColor(from.baseColor);
  const toRgb = parseHexColor(to.baseColor);
  const baseColor = rgbToHex({
    r: fromRgb.r + (toRgb.r - fromRgb.r) * t,
    g: fromRgb.g + (toRgb.g - fromRgb.g) * t,
    b: fromRgb.b + (toRgb.b - fromRgb.b) * t,
  });

  return {
    mode: t < 0.5 ? from.mode : to.mode,
    baseColor,
  };
}

export function snapToPixel(value: number): number {
  return Math.round(value);
}

export function makePortKey(nodeId: string, portName: string): string {
  return `${nodeId}\u0000${portName}`;
}

export function parsePortKey(key: string): { nodeId: string; portName: string } {
  const separatorIndex = key.indexOf('\u0000');
  if (separatorIndex === -1) {
    return { nodeId: key, portName: '' };
  }

  return {
    nodeId: key.slice(0, separatorIndex),
    portName: key.slice(separatorIndex + 1),
  };
}
