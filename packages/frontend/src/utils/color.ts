const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;
const HEX_COLOR_WITH_ALPHA_PATTERN = /^#[0-9a-f]{8}$/i;
const RGB_FUNCTION_PATTERN = /^rgba?\((.+)\)$/i;

const LEGACY_DRAWING_COLORS: Record<string, string> = {
  white: '#ffffff',
  green: '#22c55e',
  red: '#ef4444',
};

export interface NormalizedColorWithOpacity {
  hex: string;
  alpha: number;
}

function clampByte(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(255, Math.max(0, Math.round(value)));
}

function clampOpacity(value: number): number {
  if (!Number.isFinite(value)) {
    return 1;
  }
  if (value <= 0) {
    return 0;
  }
  if (value >= 1) {
    return 1;
  }
  return value;
}

function formatOpacity(alpha: number): string {
  const rounded = Math.round(clampOpacity(alpha) * 1000) / 1000;
  const text = rounded.toFixed(3);
  return text.replace(/0+$/, '').replace(/\.$/, '');
}

function serializeHex(r: number, g: number, b: number): string {
  return `#${clampByte(r).toString(16).padStart(2, '0')}${clampByte(g).toString(16).padStart(2, '0')}${clampByte(b).toString(16).padStart(2, '0')}`;
}

function parseAlpha(input: string): number | null {
  const trimmed = input.trim();
  if (trimmed.endsWith('%')) {
    const percentage = Number.parseFloat(trimmed.slice(0, -1));
    if (!Number.isFinite(percentage)) {
      return null;
    }
    return clampOpacity(percentage / 100);
  }

  const value = Number.parseFloat(trimmed);
  if (!Number.isFinite(value)) {
    return null;
  }
  return clampOpacity(value);
}

function parseRgbChannel(input: string): number | null {
  const value = Number.parseFloat(input.trim());
  if (!Number.isFinite(value)) {
    return null;
  }
  return clampByte(value);
}

function parseRgbFunctionColor(value: string): NormalizedColorWithOpacity | null {
  const match = value.match(RGB_FUNCTION_PATTERN);
  if (!match) {
    return null;
  }

  const parts = match[1].split(',').map((part) => part.trim());
  if (parts.length !== 3 && parts.length !== 4) {
    return null;
  }

  const r = parseRgbChannel(parts[0] ?? '');
  const g = parseRgbChannel(parts[1] ?? '');
  const b = parseRgbChannel(parts[2] ?? '');
  if (r === null || g === null || b === null) {
    return null;
  }

  const alpha = parts.length === 4 ? parseAlpha(parts[3] ?? '') : 1;
  if (alpha === null) {
    return null;
  }

  return {
    hex: serializeHex(r, g, b),
    alpha,
  };
}

function normalizeFallbackColor(fallbackColor: string): string {
  return HEX_COLOR_PATTERN.test(fallbackColor) ? fallbackColor.toLowerCase() : '#ffffff';
}

export function normalizeHexColor(value: unknown, fallbackColor: string): string {
  const fallback = normalizeFallbackColor(fallbackColor);

  if (typeof value !== 'string') {
    return fallback;
  }

  const trimmed = value.trim();
  const legacy = LEGACY_DRAWING_COLORS[trimmed.toLowerCase()];
  if (legacy) {
    return legacy;
  }

  if (!HEX_COLOR_PATTERN.test(trimmed)) {
    return fallback;
  }

  return trimmed.toLowerCase();
}

export function hexColorToNumber(value: unknown, fallbackColor: string): number {
  const normalized = normalizeHexColor(value, fallbackColor);
  return Number.parseInt(normalized.slice(1), 16);
}

export function tryParseColorWithOpacity(value: string): NormalizedColorWithOpacity | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const legacy = LEGACY_DRAWING_COLORS[trimmed.toLowerCase()];
  if (legacy) {
    return { hex: legacy, alpha: 1 };
  }

  if (HEX_COLOR_PATTERN.test(trimmed)) {
    return { hex: trimmed.toLowerCase(), alpha: 1 };
  }

  if (HEX_COLOR_WITH_ALPHA_PATTERN.test(trimmed)) {
    const normalized = trimmed.toLowerCase();
    const alphaChannel = Number.parseInt(normalized.slice(7, 9), 16);
    return {
      hex: normalized.slice(0, 7),
      alpha: clampOpacity(alphaChannel / 255),
    };
  }

  return parseRgbFunctionColor(trimmed.toLowerCase());
}

export function normalizeColorWithOpacity(
  value: unknown,
  fallbackColor: string,
  fallbackOpacity = 1
): NormalizedColorWithOpacity {
  const fallback = {
    hex: normalizeFallbackColor(fallbackColor),
    alpha: clampOpacity(fallbackOpacity),
  };

  if (typeof value !== 'string') {
    return fallback;
  }

  const parsed = tryParseColorWithOpacity(value);
  return parsed ?? fallback;
}

export function colorWithOpacityToCss(color: NormalizedColorWithOpacity): string {
  const hex = normalizeHexColor(color.hex, '#ffffff');
  const r = Number.parseInt(hex.slice(1, 3), 16);
  const g = Number.parseInt(hex.slice(3, 5), 16);
  const b = Number.parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${formatOpacity(color.alpha)})`;
}

export function serializeColorWithOpacity(
  color: NormalizedColorWithOpacity,
  preferHexWhenOpaque = true
): string {
  const normalizedHex = normalizeHexColor(color.hex, '#ffffff');
  const normalizedAlpha = clampOpacity(color.alpha);
  if (preferHexWhenOpaque && normalizedAlpha >= 0.999) {
    return normalizedHex;
  }
  return colorWithOpacityToCss({
    hex: normalizedHex,
    alpha: normalizedAlpha,
  });
}

export function normalizeColorString(
  value: unknown,
  fallbackColor: string,
  fallbackOpacity = 1,
  preferHexWhenOpaque = true
): string {
  const normalized = normalizeColorWithOpacity(value, fallbackColor, fallbackOpacity);
  return serializeColorWithOpacity(normalized, preferHexWhenOpaque);
}

export function colorStringToPixi(
  value: unknown,
  fallbackColor: string,
  fallbackOpacity = 1
): { color: number; alpha: number } {
  const normalized = normalizeColorWithOpacity(value, fallbackColor, fallbackOpacity);
  return {
    color: Number.parseInt(normalized.hex.slice(1), 16),
    alpha: normalized.alpha,
  };
}
