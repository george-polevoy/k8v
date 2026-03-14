export interface PersistedWindowPosition {
  x: number;
  y: number;
}

export interface PersistedViewportTransform {
  x: number;
  y: number;
  scale: number;
}

const FLOATING_WINDOW_POSITION_KEY_PREFIX = 'k8v-floating-window-position:';
const GRAPH_VIEWPORT_TRANSFORM_KEY_PREFIX = 'k8v-graph-viewport-transform:';

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function readJsonValue(key: string): unknown | null {
  try {
    const rawValue = localStorage.getItem(key);
    if (!rawValue) {
      return null;
    }
    return JSON.parse(rawValue);
  } catch (storageError) {
    console.warn(`Could not read persisted UI state for ${key}:`, storageError);
    return null;
  }
}

function writeJsonValue(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (storageError) {
    console.warn(`Could not persist UI state for ${key}:`, storageError);
  }
}

export function readFloatingWindowPosition(windowId: string): PersistedWindowPosition | null {
  const value = readJsonValue(`${FLOATING_WINDOW_POSITION_KEY_PREFIX}${windowId}`);
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Partial<PersistedWindowPosition>;
  if (!isFiniteNumber(candidate.x) || !isFiniteNumber(candidate.y)) {
    return null;
  }

  return {
    x: candidate.x,
    y: candidate.y,
  };
}

export function saveFloatingWindowPosition(windowId: string, position: PersistedWindowPosition): void {
  writeJsonValue(`${FLOATING_WINDOW_POSITION_KEY_PREFIX}${windowId}`, position);
}

export function readGraphViewportTransform(graphId: string): PersistedViewportTransform | null {
  const value = readJsonValue(`${GRAPH_VIEWPORT_TRANSFORM_KEY_PREFIX}${graphId}`);
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Partial<PersistedViewportTransform>;
  if (
    !isFiniteNumber(candidate.x) ||
    !isFiniteNumber(candidate.y) ||
    !isFiniteNumber(candidate.scale)
  ) {
    return null;
  }

  return {
    x: candidate.x,
    y: candidate.y,
    scale: candidate.scale,
  };
}

export function saveGraphViewportTransform(
  graphId: string,
  transform: PersistedViewportTransform
): void {
  writeJsonValue(`${GRAPH_VIEWPORT_TRANSFORM_KEY_PREFIX}${graphId}`, transform);
}

export function clearGraphViewportTransform(graphId: string): void {
  try {
    localStorage.removeItem(`${GRAPH_VIEWPORT_TRANSFORM_KEY_PREFIX}${graphId}`);
  } catch (storageError) {
    console.warn(`Could not clear persisted viewport state for ${graphId}:`, storageError);
  }
}
