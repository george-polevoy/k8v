import type { GraphCameraWindowPosition } from '../types';
export {
  DEFAULT_GRAPH_CAMERA_ID,
  DEFAULT_GRAPH_CAMERA_NAME,
  getNextCameraName,
  normalizeGraphCameraState,
  removeGraphCamera,
  resolveGraphCamera,
  resolveSelectedGraphCameraId,
  updateGraphCamera,
} from '../types';

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
