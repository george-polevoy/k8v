interface WheelNavigationLikeEvent {
  ctrlKey: boolean;
  deltaMode: number;
  deltaX: number;
  deltaY: number;
}

interface ModifierWheelLikeEvent {
  shiftKey: boolean;
  altKey: boolean;
  deltaX: number;
  deltaY: number;
}

interface WheelScrollDelta {
  x: number;
  y: number;
}

const DELTA_MODE_PIXEL = 0;
const TRACKPAD_FINE_DELTA_THRESHOLD = 4;
const TRACKPAD_INTEGER_DELTA_THRESHOLD = 1;

export function resolveModifierWheelScrollDelta(event: ModifierWheelLikeEvent): WheelScrollDelta | null {
  if (event.shiftKey) {
    return {
      x: -event.deltaX - event.deltaY,
      y: 0,
    };
  }

  if (event.altKey) {
    return {
      x: 0,
      y: -event.deltaY,
    };
  }

  return null;
}

export function shouldWheelPanCanvas(event: WheelNavigationLikeEvent): boolean {
  // Browser pinch gestures surface as ctrl+wheel events; keep those for zoom.
  if (event.ctrlKey) {
    return false;
  }

  if (event.deltaMode !== DELTA_MODE_PIXEL) {
    return false;
  }

  const absDeltaX = Math.abs(event.deltaX);
  const absDeltaY = Math.abs(event.deltaY);
  if (absDeltaX === 0 && absDeltaY === 0) {
    return false;
  }

  // Horizontal wheel deltas strongly indicate trackpad-style panning intent.
  if (absDeltaX > 0) {
    return true;
  }

  const hasFractionalDelta = !Number.isInteger(event.deltaX) || !Number.isInteger(event.deltaY);
  if (hasFractionalDelta) {
    return absDeltaY > 0 && absDeltaY <= TRACKPAD_FINE_DELTA_THRESHOLD;
  }

  return absDeltaY > 0 && absDeltaY <= TRACKPAD_INTEGER_DELTA_THRESHOLD;
}
