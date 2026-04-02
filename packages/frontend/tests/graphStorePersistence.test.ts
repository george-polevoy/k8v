import test from 'node:test';
import assert from 'node:assert/strict';
import axios from 'axios';
import { setTimeout as delay } from 'node:timers/promises';
import { useGraphStore } from '../src/store/graphStore.ts';
import type { Graph } from '../src/types.ts';
import {
  MemoryLocalStorage,
  makeGraph,
  resetGraphStoreState,
} from './graphStoreTestUtils.ts';

test.beforeEach(() => {
  (globalThis as any).localStorage = new MemoryLocalStorage();
  resetGraphStoreState();
});

function buildRuntimeState(graph: Graph) {
  return {
    graphId: graph.id,
    revision: graph.revision,
    statusVersion: 0,
    queueLength: 0,
    workerConcurrency: graph.recomputeConcurrency ?? 1,
    nodeStates: {},
    results: {},
  };
}

function buildCommandResponse(graph: Graph) {
  const persistedGraph: Graph = {
    ...graph,
    revision: graph.revision ?? 1,
  };

  return {
    data: {
      graph: persistedGraph,
      runtimeState: buildRuntimeState(persistedGraph),
    },
  };
}

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

  try {
    await useGraphStore.getState().initializeGraph();

    const state = useGraphStore.getState();
    assert.equal(state.graph?.id, 'latest-id');
    assert.equal(localStorage.getItem('k8v-current-graph-id'), 'latest-id');
  } finally {
    (axios as any).get = originalGet;
    (axios as any).post = originalPost;
  }
});

test('loadGraph normalizes missing graph execution timeout to 30 seconds', async () => {
  (globalThis as any).localStorage = new MemoryLocalStorage();

  const originalGet = axios.get;
  const graphWithoutTimeout = makeGraph('g-timeout-default');

  (axios as any).get = async (url: string) => {
    if (url === '/api/graphs/g-timeout-default') {
      return { data: graphWithoutTimeout };
    }
    throw new Error(`Unexpected GET: ${url}`);
  };

  try {
    await useGraphStore.getState().loadGraph('g-timeout-default');

    const state = useGraphStore.getState();
    assert.equal(state.graph?.id, 'g-timeout-default');
    assert.equal(state.graph?.executionTimeoutMs, 30_000);
  } finally {
    (axios as any).get = originalGet;
  }
});

test('loadGraph deduplicates multiple inbound connections for the same input slot', async () => {
  (globalThis as any).localStorage = new MemoryLocalStorage();

  const originalGet = axios.get;
  const graphWithDuplicateInbound: Graph = {
    id: 'g-single-inbound-load',
    name: 'Single Inbound Load Graph',
    nodes: [
      {
        id: 'source-a',
        type: 'numeric_input' as any,
        position: { x: 0, y: 0 },
        metadata: {
          name: 'Source A',
          inputs: [],
          outputs: [{ name: 'value', schema: { type: 'number' } }],
        },
        config: {
          value: 1,
          min: 0,
          max: 10,
          step: 1,
        },
        version: 'source-a-v1',
      },
      {
        id: 'source-b',
        type: 'numeric_input' as any,
        position: { x: 0, y: 120 },
        metadata: {
          name: 'Source B',
          inputs: [],
          outputs: [{ name: 'value', schema: { type: 'number' } }],
        },
        config: {
          value: 2,
          min: 0,
          max: 10,
          step: 1,
        },
        version: 'source-b-v1',
      },
      {
        id: 'target',
        type: 'inline_code' as any,
        position: { x: 240, y: 40 },
        metadata: {
          name: 'Target',
          inputs: [{ name: 'input', schema: { type: 'number' } }],
          outputs: [{ name: 'output', schema: { type: 'number' } }],
        },
        config: {
          code: 'outputs.output = inputs.input;',
          runtime: 'javascript_vm',
        },
        version: 'target-v1',
      },
    ],
    connections: [
      {
        id: 'conn-a',
        sourceNodeId: 'source-a',
        sourcePort: 'value',
        targetNodeId: 'target',
        targetPort: 'input',
      },
      {
        id: 'conn-b',
        sourceNodeId: 'source-b',
        sourcePort: 'value',
        targetNodeId: 'target',
        targetPort: 'input',
      },
    ],
    createdAt: 1,
    updatedAt: 1,
  };

  (axios as any).get = async (url: string) => {
    if (url === '/api/graphs/g-single-inbound-load') {
      return { data: graphWithDuplicateInbound };
    }
    throw new Error(`Unexpected GET: ${url}`);
  };

  try {
    await useGraphStore.getState().loadGraph('g-single-inbound-load');

    const state = useGraphStore.getState();
    assert.equal(state.graph?.connections.length, 1);
    assert.deepEqual(state.graph?.connections[0], {
      id: 'conn-b',
      sourceNodeId: 'source-b',
      sourcePort: 'value',
      targetNodeId: 'target',
      targetPort: 'input',
    });
  } finally {
    (axios as any).get = originalGet;
  }
});

