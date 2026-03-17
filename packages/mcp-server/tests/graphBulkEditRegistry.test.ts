import assert from 'node:assert/strict';
import test from 'node:test';
import { GraphQueryRequestSchema, filterConnections } from '../src/index.ts';
import { registerConnectionTools } from '../src/mcpConnectionTools.ts';
import { registerGraphTools } from '../src/mcpGraphTools.ts';

type ToolHandler = (args: Record<string, unknown>) => Promise<{ content: Array<{ text?: string }> }>;

class FakeMcpServer {
  readonly tools = new Map<string, ToolHandler>();

  registerTool(
    name: string,
    _definition: { inputSchema: Record<string, unknown> },
    handler: ToolHandler
  ): void {
    this.tools.set(name, handler);
  }
}

function createGraphFixture() {
  const now = Date.now();
  return {
    id: 'graph-1',
    name: 'Graph 1',
    revision: 2,
    nodes: [
      {
        id: 'node-a',
        type: 'inline_code',
        position: { x: 0, y: 0 },
        metadata: {
          name: 'A',
          inputs: [{ name: 'in', schema: { type: 'number' } }],
          outputs: [{ name: 'out', schema: { type: 'number' } }],
        },
        config: { type: 'inline_code', code: 'outputs.out = 1;', runtime: 'javascript_vm' },
        version: 'a-v1',
      },
      {
        id: 'node-b',
        type: 'inline_code',
        position: { x: 120, y: 0 },
        metadata: {
          name: 'B',
          inputs: [{ name: 'in', schema: { type: 'number' } }],
          outputs: [{ name: 'out', schema: { type: 'number' } }],
        },
        config: { type: 'inline_code', code: 'outputs.out = inputs.in;', runtime: 'javascript_vm' },
        version: 'b-v1',
      },
    ],
    connections: [
      {
        id: 'conn-1',
        sourceNodeId: 'node-a',
        sourcePort: 'out',
        targetNodeId: 'node-b',
        targetPort: 'in',
      },
      {
        id: 'conn-2',
        sourceNodeId: 'node-b',
        sourcePort: 'out',
        targetNodeId: 'node-a',
        targetPort: 'in',
      },
    ],
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
  };
}

function parseToolJson(result: { content: Array<{ text?: string }> }): unknown {
  return JSON.parse(result.content[0]?.text ?? '{}');
}

test('connections_list tool returns filtered graph connections', async () => {
  const server = new FakeMcpServer();
  const graph = createGraphFixture();

  registerConnectionTools(server as unknown as any, {
    resolveBackendUrl: (backendUrl?: string) => backendUrl ?? 'http://backend.test',
    getGraph: async () => graph as any,
  });

  const handler = server.tools.get('connections_list');
  assert.ok(handler);

  const result = await handler({
    graphId: graph.id,
    nodeId: 'node-a',
  });
  const parsed = parseToolJson(result) as Record<string, unknown>;

  assert.equal(parsed.graphId, graph.id);
  assert.equal(parsed.count, 2);
  assert.deepEqual(
    (parsed.connections as Array<Record<string, unknown>>).map((connection) => connection.id),
    ['conn-1', 'conn-2']
  );
});

test('filterConnections helper matches nodeId and targetPort filters', () => {
  const graph = createGraphFixture();
  const filtered = filterConnections(graph.connections as any, {
    nodeId: 'node-b',
    targetPort: 'in',
  });
  assert.equal(filtered.length, 2);
  assert.deepEqual(
    filtered.map((connection) => connection.id),
    ['conn-1', 'conn-2']
  );
});

test('graph_query tool forwards validated query payload to backend', async () => {
  const server = new FakeMcpServer();
  const requests: Array<{ url: string; method: string; body: unknown }> = [];
  const originalFetch = globalThis.fetch;

  registerGraphTools(server as unknown as any, {
    resolveBackendUrl: (backendUrl?: string) => backendUrl ?? 'http://backend.test',
  });

  const handler = server.tools.get('graph_query');
  assert.ok(handler);

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({
      url: String(input),
      method: (init?.method ?? 'GET').toUpperCase(),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    return new Response(JSON.stringify({ operation: 'overview', nodes: [], connections: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    const query = GraphQueryRequestSchema.parse({
      operation: 'traverse_bfs',
      startNodeIds: ['node-a'],
      depth: 1,
      nodeFields: ['id', 'annotationText', 'position'],
      connectionFields: ['id', 'sourceNodeId', 'targetNodeId'],
    });
    const result = await handler({
      graphId: 'graph-1',
      ...query,
      backendUrl: 'http://backend.test',
    });

    const parsed = parseToolJson(result) as Record<string, unknown>;
    assert.equal(parsed.operation, 'overview');
    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.url, 'http://backend.test/api/graphs/graph-1/query');
    assert.equal(requests[0]?.method, 'POST');
    assert.deepEqual(requests[0]?.body, query);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
