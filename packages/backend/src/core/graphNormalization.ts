import {
  DEFAULT_GRAPH_CAMERA_ID,
  DEFAULT_GRAPH_CAMERA_NAME,
  applyProjectionToNodes,
  normalizeGraphProjectionState,
  syncActiveProjectionLayout,
  type CanvasBackground,
  type GraphCamera,
  type GraphCameraWindowPosition,
  type GraphConnectionStroke,
  type GraphNode,
  type GraphProjection,
} from '../types/index.js';
import {
  normalizeCanvasBackground as normalizeSharedCanvasBackground,
} from '../../../shared/src/canvasBackground.js';
import {
  normalizeGraphConnectionStroke as normalizeSharedGraphConnectionStroke,
} from '../../../shared/src/connectionStroke.js';

export function normalizeCanvasBackgroundValue(
  background: CanvasBackground | undefined
): CanvasBackground {
  return normalizeSharedCanvasBackground(background);
}

function normalizeCameraWindowPositionValue(
  value: GraphCameraWindowPosition | undefined
): GraphCameraWindowPosition | null {
  if (!value) {
    return null;
  }

  const horizontalEdge = value.horizontal?.edge === 'right' ? 'right' : value.horizontal?.edge === 'left'
    ? 'left'
    : null;
  const verticalEdge = value.vertical?.edge === 'bottom' ? 'bottom' : value.vertical?.edge === 'top'
    ? 'top'
    : null;
  const horizontalRatio = value.horizontal?.ratio;
  const verticalRatio = value.vertical?.ratio;

  if (
    !horizontalEdge ||
    !verticalEdge ||
    typeof horizontalRatio !== 'number' ||
    !Number.isFinite(horizontalRatio) ||
    typeof verticalRatio !== 'number' ||
    !Number.isFinite(verticalRatio)
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

export function normalizeGraphCameras(
  cameras: GraphCamera[] | undefined
): GraphCamera[] {
  const deduped: GraphCamera[] = [];
  const seenCameraIds = new Set<string>();

  for (const camera of cameras ?? []) {
    const cameraId = camera.id.trim();
    if (!cameraId || seenCameraIds.has(cameraId)) {
      continue;
    }
    seenCameraIds.add(cameraId);

    const normalizedFloatingWindows: Record<string, GraphCameraWindowPosition> = {};
    for (const [windowId, windowPosition] of Object.entries(camera.floatingWindows ?? {})) {
      const normalizedWindowId = windowId.trim();
      if (!normalizedWindowId) {
        continue;
      }
      const normalizedWindowPosition = normalizeCameraWindowPositionValue(windowPosition);
      if (!normalizedWindowPosition) {
        continue;
      }
      normalizedFloatingWindows[normalizedWindowId] = normalizedWindowPosition;
    }

    deduped.push({
      id: cameraId,
      name: camera.name.trim() || cameraId,
      viewport:
        typeof camera.viewport?.x === 'number' &&
        Number.isFinite(camera.viewport.x) &&
        typeof camera.viewport?.y === 'number' &&
        Number.isFinite(camera.viewport.y) &&
        typeof camera.viewport?.scale === 'number' &&
        Number.isFinite(camera.viewport.scale) &&
        camera.viewport.scale > 0
          ? {
              x: camera.viewport.x,
              y: camera.viewport.y,
              scale: camera.viewport.scale,
            }
          : undefined,
      floatingWindows: normalizedFloatingWindows,
    });
  }

  if (!seenCameraIds.has(DEFAULT_GRAPH_CAMERA_ID)) {
    deduped.unshift({
      id: DEFAULT_GRAPH_CAMERA_ID,
      name: DEFAULT_GRAPH_CAMERA_NAME,
      floatingWindows: {},
    });
  }

  return deduped;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function normalizeConnectionStrokeValue(
  stroke: GraphConnectionStroke | undefined
): GraphConnectionStroke {
  return normalizeSharedGraphConnectionStroke(stroke);
}

export { syncActiveProjectionLayout };

export function normalizeGraphProjections(
  nodes: GraphNode[],
  projections: GraphProjection[] | undefined,
  activeProjectionId: string | undefined,
  fallbackCanvasBackground: CanvasBackground | undefined,
  activeCanvasBackgroundOverride?: CanvasBackground | undefined
): {
  projections: GraphProjection[];
  activeProjectionId: string;
  nodes: GraphNode[];
  canvasBackground: CanvasBackground;
} {
  const projectionState = normalizeGraphProjectionState(
    nodes,
    projections,
    activeProjectionId,
    fallbackCanvasBackground
  );

  const normalizedProjections = activeCanvasBackgroundOverride
    ? projectionState.projections.map((projection) => (
        projection.id === projectionState.activeProjectionId
          ? {
              ...projection,
              canvasBackground: normalizeCanvasBackgroundValue(activeCanvasBackgroundOverride),
            }
          : projection
      ))
    : projectionState.projections;
  const activeProjection = normalizedProjections.find(
    (projection) => projection.id === projectionState.activeProjectionId
  ) ?? normalizedProjections[0];

  return {
    projections: normalizedProjections,
    activeProjectionId: projectionState.activeProjectionId,
    nodes: activeProjection ? applyProjectionToNodes(nodes, activeProjection) : nodes,
    canvasBackground: normalizeCanvasBackgroundValue(
      activeProjection?.canvasBackground ?? fallbackCanvasBackground
    ),
  };
}
