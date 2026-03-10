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

export interface RgbChannels {
  r: number;
  g: number;
  b: number;
}

export interface HsvColor {
  h: number;
  s: number;
  v: number;
}

function clampByte(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(255, Math.max(0, Math.round(value)));
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
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

function normalizeHueDegrees(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  const normalized = value % 360;
  return normalized < 0 ? normalized + 360 : normalized;
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

export function hexToRgbChannels(hex: string): RgbChannels {
  const normalizedHex = normalizeHexColor(hex, '#000000');
  return {
    r: Number.parseInt(normalizedHex.slice(1, 3), 16),
    g: Number.parseInt(normalizedHex.slice(3, 5), 16),
    b: Number.parseInt(normalizedHex.slice(5, 7), 16),
  };
}

export function rgbChannelsToHex(channels: RgbChannels): string {
  return serializeHex(channels.r, channels.g, channels.b);
}

export function rgbChannelsToHsv(channels: RgbChannels): HsvColor {
  const red = clampByte(channels.r) / 255;
  const green = clampByte(channels.g) / 255;
  const blue = clampByte(channels.b) / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;

  let hue = 0;
  if (delta > 0) {
    if (max === red) {
      hue = 60 * (((green - blue) / delta) % 6);
    } else if (max === green) {
      hue = 60 * (((blue - red) / delta) + 2);
    } else {
      hue = 60 * (((red - green) / delta) + 4);
    }
  }

  return {
    h: normalizeHueDegrees(hue),
    s: max === 0 ? 0 : delta / max,
    v: max,
  };
}

export function hsvToRgbChannels(color: HsvColor): RgbChannels {
  const hue = normalizeHueDegrees(color.h);
  const saturation = clampUnit(color.s);
  const value = clampUnit(color.v);

  if (saturation <= 0) {
    const channel = clampByte(value * 255);
    return { r: channel, g: channel, b: channel };
  }

  const chroma = value * saturation;
  const hueSegment = hue / 60;
  const secondary = chroma * (1 - Math.abs((hueSegment % 2) - 1));
  const match = value - chroma;
  let red = 0;
  let green = 0;
  let blue = 0;

  if (hueSegment >= 0 && hueSegment < 1) {
    red = chroma;
    green = secondary;
  } else if (hueSegment < 2) {
    red = secondary;
    green = chroma;
  } else if (hueSegment < 3) {
    green = chroma;
    blue = secondary;
  } else if (hueSegment < 4) {
    green = secondary;
    blue = chroma;
  } else if (hueSegment < 5) {
    red = secondary;
    blue = chroma;
  } else {
    red = chroma;
    blue = secondary;
  }

  return {
    r: clampByte((red + match) * 255),
    g: clampByte((green + match) * 255),
    b: clampByte((blue + match) * 255),
  };
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
  const { r, g, b } = hexToRgbChannels(hex);
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