test('runtime state polling backs off after repeated network failures', async () => {
  (globalThis as any).localStorage = new MemoryLocalStorage();

  const originalWindow = (globalThis as any).window;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const originalGet = axios.get;

  const scheduledTimeouts: Array<{ delay: number; callback: () => void }> = [];
  (globalThis as any).window = {};
  (globalThis as any).setTimeout = ((callback: () => void, timeout?: number) => {
    scheduledTimeouts.push({
      delay: typeof timeout === 'number' ? timeout : 0,
      callback,
    });
    return scheduledTimeouts.length;
  }) as typeof setTimeout;
  (globalThis as any).clearTimeout = (() => undefined) as typeof clearTimeout;

  const graph = makeGraph('g-poll-backoff');

  (axios as any).get = async (url: string) => {
    if (url === '/api/graphs/g-poll-backoff') {
      return { data: graph };
    }
    if (url === '/api/graphs/g-poll-backoff/runtime-state') {
      throw new Error('Backend unavailable');
    }
    throw new Error(`Unexpected GET: ${url}`);
  };

  try {
    await useGraphStore.getState().loadGraph('g-poll-backoff');

    await delay(0);
    assert.equal(scheduledTimeouts.length >= 1, true);
    assert.equal(scheduledTimeouts[0]?.delay, 400);

    scheduledTimeouts[0]?.callback();
    await delay(0);
    assert.equal(scheduledTimeouts.length >= 2, true);
    assert.equal(scheduledTimeouts[1]?.delay, 800);
  } finally {
    (axios as any).get = originalGet;
    (globalThis as any).window = originalWindow;
    (globalThis as any).setTimeout = originalSetTimeout;
    (globalThis as any).clearTimeout = originalClearTimeout;
  }
});

test('runtime state polling slows down when the backend reports an idle graph', async () => {
  (globalThis as any).localStorage = new MemoryLocalStorage();

  const originalWindow = (globalThis as any).window;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const originalGet = axios.get;

  const scheduledTimeouts: Array<{ delay: number; callback: () => void }> = [];
  (globalThis as any).window = {};
  (globalThis as any).setTimeout = ((callback: () => void, timeout?: number) => {
    scheduledTimeouts.push({
      delay: typeof timeout === 'number' ? timeout : 0,
      callback,
    });
    return scheduledTimeouts.length;
  }) as typeof setTimeout;
  (globalThis as any).clearTimeout = (() => undefined) as typeof clearTimeout;

  const graph = makeGraph('g-poll-idle');

  (axios as any).get = async (url: string) => {
    if (url === '/api/graphs/g-poll-idle') {
      return { data: graph };
    }
    if (url === '/api/graphs/g-poll-idle/runtime-state') {
      return {
        data: {
          ...buildRuntimeState(graph),
          statusVersion: 1,
        },
      };
    }
    throw new Error(`Unexpected GET: ${url}`);
  };

  try {
    await useGraphStore.getState().loadGraph('g-poll-idle');

    await delay(0);
    assert.equal(scheduledTimeouts.length >= 1, true);
    assert.equal(scheduledTimeouts[0]?.delay, 1_500);
  } finally {
    (axios as any).get = originalGet;
    (globalThis as any).window = originalWindow;
    (globalThis as any).setTimeout = originalSetTimeout;
    (globalThis as any).clearTimeout = originalClearTimeout;
  }
});

