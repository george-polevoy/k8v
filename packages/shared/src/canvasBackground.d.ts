export type CanvasBackgroundMode = 'solid' | 'gradient';

export interface CanvasBackgroundSettings {
  mode: CanvasBackgroundMode;
  baseColor: string;
}

export const DEFAULT_CANVAS_BACKGROUND: Readonly<CanvasBackgroundSettings>;

export function normalizeCanvasBackground(
  value: Partial<CanvasBackgroundSettings> | null | undefined
): CanvasBackgroundSettings;

export function deriveGradientStops(baseColor: string): [string, string, string, string];

