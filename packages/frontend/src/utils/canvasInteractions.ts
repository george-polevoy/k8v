import { clamp, snapToPixel } from './canvasHelpers';

export interface Position2D {
  x: number;
  y: number;
}

export interface DragPositionInput {
  originX: number;
  originY: number;
  pointerX: number;
  pointerY: number;
  startPointerX: number;
  startPointerY: number;
  scale: number;
}

export interface PanPositionInput {
  viewportX: number;
  viewportY: number;
  pointerX: number;
  pointerY: number;
  startPointerX: number;
  startPointerY: number;
}

export interface NodeResizeComputationInput {
  x: number;
  y: number;
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
  handle: string;
  pointerX: number;
  pointerY: number;
  startPointerX: number;
  startPointerY: number;
  scale: number;
}

export interface NodeResizeDraft {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Rect2D {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SelectionResizeComputationInput {
  bounds: Rect2D;
  handle: string;
  pointerX: number;
  pointerY: number;
  startPointerX: number;
  startPointerY: number;
  scale: number;
  minWidth: number;
  minHeight: number;
}

export interface WheelInteractionPlanInput {
  currentX: number;
  currentY: number;
  currentScale: number;
  deltaX: number;
  deltaY: number;
  modifierScrollDelta: Position2D | null;
  shouldPan: boolean;
  pointerX: number;
  pointerY: number;
  worldBeforeX: number;
  worldBeforeY: number;
  zoomSensitivity: number;
  minZoom: number;
  maxZoom: number;
}

export type WheelInteractionPlan =
  | {
    kind: 'pan';
    x: number;
    y: number;
  }
  | {
    kind: 'zoom';
    x: number;
    y: number;
    scale: number;
  };

export function hasExceededDragThreshold(deltaX: number, deltaY: number, threshold: number): boolean {
  return Math.hypot(deltaX, deltaY) >= threshold;
}

export function computeSnappedDragPosition(input: DragPositionInput): Position2D {
  const scale = input.scale || 1;
  return {
    x: snapToPixel(input.originX + (input.pointerX - input.startPointerX) / scale),
    y: snapToPixel(input.originY + (input.pointerY - input.startPointerY) / scale),
  };
}

export function computeSnappedPanPosition(input: PanPositionInput): Position2D {
  return {
    x: input.viewportX + (input.pointerX - input.startPointerX),
    y: input.viewportY + (input.pointerY - input.startPointerY),
  };
}

export function computeNodeResizeDraft(input: NodeResizeComputationInput): NodeResizeDraft {
  const scale = input.scale || 1;
  const deltaX = (input.pointerX - input.startPointerX) / scale;
  const deltaY = (input.pointerY - input.startPointerY) / scale;
  const resizeFromWest = input.handle.includes('w');
  const resizeFromEast = input.handle.includes('e');
  const resizeFromNorth = input.handle.includes('n');
  const resizeFromSouth = input.handle.includes('s');
  let nextLeft = input.x;
  let nextTop = input.y;
  let nextRight = input.x + input.width;
  let nextBottom = input.y + input.height;

  if (resizeFromEast) {
    nextRight = input.x + input.width + deltaX;
  }
  if (resizeFromWest) {
    nextLeft = input.x + deltaX;
  }
  if (resizeFromSouth) {
    nextBottom = input.y + input.height + deltaY;
  }
  if (resizeFromNorth) {
    nextTop = input.y + deltaY;
  }

  if ((nextRight - nextLeft) < input.minWidth) {
    if (resizeFromWest && !resizeFromEast) {
      nextLeft = nextRight - input.minWidth;
    } else {
      nextRight = nextLeft + input.minWidth;
    }
  }
  if ((nextBottom - nextTop) < input.minHeight) {
    if (resizeFromNorth && !resizeFromSouth) {
      nextTop = nextBottom - input.minHeight;
    } else {
      nextBottom = nextTop + input.minHeight;
    }
  }

  return {
    x: snapToPixel(nextLeft),
    y: snapToPixel(nextTop),
    width: Math.max(input.minWidth, snapToPixel(nextRight - nextLeft)),
    height: Math.max(input.minHeight, snapToPixel(nextBottom - nextTop)),
  };
}

export function computeRectFromPoints(
  startX: number,
  startY: number,
  endX: number,
  endY: number
): Rect2D {
  const minX = Math.min(startX, endX);
  const minY = Math.min(startY, endY);
  const maxX = Math.max(startX, endX);
  const maxY = Math.max(startY, endY);
  return {
    x: snapToPixel(minX),
    y: snapToPixel(minY),
    width: snapToPixel(maxX - minX),
    height: snapToPixel(maxY - minY),
  };
}

export function rectIntersectsRect(left: Rect2D, right: Rect2D): boolean {
  return (
    left.x <= (right.x + right.width) &&
    (left.x + left.width) >= right.x &&
    left.y <= (right.y + right.height) &&
    (left.y + left.height) >= right.y
  );
}

export function computeSelectionResizeDraft(input: SelectionResizeComputationInput): Rect2D {
  const scale = input.scale || 1;
  const deltaX = (input.pointerX - input.startPointerX) / scale;
  const deltaY = (input.pointerY - input.startPointerY) / scale;
  const resizeFromWest = input.handle.includes('w');
  const resizeFromEast = input.handle.includes('e');
  const resizeFromNorth = input.handle.includes('n');
  const resizeFromSouth = input.handle.includes('s');
  let nextLeft = input.bounds.x;
  let nextTop = input.bounds.y;
  let nextRight = input.bounds.x + input.bounds.width;
  let nextBottom = input.bounds.y + input.bounds.height;

  if (resizeFromEast) {
    nextRight = input.bounds.x + input.bounds.width + deltaX;
  }
  if (resizeFromWest) {
    nextLeft = input.bounds.x + deltaX;
  }
  if (resizeFromSouth) {
    nextBottom = input.bounds.y + input.bounds.height + deltaY;
  }
  if (resizeFromNorth) {
    nextTop = input.bounds.y + deltaY;
  }

  if ((nextRight - nextLeft) < input.minWidth) {
    if (resizeFromWest && !resizeFromEast) {
      nextLeft = nextRight - input.minWidth;
    } else {
      nextRight = nextLeft + input.minWidth;
    }
  }
  if ((nextBottom - nextTop) < input.minHeight) {
    if (resizeFromNorth && !resizeFromSouth) {
      nextTop = nextBottom - input.minHeight;
    } else {
      nextBottom = nextTop + input.minHeight;
    }
  }

  return {
    x: snapToPixel(nextLeft),
    y: snapToPixel(nextTop),
    width: Math.max(input.minWidth, snapToPixel(nextRight - nextLeft)),
    height: Math.max(input.minHeight, snapToPixel(nextBottom - nextTop)),
  };
}

export function resolveWheelInteractionPlan(input: WheelInteractionPlanInput): WheelInteractionPlan {
  if (input.modifierScrollDelta) {
    return {
      kind: 'pan',
      x: input.currentX + input.modifierScrollDelta.x,
      y: input.currentY + input.modifierScrollDelta.y,
    };
  }

  if (input.shouldPan) {
    return {
      kind: 'pan',
      x: input.currentX - input.deltaX,
      y: input.currentY - input.deltaY,
    };
  }

  const scaleFactor = Math.exp(-input.deltaY * input.zoomSensitivity);
  const nextScale = clamp(input.currentScale * scaleFactor, input.minZoom, input.maxZoom);
  return {
    kind: 'zoom',
    scale: nextScale,
    x: input.pointerX - input.worldBeforeX * nextScale,
    y: input.pointerY - input.worldBeforeY * nextScale,
  };
}

export function isCanvasDeletionShortcutBlocked(
  activeElement: HTMLElement | null,
  canvasElement: HTMLElement
): boolean {
  if (!activeElement || activeElement === canvasElement) {
    return false;
  }

  const tagName = activeElement.tagName.toLowerCase();
  return tagName === 'input' || tagName === 'textarea' || activeElement.isContentEditable;
}
