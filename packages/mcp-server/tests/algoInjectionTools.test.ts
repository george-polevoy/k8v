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

test('algo_injection_run is the only MCP algo tool and forwards the transient invoke payload', async () => {
  const server = new FakeMcpServer();
  const requests: RecordedRequest[] = [];
  const originalFetch = globalThis.fetch;

  registerAlgoTools(server as unknown as any, {
    resolveBackendUrl: (backendUrl?: string) => backendUrl ?? 'http://backend.test',
  });

  assert.equal(server.tools.size, 1);
  assert.ok(server.tools.has('algo_injection_run'));

  const runTool = server.tools.get('algo_injection_run');
  assert.ok(runTool);
  assert.match(runTool.description ?? '', /absolute filesystem path/i);
  assert.match(runTool.description ?? '', /graph_get, graph_query, and staged bulk_edit/i);

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({
      url: String(input),
      method: (init?.method ?? 'GET').toUpperCase(),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    return new Response(JSON.stringify({
      result: { ok: true },
      stagedCommands: [],
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    const result = await runTool.handler({
      graphId: 'graph-1',
      wasmPath: '/tmp/rename-graph.wasm',
      entrypoint: 'run',
      input: { nextName: 'Renamed by wasm' },
      noRecompute: true,
      backendUrl: 'http://backend.test',
    });
    const parsed = parseToolJson(result) as { result: { ok: boolean } };

    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.url, 'http://backend.test/api/graphs/graph-1/algo/invoke');
    assert.equal(requests[0]?.method, 'POST');
    assert.deepEqual(requests[0]?.body, {
      wasmPath: '/tmp/rename-graph.wasm',
      entrypoint: 'run',
      input: { nextName: 'Renamed by wasm' },
      noRecompute: true,
    });
    assert.equal(parsed.result.ok, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
