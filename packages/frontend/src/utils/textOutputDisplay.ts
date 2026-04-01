export const DEFAULT_TEXT_OUTPUT_MAX_LINES = 8;
export const MIN_TEXT_OUTPUT_MAX_LINES = 1;
export const MAX_TEXT_OUTPUT_MAX_LINES = 200;

export type TextOutputOverflowMode = 'cap' | 'scroll';

export interface TextOutputDisplayConfig {
  displayTextOutputs: boolean;
  maxLines: number;
  overflowMode: TextOutputOverflowMode;
}

function toFiniteNumber(value: unknown): number {
  if (typeof value === 'number') {
    return value;
  }

  if (typeof value === 'string') {
    return Number.parseFloat(value);
  }

  return Number.NaN;
}

export function normalizeTextOutputMaxLines(
  value: unknown,
  fallback = DEFAULT_TEXT_OUTPUT_MAX_LINES
): number {
  const fallbackValue = Math.min(
    MAX_TEXT_OUTPUT_MAX_LINES,
    Math.max(
      MIN_TEXT_OUTPUT_MAX_LINES,
      Number.isFinite(fallback) ? Math.round(fallback) : DEFAULT_TEXT_OUTPUT_MAX_LINES
    )
  );
  const parsed = toFiniteNumber(value);

  if (!Number.isFinite(parsed)) {
    return fallbackValue;
  }

  return Math.min(MAX_TEXT_OUTPUT_MAX_LINES, Math.max(MIN_TEXT_OUTPUT_MAX_LINES, Math.round(parsed)));
}

export function normalizeTextOutputOverflowMode(value: unknown): TextOutputOverflowMode {
  return value === 'scroll' ? 'scroll' : 'cap';
}

export function normalizeTextOutputDisplayConfig(
  config?: Record<string, unknown>
): TextOutputDisplayConfig {
  return {
    displayTextOutputs: config?.displayTextOutputs === true,
    maxLines: normalizeTextOutputMaxLines(config?.textOutputMaxLines),
    overflowMode: normalizeTextOutputOverflowMode(config?.textOutputOverflowMode),
  };
}

export function countTextOutputLines(text: string): number {
  if (text.length === 0) {
    return 0;
  }

  let lineCount = 1;
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) === 10) {
      lineCount += 1;
    }
  }

  return lineCount;
}

export function truncateTextOutputToMaxLines(text: string, maxLines: number): string {
  if (text.length === 0) {
    return text;
  }

  const safeMaxLines = normalizeTextOutputMaxLines(maxLines);
  let visibleLines = 1;

  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) !== 10) {
      continue;
    }

    if (visibleLines >= safeMaxLines) {
      return text.slice(0, index);
    }

    visibleLines += 1;
  }

  return text;
}
