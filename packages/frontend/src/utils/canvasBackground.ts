import { CanvasBackgroundSettings, Graph } from '../types';
import {
  DEFAULT_CANVAS_BACKGROUND as SHARED_DEFAULT_CANVAS_BACKGROUND,
  deriveGradientStops as deriveSharedGradientStops,
  normalizeCanvasBackground as normalizeSharedCanvasBackground,
} from '../../../shared/src/canvasBackground.js';

export const DEFAULT_CANVAS_BACKGROUND: CanvasBackgroundSettings = SHARED_DEFAULT_CANVAS_BACKGROUND;

export function normalizeCanvasBackground(
  value: Partial<CanvasBackgroundSettings> | null | undefined
): CanvasBackgroundSettings {
  return normalizeSharedCanvasBackground(value);
}

export function resolveGraphCanvasBackground(
  graph: Pick<Graph, 'canvasBackground'> | null | undefined
): CanvasBackgroundSettings {
  return normalizeCanvasBackground(graph?.canvasBackground);
}

export function deriveGradientStops(baseColor: string): [string, string, string, string] {
  return deriveSharedGradientStops(baseColor);
}