test('unchanged runtime state does not rewrite node execution state', async () => {
  (globalThis as any).localStorage = new MemoryLocalStorage();

  const originalWindow = (globalThis as any).window;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const originalGet = axios.get;

  const scheduledTimeouts: Array<{ delay: number; callback: () => void }> = [];
  (globalThis as any).window = {};
  (globalThis as any).setTimeout = ((callback: () => void, timeout?: number) => {
    scheduledTimeouts.push({
      delay: typeof timeout === 'number' ? timeout : 0,
      callback,
    });
    return scheduledTimeouts.length;
  }) as typeof setTimeout;
  (globalThis as any).clearTimeout = (() => undefined) as typeof clearTimeout;

  const graph: Graph = {
    ...makeGraph('g-poll-noop'),
    nodes: [
      {
        id: 'node-a',
        type: 'numeric_input' as any,
        position: { x: 0, y: 0 },
        metadata: {
          name: 'A',
          inputs: [],
          outputs: [{ name: 'value', schema: { type: 'number' } }],
        },
        config: {
          value: 1,
          min: 0,
          max: 10,
          step: 1,
        },
        version: 'node-a-v1',
      },
    ],
  };

  (axios as any).get = async (url: string) => {
    if (url === '/api/graphs/g-poll-noop') {
      return { data: graph };
    }
    if (url === '/api/graphs/g-poll-noop/runtime-state') {
      return {
        data: {
          ...buildRuntimeState(graph),
          statusVersion: 5,
          nodeStates: {
            'node-a': {
              isPending: false,
              isComputing: false,
              hasError: false,
              isStale: false,
              errorMessage: null,
              lastRunAt: 10,
            },
          },
          results: {
            'node-a': {
              nodeId: 'node-a',
              outputs: { value: 1 },
              schema: { value: { type: 'number' } },
              timestamp: 10,
              version: 'node-a-v1',
            },
          },
        },
      };
    }
    throw new Error(`Unexpected GET: ${url}`);
  };

  let executionStateWrites = 0;
  const unsubscribe = useGraphStore.subscribe((state, previousState) => {
    if (state.nodeExecutionStates !== previousState.nodeExecutionStates) {
      executionStateWrites += 1;
    }
  });

  try {
    await useGraphStore.getState().loadGraph('g-poll-noop');

    await delay(0);
    executionStateWrites = 0;
    const initialNodeExecutionStates = useGraphStore.getState().nodeExecutionStates;

    scheduledTimeouts[0]?.callback();
    await delay(0);

    assert.equal(useGraphStore.getState().nodeExecutionStates, initialNodeExecutionStates);
    assert.equal(executionStateWrites, 0);
  } finally {
    unsubscribe();
    (axios as any).get = originalGet;
    (globalThis as any).window = originalWindow;
    (globalThis as any).setTimeout = originalSetTimeout;
    (globalThis as any).clearTimeout = originalClearTimeout;
  }
});

