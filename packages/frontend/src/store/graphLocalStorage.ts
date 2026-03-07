const CURRENT_GRAPH_ID_KEY = 'k8v-current-graph-id';

export function readCurrentGraphId(): string | null {
  try {
    return localStorage.getItem(CURRENT_GRAPH_ID_KEY);
  } catch (storageError) {
    console.warn('localStorage not available, skipping saved graph ID:', storageError);
    return null;
  }
}

export function saveCurrentGraphId(graphId: string): void {
  try {
    localStorage.setItem(CURRENT_GRAPH_ID_KEY, graphId);
  } catch (storageError) {
    console.warn('Could not save to localStorage:', storageError);
  }
}

export function clearCurrentGraphId(): void {
  try {
    localStorage.removeItem(CURRENT_GRAPH_ID_KEY);
  } catch {
    // Ignore localStorage errors.
  }
}

export function clearCurrentGraphIdIfMatches(graphId: string): void {
  try {
    if (localStorage.getItem(CURRENT_GRAPH_ID_KEY) === graphId) {
      localStorage.removeItem(CURRENT_GRAPH_ID_KEY);
    }
  } catch (storageError) {
    console.warn('Could not update localStorage after graph deletion:', storageError);
  }
}
