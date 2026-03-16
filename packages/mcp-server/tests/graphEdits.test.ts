import assert from 'node:assert/strict';
import test from 'node:test';
import { GraphCommand, GraphQueryRequestSchema } from '../src/index.ts';
import { registerGraphTools } from '../src/mcpGraphTools.ts';

type ToolHandler = (args: Record<string, unknown>) => Promise<{ content: Array<{ text?: string }> }>;

interface RegisteredTool {
  inputSchema: Record<string, unknown>;
  handler: ToolHandler;
}

class FakeMcpServer {
  readonly tools = new Map<string, RegisteredTool>();

  registerTool(
    name: string,
    definition: { inputSchema: Record<string, unknown> },
    handler: ToolHandler
  ): void {
    this.tools.set(name, {
      inputSchema: definition.inputSchema,
      handler,
    });
  }
}

interface RecordedRequest {
  url: string;
  method: string;
  body: unknown;
}

function createGraphFixture(overrides: Partial<Record<string, unknown>> = {}) {
  const now = Date.now();
  return {
    id: 'graph-1',
    name: 'Graph 1',
    revision: 0,
    nodes: [],
    connections: [],
    recomputeConcurrency: 1,
    executionTimeoutMs: 30_000,
    canvasBackground: { mode: 'gradient', baseColor: '#1d437e' },
    connectionStroke: {
      foregroundColor: '#f8fafc',
      backgroundColor: '#0f172a',
      foregroundWidth: 2,
      backgroundWidth: 4,
    },
    projections: [],
    activeProjectionId: 'default',
    cameras: [],
    pythonEnvs: [],
    drawings: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function parseToolJson(result: { content: Array<{ text?: string }> }): unknown {
  const text = result.content[0]?.text ?? '';
  return JSON.parse(text);
}

test('graph_create posts only name and returns an empty graph payload', async () => {
  const server = new FakeMcpServer();
  const requests: RecordedRequest[] = [];
  const originalFetch = globalThis.fetch;
  const createdGraph = createGraphFixture({ name: 'Created Via MCP' });

  registerGraphTools(server as unknown as any, {
    resolveBackendUrl: (backendUrl?: string) => backendUrl ?? 'http://backend.test',
  });

  const graphCreate = server.tools.get('graph_create');
  assert.ok(graphCreate);

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const requestBody = init?.body ? JSON.parse(String(init.body)) : undefined;
    requests.push({
      url: String(input),
      method: (init?.method ?? 'GET').toUpperCase(),
      body: requestBody,
    });
    return new Response(JSON.stringify(createdGraph), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    const result = await graphCreate.handler({
      name: 'Created Via MCP',
      backendUrl: 'http://backend.test',
    });
    const parsed = parseToolJson(result) as Record<string, unknown>;

    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.url, 'http://backend.test/api/graphs');
    assert.equal(requests[0]?.method, 'POST');
    assert.deepEqual(requests[0]?.body, { name: 'Created Via MCP' });
    assert.equal(parsed.name, 'Created Via MCP');
    assert.deepEqual(parsed.nodes, []);
    assert.deepEqual(parsed.connections, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('bulk_edit accepts GraphCommand[] and resolves base revision from graph when omitted', async () => {
  const server = new FakeMcpServer();
  const requests: RecordedRequest[] = [];
  const originalFetch = globalThis.fetch;
  const currentGraph = createGraphFixture({ revision: 7 });
  const updatedGraph = createGraphFixture({ revision: 8, name: 'Renamed Graph' });
  const commands = [
    GraphCommand.parse({ kind: 'set_graph_name', name: 'Renamed Graph' }),
    GraphCommand.parse({ kind: 'compute_graph' }),
  ];

  registerGraphTools(server as unknown as any, {
    resolveBackendUrl: (backendUrl?: string) => backendUrl ?? 'http://backend.test',
  });

  const bulkEdit = server.tools.get('bulk_edit');
  assert.ok(bulkEdit);

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    const url = String(input);
    const requestBody = init?.body ? JSON.parse(String(init.body)) : undefined;
    requests.push({
      url,
      method,
      body: requestBody,
    });

    if (method === 'GET' && url.endsWith('/api/graphs/graph-1')) {
      return new Response(JSON.stringify(currentGraph), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ graph: updatedGraph, runtimeState: { queueLength: 0 } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    const result = await bulkEdit.handler({
      graphId: 'graph-1',
      commands,
      backendUrl: 'http://backend.test',
    });
    const parsed = parseToolJson(result) as Record<string, unknown>;

    assert.equal(requests.length, 2);
    assert.equal(requests[0]?.method, 'GET');
    assert.equal(requests[0]?.url, 'http://backend.test/api/graphs/graph-1');
    assert.equal(requests[1]?.method, 'POST');
    assert.equal(requests[1]?.url, 'http://backend.test/api/graphs/graph-1/commands');
    assert.deepEqual(requests[1]?.body, {
      baseRevision: 7,
      commands,
    });
    assert.equal(parsed.commandCount, 2);
    assert.equal((parsed.graph as Record<string, unknown>).revision, 8);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('bulk_edit uses explicit baseRevision and forwards noRecompute query flag', async () => {
  const server = new FakeMcpServer();
  const requests: RecordedRequest[] = [];
  const originalFetch = globalThis.fetch;
  const commands = [GraphCommand.parse({ kind: 'compute_node', nodeId: 'node-1' })];

  registerGraphTools(server as unknown as any, {
    resolveBackendUrl: (backendUrl?: string) => backendUrl ?? 'http://backend.test',
  });

  const bulkEdit = server.tools.get('bulk_edit');
  assert.ok(bulkEdit);

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const requestBody = init?.body ? JSON.parse(String(init.body)) : undefined;
    requests.push({
      url: String(input),
      method: (init?.method ?? 'GET').toUpperCase(),
      body: requestBody,
    });
    return new Response(JSON.stringify({ graph: createGraphFixture({ revision: 12 }) }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    await bulkEdit.handler({
      graphId: 'graph-1',
      baseRevision: 11,
      noRecompute: true,
      commands,
      backendUrl: 'http://backend.test',
    });
    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.url, 'http://backend.test/api/graphs/graph-1/commands?noRecompute=true');
    assert.deepEqual(requests[0]?.body, {
      baseRevision: 11,
      commands,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('graph_query uses shared GraphQueryRequestSchema contract', async () => {
  const parsed = GraphQueryRequestSchema.parse({
    operation: 'traverse_bfs',
    startNodeIds: ['source'],
    depth: 2,
    nodeFields: ['id', 'name'],
    connectionFields: ['sourcePort', 'targetPort'],
  });

  assert.equal(parsed.operation, 'traverse_bfs');
  assert.equal(parsed.depth, 2);
});
