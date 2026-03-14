import type {
  GraphCamera,
  GraphCameraWindowPosition,
  GraphCameraViewport,
} from '../types';

export const DEFAULT_GRAPH_CAMERA_ID = 'default-camera';
export const DEFAULT_GRAPH_CAMERA_NAME = 'Default Camera';
export const FLOATING_WINDOW_VIEWPORT_PADDING_PX = 8;

export interface FloatingWindowPosition {
  x: number;
  y: number;
}

export interface FloatingWindowSize {
  width: number;
  height: number;
}

export interface ViewportDimensions {
  width: number;
  height: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function normalizeCameraViewport(viewport: GraphCameraViewport | undefined): GraphCameraViewport | undefined {
  if (
    !viewport ||
    !isFiniteNumber(viewport.x) ||
    !isFiniteNumber(viewport.y) ||
    !isFiniteNumber(viewport.scale) ||
    viewport.scale <= 0
  ) {
    return undefined;
  }

  return {
    x: viewport.x,
    y: viewport.y,
    scale: viewport.scale,
  };
}

function normalizeCameraWindowPosition(
  windowPosition: GraphCameraWindowPosition | undefined
): GraphCameraWindowPosition | null {
  if (!windowPosition) {
    return null;
  }

  const horizontalEdge = windowPosition.horizontal?.edge;
  const verticalEdge = windowPosition.vertical?.edge;
  const horizontalRatio = windowPosition.horizontal?.ratio;
  const verticalRatio = windowPosition.vertical?.ratio;

  if (
    (horizontalEdge !== 'left' && horizontalEdge !== 'right') ||
    (verticalEdge !== 'top' && verticalEdge !== 'bottom') ||
    !isFiniteNumber(horizontalRatio) ||
    !isFiniteNumber(verticalRatio)
  ) {
    return null;
  }

  return {
    horizontal: {
      edge: horizontalEdge,
      ratio: clamp(horizontalRatio, 0, 1),
    },
    vertical: {
      edge: verticalEdge,
      ratio: clamp(verticalRatio, 0, 1),
    },
  };
}

export function normalizeGraphCameraState(
  cameras: GraphCamera[] | undefined
): GraphCamera[] {
  const deduped: GraphCamera[] = [];
  const seenIds = new Set<string>();

  for (const camera of cameras ?? []) {
    const cameraId = camera.id.trim();
    if (!cameraId || seenIds.has(cameraId)) {
      continue;
    }
    seenIds.add(cameraId);

    const floatingWindows: Record<string, GraphCameraWindowPosition> = {};
    for (const [windowId, windowPosition] of Object.entries(camera.floatingWindows ?? {})) {
      const normalizedWindowId = windowId.trim();
      if (!normalizedWindowId) {
        continue;
      }
      const normalizedWindowPosition = normalizeCameraWindowPosition(windowPosition);
      if (!normalizedWindowPosition) {
        continue;
      }
      floatingWindows[normalizedWindowId] = normalizedWindowPosition;
    }

    deduped.push({
      id: cameraId,
      name: camera.name.trim() || cameraId,
      viewport: normalizeCameraViewport(camera.viewport),
      floatingWindows,
    });
  }

  if (!seenIds.has(DEFAULT_GRAPH_CAMERA_ID)) {
    deduped.unshift({
      id: DEFAULT_GRAPH_CAMERA_ID,
      name: DEFAULT_GRAPH_CAMERA_NAME,
      floatingWindows: {},
    });
  }

  return deduped;
}

export function resolveSelectedGraphCameraId(
  cameras: GraphCamera[] | undefined,
  selectedCameraId: string | null | undefined
): string {
  const normalizedCameras = normalizeGraphCameraState(cameras);
  if (selectedCameraId && normalizedCameras.some((camera) => camera.id === selectedCameraId)) {
    return selectedCameraId;
  }
  return normalizedCameras[0]?.id ?? DEFAULT_GRAPH_CAMERA_ID;
}

export function resolveGraphCamera(
  cameras: GraphCamera[] | undefined,
  selectedCameraId: string | null | undefined
): GraphCamera {
  const normalizedCameras = normalizeGraphCameraState(cameras);
  const resolvedId = resolveSelectedGraphCameraId(normalizedCameras, selectedCameraId);
  return normalizedCameras.find((camera) => camera.id === resolvedId) ?? {
    id: DEFAULT_GRAPH_CAMERA_ID,
    name: DEFAULT_GRAPH_CAMERA_NAME,
    floatingWindows: {},
  };
}

export function getNextCameraName(existingNames: string[]): string {
  const existing = new Set(existingNames);
  let index = 1;
  let candidate = `Camera ${index}`;
  while (existing.has(candidate)) {
    index += 1;
    candidate = `Camera ${index}`;
  }
  return candidate;
}

export function updateGraphCamera(
  cameras: GraphCamera[] | undefined,
  cameraId: string,
  updater: (camera: GraphCamera) => GraphCamera
): GraphCamera[] {
  return normalizeGraphCameraState(cameras).map((camera) => (
    camera.id === cameraId ? updater(camera) : camera
  ));
}

export function removeGraphCamera(
  cameras: GraphCamera[] | undefined,
  cameraId: string
): GraphCamera[] {
  return normalizeGraphCameraState(cameras).filter((camera) => camera.id !== cameraId);
}

export function clampFloatingWindowPositionToViewport(
  position: FloatingWindowPosition,
  size: FloatingWindowSize,
  viewport: ViewportDimensions
): FloatingWindowPosition {
  const minX = FLOATING_WINDOW_VIEWPORT_PADDING_PX;
  const minY = FLOATING_WINDOW_VIEWPORT_PADDING_PX;
  const maxX = Math.max(
    minX,
    viewport.width - size.width - FLOATING_WINDOW_VIEWPORT_PADDING_PX
  );
  const maxY = Math.max(
    minY,
    viewport.height - size.height - FLOATING_WINDOW_VIEWPORT_PADDING_PX
  );

  return {
    x: clamp(position.x, minX, maxX),
    y: clamp(position.y, minY, maxY),
  };
}

export function resolveFloatingWindowCameraLayout(
  position: FloatingWindowPosition,
  size: FloatingWindowSize,
  viewport: ViewportDimensions
): GraphCameraWindowPosition {
  const clampedPosition = clampFloatingWindowPositionToViewport(position, size, viewport);
  const minX = FLOATING_WINDOW_VIEWPORT_PADDING_PX;
  const minY = FLOATING_WINDOW_VIEWPORT_PADDING_PX;
  const maxX = Math.max(
    minX,
    viewport.width - size.width - FLOATING_WINDOW_VIEWPORT_PADDING_PX
  );
  const maxY = Math.max(
    minY,
    viewport.height - size.height - FLOATING_WINDOW_VIEWPORT_PADDING_PX
  );
  const availableHorizontalPadding = Math.max(maxX - minX, 0);
  const availableVerticalPadding = Math.max(maxY - minY, 0);
  const leftPadding = Math.max(clampedPosition.x - minX, 0);
  const rightPadding = Math.max(maxX - clampedPosition.x, 0);
  const topPadding = Math.max(clampedPosition.y - minY, 0);
  const bottomPadding = Math.max(maxY - clampedPosition.y, 0);
  const horizontalEdge = rightPadding < leftPadding ? 'right' : 'left';
  const verticalEdge = bottomPadding < topPadding ? 'bottom' : 'top';

  return {
    horizontal: {
      edge: horizontalEdge,
      ratio:
        availableHorizontalPadding > 0
          ? (horizontalEdge === 'left' ? leftPadding : rightPadding) / availableHorizontalPadding
          : 0,
    },
    vertical: {
      edge: verticalEdge,
      ratio:
        availableVerticalPadding > 0
          ? (verticalEdge === 'top' ? topPadding : bottomPadding) / availableVerticalPadding
          : 0,
    },
  };
}

export function resolveFloatingWindowPositionFromCamera(
  windowPosition: GraphCameraWindowPosition | undefined,
  size: FloatingWindowSize,
  viewport: ViewportDimensions,
  fallbackPosition: FloatingWindowPosition
): FloatingWindowPosition {
  if (!windowPosition) {
    return clampFloatingWindowPositionToViewport(fallbackPosition, size, viewport);
  }

  const minX = FLOATING_WINDOW_VIEWPORT_PADDING_PX;
  const minY = FLOATING_WINDOW_VIEWPORT_PADDING_PX;
  const maxX = Math.max(
    minX,
    viewport.width - size.width - FLOATING_WINDOW_VIEWPORT_PADDING_PX
  );
  const maxY = Math.max(
    minY,
    viewport.height - size.height - FLOATING_WINDOW_VIEWPORT_PADDING_PX
  );
  const availableHorizontalPadding = Math.max(maxX - minX, 0);
  const availableVerticalPadding = Math.max(maxY - minY, 0);
  const clampedHorizontalRatio = clamp(windowPosition.horizontal.ratio, 0, 1);
  const clampedVerticalRatio = clamp(windowPosition.vertical.ratio, 0, 1);

  const x = windowPosition.horizontal.edge === 'right'
    ? maxX - (clampedHorizontalRatio * availableHorizontalPadding)
    : minX + (clampedHorizontalRatio * availableHorizontalPadding);
  const y = windowPosition.vertical.edge === 'bottom'
    ? maxY - (clampedVerticalRatio * availableVerticalPadding)
    : minY + (clampedVerticalRatio * availableVerticalPadding);

  return clampFloatingWindowPositionToViewport({ x, y }, size, viewport);
}
