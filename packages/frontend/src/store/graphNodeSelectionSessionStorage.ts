const CURRENT_NODE_SELECTION_KEY_PREFIX = 'k8v-current-node-selection:';

function getNodeSelectionKey(graphId: string): string {
  return `${CURRENT_NODE_SELECTION_KEY_PREFIX}${graphId}`;
}

export function readCurrentNodeSelection(graphId: string): string | null {
  try {
    return sessionStorage.getItem(getNodeSelectionKey(graphId));
  } catch (storageError) {
    console.warn('sessionStorage not available, skipping saved node selection:', storageError);
    return null;
  }
}

export function saveCurrentNodeSelection(graphId: string, nodeId: string): void {
  try {
    sessionStorage.setItem(getNodeSelectionKey(graphId), nodeId);
  } catch (storageError) {
    console.warn('Could not save node selection to sessionStorage:', storageError);
  }
}

export function clearCurrentNodeSelection(graphId: string): void {
  try {
    sessionStorage.removeItem(getNodeSelectionKey(graphId));
  } catch (storageError) {
    console.warn('Could not clear node selection from sessionStorage:', storageError);
  }
}