test('deleteGraph replaces current graph with latest remaining graph', async () => {
  const localStorage = new MemoryLocalStorage();
  localStorage.setItem('k8v-current-graph-id', 'g-delete-current');
  (globalThis as any).localStorage = localStorage;

  const originalGet = axios.get;
  const originalDelete = (axios as any).delete;
  const currentGraph = makeGraph('g-delete-current');
  const fallbackGraph = makeGraph('g-fallback');

  (axios as any).delete = async (url: string) => {
    assert.equal(url, '/api/graphs/g-delete-current');
    return { status: 204 };
  };

  (axios as any).get = async (url: string) => {
    if (url === '/api/graphs/latest') {
      return { data: fallbackGraph };
    }
    if (url === '/api/graphs') {
      return {
        data: {
          graphs: [
            {
              id: fallbackGraph.id,
              name: fallbackGraph.name,
              revision: fallbackGraph.revision,
              updatedAt: fallbackGraph.updatedAt,
            },
          ],
        },
      };
    }
    throw new Error(`Unexpected GET: ${url}`);
  };

  resetGraphStoreState({
    graph: currentGraph,
    graphSummaries: [
      {
        id: currentGraph.id,
        name: currentGraph.name,
        revision: currentGraph.revision,
        updatedAt: currentGraph.updatedAt,
      },
      {
        id: fallbackGraph.id,
        name: fallbackGraph.name,
        revision: fallbackGraph.revision,
        updatedAt: fallbackGraph.updatedAt,
      },
    ],
  });

  try {
    await useGraphStore.getState().deleteGraph(currentGraph.id);

    const state = useGraphStore.getState();
    assert.equal(state.graph?.id, fallbackGraph.id);
    assert.equal(localStorage.getItem('k8v-current-graph-id'), fallbackGraph.id);
    assert.deepEqual(state.graphSummaries.map((summary) => summary.id), [fallbackGraph.id]);
  } finally {
    (axios as any).get = originalGet;
    (axios as any).delete = originalDelete;
  }
});

test('deleteGraph removes non-selected graph without switching current graph', async () => {
  const localStorage = new MemoryLocalStorage();
  localStorage.setItem('k8v-current-graph-id', 'g-keep');
  (globalThis as any).localStorage = localStorage;

  const originalGet = axios.get;
  const originalDelete = (axios as any).delete;
  const currentGraph = makeGraph('g-keep');
  const deletedGraph = makeGraph('g-drop');

  (axios as any).delete = async (url: string) => {
    assert.equal(url, '/api/graphs/g-drop');
    return { status: 204 };
  };

  (axios as any).get = async (url: string) => {
    if (url === '/api/graphs') {
      return {
        data: {
          graphs: [
            {
              id: currentGraph.id,
              name: currentGraph.name,
              revision: currentGraph.revision,
              updatedAt: currentGraph.updatedAt,
            },
          ],
        },
      };
    }
    throw new Error(`Unexpected GET: ${url}`);
  };

  resetGraphStoreState({
    graph: currentGraph,
    graphSummaries: [
      {
        id: currentGraph.id,
        name: currentGraph.name,
        revision: currentGraph.revision,
        updatedAt: currentGraph.updatedAt,
      },
      {
        id: deletedGraph.id,
        name: deletedGraph.name,
        revision: deletedGraph.revision,
        updatedAt: deletedGraph.updatedAt,
      },
    ],
  });

  try {
    await useGraphStore.getState().deleteGraph(deletedGraph.id);

    const state = useGraphStore.getState();
    assert.equal(state.graph?.id, currentGraph.id);
    assert.equal(localStorage.getItem('k8v-current-graph-id'), currentGraph.id);
    assert.deepEqual(state.graphSummaries.map((summary) => summary.id), [currentGraph.id]);
  } finally {
    (axios as any).get = originalGet;
    (axios as any).delete = originalDelete;
  }
});

