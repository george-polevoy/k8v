import { clamp, normalizeHexColor } from './color.js';

export const DEFAULT_CANVAS_BACKGROUND = Object.freeze({
  mode: 'gradient',
  baseColor: '#1d437e',
});

function normalizeCanvasMode(value) {
  return value === 'solid' || value === 'gradient'
    ? value
    : DEFAULT_CANVAS_BACKGROUND.mode;
}

function clampByte(value) {
  return clamp(Math.round(value), 0, 255);
}

function parseHexColor(hexColor) {
  return {
    r: Number.parseInt(hexColor.slice(1, 3), 16),
    g: Number.parseInt(hexColor.slice(3, 5), 16),
    b: Number.parseInt(hexColor.slice(5, 7), 16),
  };
}

function rgbToHex(color) {
  const r = clampByte(color.r).toString(16).padStart(2, '0');
  const g = clampByte(color.g).toString(16).padStart(2, '0');
  const b = clampByte(color.b).toString(16).padStart(2, '0');
  return `#${r}${g}${b}`;
}

function mixRgb(from, to, amount) {
  const t = clamp(amount, 0, 1);
  return {
    r: from.r + (to.r - from.r) * t,
    g: from.g + (to.g - from.g) * t,
    b: from.b + (to.b - from.b) * t,
  };
}

export function normalizeCanvasBackground(value) {
  return {
    mode: normalizeCanvasMode(value?.mode),
    baseColor: normalizeHexColor(value?.baseColor, DEFAULT_CANVAS_BACKGROUND.baseColor),
  };
}

export function deriveGradientStops(baseColor) {
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

