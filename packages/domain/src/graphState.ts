import { DEFAULT_GRAPH_EXECUTION_TIMEOUT_MS } from './index.js';

function getNextSequentialName(prefix: string, existingNames: readonly string[]): string {
  const existing = new Set(existingNames);
  let index = 1;
  let candidate = `${prefix} ${index}`;
  while (existing.has(candidate)) {
    index += 1;
    candidate = `${prefix} ${index}`;
  }
  return candidate;
}

export function normalizeGraphExecutionTimeoutMs(
  value: unknown,
  fallback = DEFAULT_GRAPH_EXECUTION_TIMEOUT_MS
): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

export function getNextProjectionName(existingNames: readonly string[]): string {
  return getNextSequentialName('Projection', existingNames);
}

export function getNextCameraName(existingNames: readonly string[]): string {
  return getNextSequentialName('Camera', existingNames);
}