test('updateGraph reloads latest graph when backend reports conflict', async () => {
  const originalGet = axios.get;
  const originalPost = axios.post;

  const initialGraph: Graph = {
    id: 'g-conflict',
    name: 'Graph conflict local',
    revision: 0,
    nodes: [],
    connections: [],
    createdAt: 1,
    updatedAt: 100,
  };
  const latestGraph: Graph = {
    id: 'g-conflict',
    name: 'Graph conflict remote',
    revision: 1,
    nodes: [],
    connections: [],
    createdAt: 1,
    updatedAt: 200,
  };

  let commandRequest: any = null;
  (axios as any).post = async (_url: string, body: unknown) => {
    commandRequest = body;
    const error: any = new Error('Graph has changed since it was loaded. Reload and retry your update.');
    error.response = { status: 409 };
    throw error;
  };
  (axios as any).get = async (url: string) => {
    if (url === '/api/graphs/g-conflict') {
      return { data: latestGraph };
    }
    throw new Error(`Unexpected GET: ${url}`);
  };

  resetGraphStoreState({
    graph: initialGraph,
  });

  try {
    await useGraphStore.getState().updateGraph({ name: 'Graph conflict attempted update' });

    const state = useGraphStore.getState();
    assert.ok(commandRequest, 'expected command payload to be sent');
    assert.equal(commandRequest.baseRevision, 0);
    assert.deepEqual(commandRequest.commands, [
      {
        kind: 'set_graph_name',
        name: 'Graph conflict attempted update',
      },
    ]);
    assert.equal(state.graph?.name, 'Graph conflict remote');
    assert.equal(state.graph?.updatedAt, 200);
    assert.match(state.error ?? '', /changed remotely/i);
  } finally {
    (axios as any).get = originalGet;
    (axios as any).post = originalPost;
  }
});

test('runtime state polling refreshes the current graph when a remote update is detected', async () => {
  const originalWindow = (globalThis as any).window;
  const originalGet = axios.get;

  (globalThis as any).window = {};

  const initialGraph = makeGraph('g-remote-sync');
  const latestGraph: Graph = {
    ...initialGraph,
    name: 'Graph remote synced',
    revision: (initialGraph.revision ?? 0) + 1,
    updatedAt: initialGraph.updatedAt + 100,
  };

  let graphFetchCount = 0;
  (axios as any).get = async (url: string) => {
    if (url === '/api/graphs/g-remote-sync') {
      graphFetchCount += 1;
      return { data: graphFetchCount === 1 ? initialGraph : latestGraph };
    }
    if (url === '/api/graphs/g-remote-sync/runtime-state') {
      return {
        data: {
          ...buildRuntimeState(latestGraph),
          revision: latestGraph.revision,
          statusVersion: 1,
        },
      };
    }
    throw new Error(`Unexpected GET: ${url}`);
  };

  try {
    await useGraphStore.getState().loadGraph('g-remote-sync');

    const startedAt = Date.now();
    while ((Date.now() - startedAt) < 2_000) {
      const state = useGraphStore.getState();
      if (state.graph?.updatedAt === latestGraph.updatedAt) {
        break;
      }
      await delay(20);
    }

    const state = useGraphStore.getState();
    assert.equal(state.graph?.name, latestGraph.name);
    assert.equal(state.graph?.updatedAt, latestGraph.updatedAt);
  } finally {
    resetGraphStoreState();
    (globalThis as any).window = originalWindow;
    (axios as any).get = originalGet;
  }
});

