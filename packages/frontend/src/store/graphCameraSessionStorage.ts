const CURRENT_CAMERA_ID_KEY_PREFIX = 'k8v-current-camera-id:';

function getCameraSelectionKey(graphId: string): string {
  return `${CURRENT_CAMERA_ID_KEY_PREFIX}${graphId}`;
}

export function readCurrentCameraId(graphId: string): string | null {
  try {
    return sessionStorage.getItem(getCameraSelectionKey(graphId));
  } catch (storageError) {
    console.warn('sessionStorage not available, skipping saved camera ID:', storageError);
    return null;
  }
}

export function saveCurrentCameraId(graphId: string, cameraId: string): void {
  try {
    sessionStorage.setItem(getCameraSelectionKey(graphId), cameraId);
  } catch (storageError) {
    console.warn('Could not save camera selection to sessionStorage:', storageError);
  }
}

export function clearCurrentCameraId(graphId: string): void {
  try {
    sessionStorage.removeItem(getCameraSelectionKey(graphId));
  } catch (storageError) {
    console.warn('Could not clear camera selection from sessionStorage:', storageError);
  }
}
