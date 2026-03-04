export interface NumericInputConfig {
  value: number;
  min: number;
  max: number;
  step: number;
}

function toFiniteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function countStepDecimals(step: number): number {
  const text = String(step).toLowerCase();
  if (text.includes('e-')) {
    const exponent = Number.parseInt(text.split('e-')[1] || '0', 10);
    return Number.isFinite(exponent) ? exponent : 0;
  }

  const decimalIndex = text.indexOf('.');
  if (decimalIndex === -1) {
    return 0;
  }

  return text.length - decimalIndex - 1;
}

export function snapNumericInputValue(value: number, min: number, max: number, step: number): number {
  if (max <= min) {
    return min;
  }

  const clamped = Math.min(Math.max(value, min), max);
  const steps = Math.round((clamped - min) / step);
  const snapped = min + (steps * step);
  const decimals = countStepDecimals(step);
  const rounded = Number(snapped.toFixed(decimals));
  return Math.min(Math.max(rounded, min), max);
}

export function normalizeNumericInputConfig(config?: Record<string, unknown>): NumericInputConfig {
  const min = toFiniteNumber(config?.min, 0);
  const maxCandidate = toFiniteNumber(config?.max, 100);
  const max = maxCandidate >= min ? maxCandidate : min;
  const stepCandidate = toFiniteNumber(config?.step, 1);
  const step = stepCandidate > 0 ? stepCandidate : 1;
  const valueCandidate = toFiniteNumber(config?.value, min);
  const value = snapNumericInputValue(valueCandidate, min, max, step);
  return { value, min, max, step };
}

export function formatNumericInputValue(value: number, step: number): string {
  const decimals = Math.min(countStepDecimals(step), 8);
  if (decimals <= 0) {
    return String(Math.round(value));
  }
  const fixed = value.toFixed(decimals);
  return fixed.replace(/\.?0+$/, '');
}

