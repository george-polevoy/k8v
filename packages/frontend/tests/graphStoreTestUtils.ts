import { useGraphStore } from '../src/store/graphStore.ts';
import type { Graph } from '../src/types.ts';
import { normalizeGraph } from '../src/store/graphStoreState.ts';

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
  revision: 0,
  nodes: [],
  connections: [],
  createdAt: Date.now(),
  updatedAt: Date.now(),
});

export function resetGraphStoreState(overrides: Partial<ReturnType<typeof useGraphStore.getState>> = {}): void {
  if (!(globalThis as any).sessionStorage) {
    (globalThis as any).sessionStorage = new MemoryLocalStorage();
  }

  const normalizedGraph = overrides.graph ? normalizeGraph(overrides.graph as Graph) : null;
  const normalizedGraphSummaries = (overrides.graphSummaries ?? []).map((summary) => ({
    revision: 0,
    ...summary,
  }));

  useGraphStore.setState({
    graph: normalizedGraph,
    graphSummaries: normalizedGraphSummaries,
    selectedCameraId: null,
    selectedNodeId: null,
    selectedNodeIds: [],
    selectedDrawingId: null,
    isLoading: false,
    error: null,
    nodeExecutionStates: {},
    nodeGraphicsOutputs: {},
    nodeResults: {},
    selectedNodeGraphicsDebug: null,
    drawingEnabled: false,
    drawingColor: '#ffffff',
    drawingThickness: 3,
    drawingCreateRequestId: 0,
    ...overrides,
    graph: normalizedGraph,
    graphSummaries: normalizedGraphSummaries,
  } as ReturnType<typeof useGraphStore.getState>);
}
