const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function normalizeHexColor(value, fallback) {
  const fallbackColor = HEX_COLOR_PATTERN.test(String(fallback))
    ? String(fallback).toLowerCase()
    : '#000000';

  if (typeof value !== 'string') {
    return fallbackColor;
  }

  const trimmed = value.trim().toLowerCase();
  return HEX_COLOR_PATTERN.test(trimmed) ? trimmed : fallbackColor;
}

