import {
  DEFAULT_GRAPH_CAMERA_ID,
  DEFAULT_GRAPH_CAMERA_NAME,
  type GraphCamera,
  type GraphCameraViewport,
  type GraphCameraWindowPosition,
} from './index.js';

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function normalizeGraphCameraViewport(
  viewport: GraphCameraViewport | undefined
): GraphCameraViewport | undefined {
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

function normalizeGraphCameraWindowPosition(
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
      const normalizedWindowPosition = normalizeGraphCameraWindowPosition(windowPosition);
      if (!normalizedWindowPosition) {
        continue;
      }
      floatingWindows[normalizedWindowId] = normalizedWindowPosition;
    }

    deduped.push({
      id: cameraId,
      name: camera.name.trim() || cameraId,
      viewport: normalizeGraphCameraViewport(camera.viewport),
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