test('updateGraph serializes overlapping local updates against the latest persisted revision', async () => {
  const originalPost = axios.post;

  const initialGraph: Graph = {
    id: 'g-latest-wins',
    name: 'Graph baseline',
    revision: 0,
    nodes: [],
    connections: [],
    createdAt: 1,
    updatedAt: 100,
  };

  const pendingResponses: Array<{ resolve: (value: ReturnType<typeof buildCommandResponse>) => void }> = [];
  const commandRequests: any[] = [];

  (axios as any).post = async (_url: string, body: any) => {
    commandRequests.push(body);
    return await new Promise<ReturnType<typeof buildCommandResponse>>((resolve) => {
      pendingResponses.push({ resolve });
    });
  };

  resetGraphStoreState({
    graph: initialGraph,
  });

  try {
    const firstUpdate = useGraphStore.getState().updateGraph({ name: 'Graph first optimistic' });
    const secondUpdate = useGraphStore.getState().updateGraph({ name: 'Graph second optimistic' });

    assert.equal(pendingResponses.length, 1);
    assert.equal(useGraphStore.getState().graph?.name, 'Graph second optimistic');

    pendingResponses[0].resolve(buildCommandResponse({
      ...initialGraph,
      revision: 1,
      name: 'Graph first persisted',
      updatedAt: 201,
    }));
    await delay(0);

    assert.equal(pendingResponses.length, 2);

    pendingResponses[1].resolve(buildCommandResponse({
      ...initialGraph,
      revision: 2,
      name: 'Graph second persisted',
      updatedAt: 202,
    }));

    await Promise.all([firstUpdate, secondUpdate]);

    const state = useGraphStore.getState();
    assert.equal(commandRequests.length, 2);
    assert.equal(commandRequests[0].baseRevision, 0);
    assert.equal(commandRequests[1].baseRevision, 1);
    assert.equal(state.graph?.name, 'Graph second persisted');
    assert.equal(state.graph?.updatedAt, 202);
    assert.equal(state.error, null);
  } finally {
    (axios as any).post = originalPost;
  }
});

test('graph updates do not trigger frontend auto recompute requests', async () => {
  const originalPost = axios.post;

  let computeCalls = 0;
  const initialGraph: Graph = {
    id: 'g-auto',
    name: 'Auto Graph',
    revision: 0,
    nodes: [
      {
        id: 'upstream',
        type: 'inline_code' as any,
        position: { x: 0, y: 0 },
        metadata: {
          name: 'Upstream',
          inputs: [],
          outputs: [{ name: 'output', schema: { type: 'number' } }],
        },
        config: {
          code: 'outputs.output = 1;',
          runtime: 'javascript_vm',
        },
        version: 'u-v1',
      },
      {
        id: 'downstream',
        type: 'inline_code' as any,
        position: { x: 200, y: 0 },
        metadata: {
          name: 'Downstream',
          inputs: [{ name: 'input', schema: { type: 'number' } }],
          outputs: [{ name: 'output', schema: { type: 'number' } }],
        },
        config: {
          code: 'outputs.output = inputs.input;',
          runtime: 'javascript_vm',
          autoRecompute: true,
        },
        version: 'd-v1',
      },
    ],
    connections: [
      {
        id: 'c1',
        sourceNodeId: 'upstream',
        sourcePort: 'output',
        targetNodeId: 'downstream',
        targetPort: 'input',
      },
    ],
    createdAt: 1,
    updatedAt: 1,
  };

  (axios as any).post = async (_url: string, body: any) => {
    if ((body?.commands ?? []).some((command: any) => command.kind === 'compute_node' || command.kind === 'compute_graph')) {
      computeCalls += 1;
      throw new Error(`Unexpected compute request: ${JSON.stringify(body)}`);
    }

    const commandNodes = body?.commands?.find((command: any) => command.kind === 'replace_nodes')?.nodes;
    return buildCommandResponse({
      ...initialGraph,
      revision: (body?.baseRevision ?? 0) + 1,
      nodes: commandNodes ?? initialGraph.nodes,
      updatedAt: Date.now(),
    });
  };

  const patchUpstreamVersion = (version: string): Graph => ({
    ...initialGraph,
    nodes: initialGraph.nodes.map((node) =>
      node.id === 'upstream'
        ? { ...node, version }
        : node
    ),
    updatedAt: Date.now(),
  });

  resetGraphStoreState({
    graph: initialGraph,
  });

  try {
    await useGraphStore.getState().updateGraph(patchUpstreamVersion('u-v2'));
    await useGraphStore.getState().updateGraph(patchUpstreamVersion('u-v3'));
    await useGraphStore.getState().updateGraph(patchUpstreamVersion('u-v4'));
    await useGraphStore.getState().updateGraph(patchUpstreamVersion('u-v5'));
    await delay(0);
    assert.equal(computeCalls, 0);
  } finally {
    (axios as any).post = originalPost;
  }
});
