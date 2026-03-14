import { useGraphStore } from '../src/store/graphStore.ts';
import type { Graph } from '../src/types.ts';

export class MemoryLocalStorage {
  private values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.has(key) ? this.values.get(key)! : null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

export const makeGraph = (id: string): Graph => ({
  id,
  name: `Graph ${id}`,
  nodes: [],
  connections: [],
  createdAt: Date.now(),
  updatedAt: Date.now(),
});

export function resetGraphStoreState(overrides: Partial<ReturnType<typeof useGraphStore.getState>> = {}): void {
  if (!(globalThis as any).sessionStorage) {
    (globalThis as any).sessionStorage = new MemoryLocalStorage();
  }

  useGraphStore.setState({
    graph: null,
    graphSummaries: [],
    selectedCameraId: null,
    selectedNodeId: null,
    selectedNodeIds: [],
    selectedDrawingId: null,
    isLoading: false,
    error: null,
    resultRefreshKey: 0,
    nodeExecutionStates: {},
    nodeGraphicsOutputs: {},
    selectedNodeGraphicsDebug: null,
    drawingEnabled: false,
    drawingColor: '#ffffff',
    drawingThickness: 3,
    drawingCreateRequestId: 0,
    ...overrides,
  } as ReturnType<typeof useGraphStore.getState>);
}
