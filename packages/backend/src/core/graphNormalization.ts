import {
  materializeGraphProjectionState,
  normalizeGraphCameraState,
  syncActiveProjectionLayout,
  type GraphConnectionStroke,
} from '../types/index.js';
import {
  normalizeGraphConnectionStroke as normalizeSharedGraphConnectionStroke,
} from '../../../shared/src/connectionStroke.js';

export const normalizeGraphCameras = normalizeGraphCameraState;
export const normalizeGraphProjections = materializeGraphProjectionState;

export function normalizeConnectionStrokeValue(
  stroke: GraphConnectionStroke | undefined
): GraphConnectionStroke {
  return normalizeSharedGraphConnectionStroke(stroke);
}

export { syncActiveProjectionLayout };
