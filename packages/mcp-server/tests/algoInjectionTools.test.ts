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

  registerAlgoTools(server as unknown as any, {
    resolveBackendUrl: (backendUrl?: string) => backendUrl ?? 'http://backend.test',
    requestJson: async <T>(backendUrl: string, endpoint: string, init?: RequestInit) => {
      requests.push({
        url: `${backendUrl}${endpoint}`,
        method: (init?.method ?? 'GET').toUpperCase(),
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      return {
        status: 'ok',
        commandCount: 1,
      } as T;
    },
  });

  assert.equal(server.tools.size, 1);
  assert.ok(server.tools.has('algo_injection_run'));

  const runTool = server.tools.get('algo_injection_run');
  assert.ok(runTool);
  assert.match(runTool.description ?? '', /absolute filesystem path/i);
  assert.match(runTool.description ?? '', /graph_get, graph_query, and staged bulk_edit/i);

  const result = await runTool.handler({
    graphId: 'graph-1',
    wasmPath: '/tmp/rename-graph.wasm',
    entrypoint: 'run',
    input: { nextName: 'Renamed by wasm' },
    noRecompute: true,
    backendUrl: 'http://backend.test',
  });
  const parsed = parseToolJson(result) as { status: string; commandCount: number };

  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.url, 'http://backend.test/api/graphs/graph-1/algo/invoke');
  assert.equal(requests[0]?.method, 'POST');
  assert.deepEqual(requests[0]?.body, {
    wasmPath: '/tmp/rename-graph.wasm',
    entrypoint: 'run',
    input: { nextName: 'Renamed by wasm' },
    noRecompute: true,
  });
  assert.equal(parsed.status, 'ok');
  assert.equal(parsed.commandCount, 1);
});
