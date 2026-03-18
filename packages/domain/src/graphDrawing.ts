const LEGACY_DRAWING_COLORS: Record<string, string> = {
  white: '#ffffff',
  green: '#22c55e',
  red: '#ef4444',
};

const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;
export const DEFAULT_DRAWING_COLOR = '#ffffff';

type DrawingPathLike = Record<string, unknown> & {
  color?: unknown;
};

type DrawingLike<TPath extends DrawingPathLike> = Record<string, unknown> & {
  paths?: TPath[];
};

export function normalizeDrawingColor(value: unknown, fallback = DEFAULT_DRAWING_COLOR): string {
  const fallbackColor = HEX_COLOR_PATTERN.test(String(fallback))
    ? String(fallback).toLowerCase()
    : DEFAULT_DRAWING_COLOR;
  if (typeof value !== 'string') {
    return fallbackColor;
  }

  const trimmed = value.trim().toLowerCase();
  if (trimmed in LEGACY_DRAWING_COLORS) {
    return LEGACY_DRAWING_COLORS[trimmed] ?? fallbackColor;
  }
  if (!HEX_COLOR_PATTERN.test(trimmed)) {
    return fallbackColor;
  }
  return trimmed;
}

export function normalizeGraphDrawings<
  TPath extends DrawingPathLike,
  TDrawing extends DrawingLike<TPath>,
>(
  drawings: readonly TDrawing[] | null | undefined,
  fallbackColor = DEFAULT_DRAWING_COLOR
): TDrawing[] {
  if (!Array.isArray(drawings)) {
    return [];
  }

  return drawings.map((drawing) => ({
    ...drawing,
    paths: (drawing.paths ?? []).map((path: TPath) => ({
      ...path,
      color: normalizeDrawingColor(path.color, fallbackColor),
    })) as TPath[],
  }));
}
