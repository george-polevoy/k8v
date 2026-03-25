import assert from 'node:assert/strict';
import test from 'node:test';
import { registerAlgoTools } from '../src/mcpAlgoTools.ts';

type ToolHandler = (args: Record<string, unknown>) => Promise<{ content: Array<{ text?: string }> }>;

interface RegisteredTool {
  description?: string;
  inputSchema: Record<string, unknown>;
  handler: ToolHandler;
}

interface RecordedRequest {
  url: string;
  method: string;
  body: unknown;
}

class FakeMcpServer {
  readonly tools = new Map<string, RegisteredTool>();

  registerTool(
    name: string,
    definition: { inputSchema: Record<string, unknown>; description?: string },
    handler: ToolHandler
  ): void {
    this.tools.set(name, {
      description: definition.description,
      inputSchema: definition.inputSchema,
      handler,
    });
  }
}

function parseToolJson(result: { content: Array<{ text?: string }> }): unknown {
  const text = result.content[0]?.text ?? '';
  return JSON.parse(text);
}

test('algo injection MCP tools register and list graph-scoped algos', async () => {
  const server = new FakeMcpServer();
  const requests: RecordedRequest[] = [];
  const originalFetch = globalThis.fetch;

  registerAlgoTools(server as unknown as any, {
    resolveBackendUrl: (backendUrl?: string) => backendUrl ?? 'http://backend.test',
  });

  assert.ok(server.tools.has('algo_injection_list'));
  assert.ok(server.tools.has('algo_injection_register'));
  assert.ok(server.tools.has('algo_injection_delete'));
  assert.ok(server.tools.has('algo_injection_run'));

  const listTool = server.tools.get('algo_injection_list');
  assert.ok(listTool);

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({
      url: String(input),
      method: (init?.method ?? 'GET').toUpperCase(),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    return new Response(JSON.stringify({
      algoInjections: [
        {
          id: 'algo-1',
          name: 'echo',
          artifactId: 'wasm-1',
          entrypoint: 'run',
          abi: 'json_v1',
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    const result = await listTool.handler({
      graphId: 'graph-1',
      backendUrl: 'http://backend.test',
    });
    const parsed = parseToolJson(result) as { algoInjections: Array<{ name: string }> };

    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.method, 'GET');
    assert.equal(requests[0]?.url, 'http://backend.test/api/graphs/graph-1/algos');
    assert.equal(parsed.algoInjections[0]?.name, 'echo');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('algo_injection_register forwards wasm registration payload', async () => {
  const server = new FakeMcpServer();
  const requests: RecordedRequest[] = [];
  const originalFetch = globalThis.fetch;

  registerAlgoTools(server as unknown as any, {
    resolveBackendUrl: (backendUrl?: string) => backendUrl ?? 'http://backend.test',
  });

  const registerTool = server.tools.get('algo_injection_register');
  assert.ok(registerTool);
  assert.match(registerTool.description ?? '', /memory, alloc, and a JSON entrypoint/i);

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({
      url: String(input),
      method: (init?.method ?? 'GET').toUpperCase(),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    return new Response(JSON.stringify({
      algoInjection: {
        id: 'algo-1',
        name: 'echo',
      },
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    const result = await registerTool.handler({
      graphId: 'graph-1',
      name: 'echo',
      wasmBase64: 'AGFzbQEAAA==',
      entrypoint: 'run',
      backendUrl: 'http://backend.test',
    });
    const parsed = parseToolJson(result) as { algoInjection: { id: string } };

    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.method, 'POST');
    assert.equal(requests[0]?.url, 'http://backend.test/api/graphs/graph-1/algos');
    assert.deepEqual(requests[0]?.body, {
      name: 'echo',
      wasmBase64: 'AGFzbQEAAA==',
      entrypoint: 'run',
    });
    assert.equal(parsed.algoInjection.id, 'algo-1');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('algo_injection_delete and algo_injection_run resolve algoName before calling backend', async () => {
  const server = new FakeMcpServer();
  const requests: RecordedRequest[] = [];
  const originalFetch = globalThis.fetch;

  registerAlgoTools(server as unknown as any, {
    resolveBackendUrl: (backendUrl?: string) => backendUrl ?? 'http://backend.test',
  });

  const deleteTool = server.tools.get('algo_injection_delete');
  const runTool = server.tools.get('algo_injection_run');
  assert.ok(deleteTool);
  assert.ok(runTool);
  assert.match(runTool.description ?? '', /graph_get, graph_query, and staged bulk_edit/i);

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    const url = String(input);
    requests.push({
      url,
      method,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });

    if (method === 'GET' && url.endsWith('/api/graphs/graph-1/algos')) {
      return new Response(JSON.stringify({
        algoInjections: [
          {
            id: 'algo-1',
            name: 'rename-graph',
            artifactId: 'wasm-1',
            entrypoint: 'run',
            abi: 'json_v1',
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    const deleteResult = await deleteTool.handler({
      graphId: 'graph-1',
      algoName: 'rename-graph',
      backendUrl: 'http://backend.test',
    });
    const deleteParsed = parseToolJson(deleteResult) as { ok: boolean };
    assert.equal(deleteParsed.ok, true);

    const runResult = await runTool.handler({
      graphId: 'graph-1',
      algoName: 'rename-graph',
      input: { nextName: 'Renamed by wasm' },
      noRecompute: true,
      backendUrl: 'http://backend.test',
    });
    const runParsed = parseToolJson(runResult) as { ok: boolean };
    assert.equal(runParsed.ok, true);

    assert.equal(requests.length, 4);
    assert.equal(requests[0]?.url, 'http://backend.test/api/graphs/graph-1/algos');
    assert.equal(requests[1]?.url, 'http://backend.test/api/graphs/graph-1/algos/algo-1');
    assert.equal(requests[1]?.method, 'DELETE');
    assert.equal(requests[2]?.url, 'http://backend.test/api/graphs/graph-1/algos');
    assert.equal(requests[3]?.url, 'http://backend.test/api/graphs/graph-1/algos/algo-1/invoke');
    assert.equal(requests[3]?.method, 'POST');
    assert.deepEqual(requests[3]?.body, {
      input: { nextName: 'Renamed by wasm' },
      noRecompute: true,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
