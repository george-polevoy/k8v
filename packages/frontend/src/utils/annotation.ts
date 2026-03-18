import { normalizeColorString } from './color';

export const DEFAULT_ANNOTATION_TEXT = '';
export const DEFAULT_ANNOTATION_BACKGROUND_COLOR = '#fef3c7';
export const DEFAULT_ANNOTATION_BORDER_COLOR = '#334155';
export const DEFAULT_ANNOTATION_FONT_COLOR = '#1f2937';
export const DEFAULT_ANNOTATION_FONT_SIZE = 14;
export const MIN_ANNOTATION_FONT_SIZE = 8;
export const MAX_ANNOTATION_FONT_SIZE = 72;
export type AnnotationColorTarget = 'background' | 'border' | 'font';

export interface AnnotationConfig {
  text: string;
  backgroundColor: string;
  borderColor: string;
  fontColor: string;
  fontSize: number;
}

export function normalizeAnnotationFontSize(
  value: unknown,
  fallback = DEFAULT_ANNOTATION_FONT_SIZE
): number {
  const fallbackSize = Math.min(
    MAX_ANNOTATION_FONT_SIZE,
    Math.max(MIN_ANNOTATION_FONT_SIZE, Number.isFinite(fallback) ? fallback : DEFAULT_ANNOTATION_FONT_SIZE)
  );
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string'
      ? Number.parseFloat(value)
      : Number.NaN;
  if (!Number.isFinite(parsed)) {
    return fallbackSize;
  }
  return Math.min(MAX_ANNOTATION_FONT_SIZE, Math.max(MIN_ANNOTATION_FONT_SIZE, Math.round(parsed)));
}

export function normalizeAnnotationConfig(config?: Record<string, unknown>): AnnotationConfig {
  return {
    text: typeof config?.text === 'string' ? config.text : DEFAULT_ANNOTATION_TEXT,
    backgroundColor: normalizeColorString(config?.backgroundColor, DEFAULT_ANNOTATION_BACKGROUND_COLOR),
    borderColor: normalizeColorString(config?.borderColor, DEFAULT_ANNOTATION_BORDER_COLOR),
    fontColor: normalizeColorString(config?.fontColor, DEFAULT_ANNOTATION_FONT_COLOR),
    fontSize: normalizeAnnotationFontSize(config?.fontSize),
  };
}

export function normalizeAnnotationDraft(
  draft: Partial<Record<keyof AnnotationConfig, unknown>> | undefined,
  fallback?: Partial<AnnotationConfig>
): AnnotationConfig {
  const normalizedFallback = normalizeAnnotationConfig(fallback as Record<string, unknown> | undefined);
  return {
    text: typeof draft?.text === 'string' ? draft.text : normalizedFallback.text,
    backgroundColor: normalizeColorString(
      draft?.backgroundColor,
      normalizedFallback.backgroundColor
    ),
    borderColor: normalizeColorString(
      draft?.borderColor,
      normalizedFallback.borderColor
    ),
    fontColor: normalizeColorString(
      draft?.fontColor,
      normalizedFallback.fontColor
    ),
    fontSize: normalizeAnnotationFontSize(draft?.fontSize, normalizedFallback.fontSize),
  };
}

export function getAnnotationColorDialogDefaultColor(
  target: AnnotationColorTarget | null
): string {
  if (target === 'background') {
    return DEFAULT_ANNOTATION_BACKGROUND_COLOR;
  }
  if (target === 'border') {
    return DEFAULT_ANNOTATION_BORDER_COLOR;
  }
  return DEFAULT_ANNOTATION_FONT_COLOR;
}

export function getAnnotationColorDialogInitialColor(
  target: AnnotationColorTarget | null,
  colors: Pick<AnnotationConfig, 'backgroundColor' | 'borderColor' | 'fontColor'>
): string {
  if (target === 'background') {
    return colors.backgroundColor;
  }
  if (target === 'border') {
    return colors.borderColor;
  }
  return colors.fontColor;
}
