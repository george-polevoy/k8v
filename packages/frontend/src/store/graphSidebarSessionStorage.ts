const GRAPH_SIDEBAR_STATE_KEY_PREFIX = 'k8v-sidebar-state:';

export interface GraphSidebarSessionState {
  activeSection: string;
  isExpanded: boolean;
}

function getSidebarStateKey(graphId: string): string {
  return `${GRAPH_SIDEBAR_STATE_KEY_PREFIX}${graphId}`;
}

export function readGraphSidebarState(graphId: string): GraphSidebarSessionState | null {
  try {
    const rawValue = sessionStorage.getItem(getSidebarStateKey(graphId));
    if (!rawValue) {
      return null;
    }

    const parsed = JSON.parse(rawValue) as Partial<GraphSidebarSessionState> | null;
    if (
      !parsed ||
      typeof parsed.activeSection !== 'string' ||
      typeof parsed.isExpanded !== 'boolean'
    ) {
      return null;
    }

    return {
      activeSection: parsed.activeSection,
      isExpanded: parsed.isExpanded,
    };
  } catch (storageError) {
    console.warn('sessionStorage not available, skipping saved sidebar state:', storageError);
    return null;
  }
}

export function saveGraphSidebarState(
  graphId: string,
  state: GraphSidebarSessionState
): void {
  try {
    sessionStorage.setItem(getSidebarStateKey(graphId), JSON.stringify(state));
  } catch (storageError) {
    console.warn('Could not save sidebar state to sessionStorage:', storageError);
  }
}

export function clearGraphSidebarState(graphId: string): void {
  try {
    sessionStorage.removeItem(getSidebarStateKey(graphId));
  } catch (storageError) {
    console.warn('Could not clear sidebar state from sessionStorage:', storageError);
  }
}
