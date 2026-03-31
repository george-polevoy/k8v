import assert from 'node:assert/strict';
import test from 'node:test';
import { GraphCommand, GraphQueryRequestSchema } from '../src/index.ts';
import { registerGraphTools } from '../src/mcpGraphTools.ts';

type ToolHandler = (args: Record<string, unknown>) => Promise<{ content: Array<{ text?: string }> }>;

interface RegisteredTool {
  description?: string;
  inputSchema: Record<string, unknown>;
  handler: ToolHandler;
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
  const createdGraph = createGraphFixture({ name: 'Created Via MCP' });

  registerGraphTools(server as unknown as any, {
    resolveBackendUrl: (backendUrl?: string) => backendUrl ?? 'http://backend.test',
    requestJson: async <T>(backendUrl: string, endpoint: string, init?: RequestInit) => {
      const requestBody = init?.body ? JSON.parse(String(init.body)) : undefined;
      requests.push({
        url: `${backendUrl}${endpoint}`,
        method: (init?.method ?? 'GET').toUpperCase(),
        body: requestBody,
      });
      return createdGraph as T;
    },
  });

  const graphCreate = server.tools.get('graph_create');
  assert.ok(graphCreate);

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
});

test('bulk_edit accepts GraphCommand[] and resolves base revision from graph when omitted', async () => {
  const server = new FakeMcpServer();
  const requests: RecordedRequest[] = [];
  const currentGraph = createGraphFixture({ revision: 7 });
  const updatedGraph = createGraphFixture({ revision: 8, name: 'Renamed Graph' });
  const commands = [
    GraphCommand.parse({ kind: 'set_graph_name', name: 'Renamed Graph' }),
    GraphCommand.parse({ kind: 'compute_graph' }),
  ];

  registerGraphTools(server as unknown as any, {
    resolveBackendUrl: (backendUrl?: string) => backendUrl ?? 'http://backend.test',
    getGraph: async (backendUrl: string, graphId: string) => {
      requests.push({
        url: `${backendUrl}/api/graphs/${graphId}`,
        method: 'GET',
        body: undefined,
      });
      return currentGraph as any;
    },
    submitGraphCommands: async (
      backendUrl: string,
      graphId: string,
      baseRevision: number,
      nextCommands: GraphCommand[]
    ) => {
      requests.push({
        url: `${backendUrl}/api/graphs/${graphId}/commands`,
        method: 'POST',
        body: {
          baseRevision,
          commands: nextCommands,
        },
      });
      return { graph: updatedGraph as any, runtimeState: { queueLength: 0 } };
    },
  });

  const bulkEdit = server.tools.get('bulk_edit');
  assert.ok(bulkEdit);
  assert.match(bulkEdit.description ?? '', /structured objects/i);
  assert.match(bulkEdit.description ?? '', /do not stringify/i);
  const commandsSchema = bulkEdit.inputSchema.commands as { parse: (value: unknown) => unknown };
  assert.deepEqual(
    commandsSchema.parse([{ kind: 'compute_graph' }]),
    [{ kind: 'compute_graph' }]
  );
  assert.throws(() => commandsSchema.parse(['{"kind":"compute_graph"}']));

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
});

test('bulk_edit re-validates structured command objects against GraphCommand before posting', async () => {
  const server = new FakeMcpServer();
  let dependencyCalled = false;

  registerGraphTools(server as unknown as any, {
    resolveBackendUrl: (backendUrl?: string) => backendUrl ?? 'http://backend.test',
    getGraph: async () => {
      dependencyCalled = true;
      throw new Error('getGraph should not be called for invalid commands');
    },
    submitGraphCommands: async () => {
      dependencyCalled = true;
      throw new Error('submitGraphCommands should not be called for invalid commands');
    },
  });

  const bulkEdit = server.tools.get('bulk_edit');
  assert.ok(bulkEdit);

  await assert.rejects(
    () => bulkEdit.handler({
      graphId: 'graph-1',
      commands: [{ kind: 'not_a_real_graph_command' }],
      backendUrl: 'http://backend.test',
    })
  );
  assert.equal(dependencyCalled, false);
});

test('bulk_edit uses explicit baseRevision and forwards noRecompute query flag', async () => {
  const server = new FakeMcpServer();
  const requests: RecordedRequest[] = [];
  const commands = [GraphCommand.parse({ kind: 'compute_node', nodeId: 'node-1' })];

  registerGraphTools(server as unknown as any, {
    resolveBackendUrl: (backendUrl?: string) => backendUrl ?? 'http://backend.test',
    submitGraphCommands: async (
      backendUrl: string,
      graphId: string,
      baseRevision: number,
      nextCommands: GraphCommand[],
      options?: { noRecompute?: boolean }
    ) => {
      requests.push({
        url: `${backendUrl}/api/graphs/${graphId}/commands${options?.noRecompute ? '?noRecompute=true' : ''}`,
        method: 'POST',
        body: {
          baseRevision,
          commands: nextCommands,
        },
      });
      return { graph: createGraphFixture({ revision: 12 }) as any };
    },
  });

  const bulkEdit = server.tools.get('bulk_edit');
  assert.ok(bulkEdit);

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
});

test('bulk_edit accepts node_set_custom as a granular metadata update command', async () => {
  const server = new FakeMcpServer();
  const requests: RecordedRequest[] = [];
  const commands = [
    GraphCommand.parse({
      kind: 'node_set_custom',
      nodeId: 'node-1',
      custom: {
        owner: 'agent',
        nested: {
          enabled: true,
        },
      },
    }),
  ];

  registerGraphTools(server as unknown as any, {
    resolveBackendUrl: (backendUrl?: string) => backendUrl ?? 'http://backend.test',
    submitGraphCommands: async (
      backendUrl: string,
      graphId: string,
      baseRevision: number,
      nextCommands: GraphCommand[]
    ) => {
      requests.push({
        url: `${backendUrl}/api/graphs/${graphId}/commands`,
        method: 'POST',
        body: {
          baseRevision,
          commands: nextCommands,
        },
      });
      return {
        graph: createGraphFixture({
          revision: 4,
          nodes: [
            {
              id: 'node-1',
              type: 'inline_code',
              position: { x: 0, y: 0 },
              metadata: {
                name: 'Inline',
                inputs: [],
                outputs: [],
                custom: {
                  owner: 'agent',
                  nested: {
                    enabled: true,
                  },
                },
              },
              config: {
                type: 'inline_code',
                code: 'outputs.output = 1;',
                runtime: 'javascript_vm',
              },
              version: '2',
            },
          ],
        }) as any,
      };
    },
  });

  const bulkEdit = server.tools.get('bulk_edit');
  assert.ok(bulkEdit);

  const result = await bulkEdit.handler({
    graphId: 'graph-1',
    baseRevision: 3,
    commands,
    backendUrl: 'http://backend.test',
  });
  const parsed = parseToolJson(result) as Record<string, any>;

  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0]?.body, {
    baseRevision: 3,
    commands,
  });
  assert.deepEqual(parsed.graph.nodes[0].metadata.custom, {
    owner: 'agent',
    nested: {
      enabled: true,
    },
  });
});

test('graph_query uses shared GraphQueryRequestSchema contract', async () => {
  const parsed = GraphQueryRequestSchema.parse({
    operation: 'traverse_bfs',
    startNodeIds: ['source'],
    depth: 2,
    nodeFields: ['id', 'name', 'config', 'cardSize'],
    connectionFields: ['sourcePort', 'targetPort'],
  });

  assert.equal(parsed.operation, 'traverse_bfs');
  assert.equal(parsed.depth, 2);
});
