import test from 'node:test';
import assert from 'node:assert/strict';
import axios from 'axios';
import { useGraphStore } from '../src/store/graphStore.ts';
import { Graph } from '../src/types.ts';

class MemoryLocalStorage {
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

const makeGraph = (id: string): Graph => ({
  id,
  name: `Graph ${id}`,
  nodes: [],
  connections: [],
  createdAt: Date.now(),
  updatedAt: Date.now(),
});

test('initializeGraph recovers from stale saved graph id by loading latest graph', async () => {
  const localStorage = new MemoryLocalStorage();
  localStorage.setItem('k8v-current-graph-id', 'stale-id');
  (globalThis as any).localStorage = localStorage;

  const originalGet = axios.get;
  const originalPost = axios.post;

  (axios as any).get = async (url: string) => {
    if (url === '/api/graphs/stale-id') {
      const error: any = new Error('Graph not found');
      error.response = { status: 404 };
      throw error;
    }

    if (url === '/api/graphs/latest') {
      return { data: makeGraph('latest-id') };
    }

    throw new Error(`Unexpected GET: ${url}`);
  };

  (axios as any).post = async (_url: string, _body: unknown) => {
    throw new Error('createGraph should not be called in this test');
  };

  useGraphStore.setState({
    graph: null,
    selectedNodeId: null,
    isLoading: false,
    error: null,
  });

  try {
    await useGraphStore.getState().initializeGraph();

    const state = useGraphStore.getState();
    assert.ok(state.graph, 'expected a graph to be loaded');
    assert.equal(state.graph?.id, 'latest-id');
    assert.equal(localStorage.getItem('k8v-current-graph-id'), 'latest-id');
  } finally {
    (axios as any).get = originalGet;
    (axios as any).post = originalPost;
  }
});
