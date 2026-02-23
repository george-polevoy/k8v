const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

const LEGACY_DRAWING_COLORS: Record<string, string> = {
  white: '#ffffff',
  green: '#22c55e',
  red: '#ef4444',
};

export function normalizeHexColor(value: unknown, fallbackColor: string): string {
  const fallback = HEX_COLOR_PATTERN.test(fallbackColor) ? fallbackColor.toLowerCase() : '#ffffff';

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

