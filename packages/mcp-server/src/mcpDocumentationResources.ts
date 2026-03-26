import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z, type ZodTypeAny } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import {
  ANNOTATION_CONNECTION_PORT,
  GraphCommand,
  GraphQueryRequestSchema,
} from '../../domain/dist/index.js';

const MCP_OVERVIEW_URI = 'k8v://docs/mcp-overview.md';
const GRAPH_COMMAND_SCHEMA_URI = 'k8v://docs/graph-command-schema.json';
const GRAPH_QUERY_SCHEMA_URI = 'k8v://docs/graph-query-schema.json';
const ANNOTATION_WORKFLOWS_URI = 'k8v://docs/annotation-workflows.md';
const WASM_ALGO_INVOCATION_URI = 'k8v://docs/wasm-algo-invocation.md';

type ExampleTopic =
  | 'annotation-board'
  | 'annotation-arrows'
  | 'annotation-multi-arrows'
  | 'algo-run'
  | 'bulk-edit-call'
  | 'bulk-edit-retry'
  | 'graph-query';

const GraphCommandDocumentationSchema: ZodTypeAny = GraphCommand as z.ZodTypeAny;
const GraphQueryDocumentationSchema: ZodTypeAny = GraphQueryRequestSchema as z.ZodTypeAny;
const renderJsonSchema = zodToJsonSchema as unknown as (schema: ZodTypeAny, name: string) => unknown;

function buildMcpOverviewText(): string {
  return [
    '# k8v MCP Overview',
    '',
    '- `graph_create` is the only non-bulk exception and creates an empty graph only.',
    '- `bulk_edit` is the only graph mutation tool and accepts ordered `GraphCommand[]`.',
    '- Pass `bulk_edit.commands` as structured MCP objects in the tool arguments; do not stringify each command as JSON text.',
    '- `algo_injection_run` invokes a wasm module transiently from an absolute filesystem path accessible to the backend host.',
    '- `graph_query` is for lightweight inspection. Use `graph_get` when you need the full persisted graph.',
    '- `connections_list` is for filtered connection inspection.',
    '- `graph_screenshot_region` renders through the dedicated screenshot harness and can start its own harness server when no explicit frontend URL override is provided.',
    '',
    'Recommended reading order:',
    '- `k8v://docs/examples/bulk-edit-call`',
    '- `k8v://docs/examples/annotation-board`',
    '- `k8v://docs/examples/annotation-arrows`',
    '- `k8v://docs/examples/annotation-multi-arrows`',
    '- `k8v://docs/examples/graph-query`',
    `- \`${ANNOTATION_WORKFLOWS_URI}\``,
    '',
    'Reference schemas for uncommon commands or validation details:',
    `- \`${GRAPH_COMMAND_SCHEMA_URI}\``,
    `- \`${GRAPH_QUERY_SCHEMA_URI}\``,
    '',
    'Additional examples:',
    '- `k8v://docs/examples/annotation-board`',
    '- `k8v://docs/examples/annotation-arrows`',
    '- `k8v://docs/examples/annotation-multi-arrows`',
    '- `k8v://docs/examples/algo-run`',
    '- `k8v://docs/examples/bulk-edit-call`',
    '- `k8v://docs/examples/bulk-edit-retry`',
    '- `k8v://docs/examples/graph-query`',
    `- \`${WASM_ALGO_INVOCATION_URI}\``,
    '',
    'Revision conflicts:',
    '- `bulk_edit` errors include `currentRevision` in backend responses; retry with that revision after reloading graph state.',
  ].join('\n');
}

function buildAnnotationWorkflowsText(): string {
  return [
    '# Annotation Workflows',
    '',
    'Annotation cards are regular graph nodes with `type: "annotation"`.',
    'When calling `bulk_edit`, pass commands as structured MCP objects in the tool arguments, not stringified JSON strings.',
    '',
    'Creation:',
    'Optional `cardWidth` and `cardHeight` fields can be set on `node_add_annotation` so agents can avoid overlapping default card sizes on first placement.',
    '```json',
    JSON.stringify([
      {
        kind: 'node_add_annotation',
        nodeId: 'note-1',
        name: 'Idea',
        x: 120,
        y: 140,
        cardWidth: 320,
        cardHeight: 220,
        text: '# Idea\\n\\nFree-form notes',
        backgroundColor: '#fef3c7',
        borderColor: '#334155',
        fontColor: '#1f2937',
        fontSize: 20,
      },
    ], null, 2),
    '```',
    '',
    'Update text/colors:',
    '```json',
    JSON.stringify([
      {
        kind: 'node_set_annotation',
        nodeId: 'note-1',
        text: 'Updated markdown',
        backgroundColor: '#dbeafe',
        borderColor: '#1d4ed8',
        fontColor: '#0f172a',
      },
    ], null, 2),
    '```',
    '',
    `Presentation arrows use the pseudo-port \`${ANNOTATION_CONNECTION_PORT}\` on card-edge endpoints.`,
    'Anchors are optional and use `{ "side": "top|right|bottom|left", "offset": 0..1 }`.',
    'Target slots are unique by `(targetNodeId, targetPort, targetAnchor)`.',
    'If multiple arrows land on the same annotation side, use distinct `targetAnchor.offset` values for each inbound arrow.',
    'Use `connection_set` when reusing an occupied target slot should replace the existing inbound connection rather than coexist with it.',
    '',
    'Card-edge presentation arrow:',
    '```json',
    JSON.stringify([
      {
        kind: 'connection_add',
        connectionId: 'arrow-1',
        sourceNodeId: 'note-left',
        sourcePort: ANNOTATION_CONNECTION_PORT,
        sourceAnchor: { side: 'right', offset: 0.5 },
        targetNodeId: 'note-right',
        targetPort: ANNOTATION_CONNECTION_PORT,
        targetAnchor: { side: 'left', offset: 0.5 },
      },
    ], null, 2),
    '```',
    '',
    'Suggested annotation inspection query:',
    '```json',
    JSON.stringify({
      operation: 'overview',
      nodeFields: ['id', 'name', 'type', 'position', 'annotationText', 'cardSize'],
      connectionFields: ['id', 'sourceNodeId', 'sourcePort', 'sourceAnchor', 'targetNodeId', 'targetPort', 'targetAnchor'],
    }, null, 2),
    '```',
  ].join('\n');
}

function buildAlgoInjectionsText(): string {
  return [
    '# Wasm Algo Invocation',
    '',
    'Wasm algos are invoked transiently through a dedicated MCP tool.',
    'All modules use the same fixed host API in v1: `graph_get`, `graph_query`, and staged `bulk_edit`.',
    'There is no generic filesystem or outbound network access from inside the sandbox.',
    '',
    'Invocation:',
    '- Call `algo_injection_run` with `graphId`, an absolute `wasmPath`, and optional `entrypoint`/`input`.',
    '- The `wasmPath` must be readable by the backend host process. This flow assumes the MCP server and backend share filesystem access.',
    '- The wasm module must export `memory`, `alloc`, and a JSON entrypoint (default `run`).',
    '- Successful invocation responses are intentionally minimal: `status` and `commandCount` only.',
    '- `bulk_edit` calls made by the module are staged during execution and committed once after successful completion.',
    '- `compute_graph` and `compute_node` are rejected inside algo-hosted `bulk_edit`.',
  ].join('\n');
}

function buildExampleText(topic: ExampleTopic): string {
  switch (topic) {
    case 'annotation-board':
      return [
        '# Example: Annotation-Only Board',
        '',
        '1. Call `graph_create`.',
        '2. Call `bulk_edit` with multiple `node_add_annotation` commands.',
        '3. Optionally connect cards with `connection_add` using the presentation pseudo-port.',
        '',
        'Minimal batch:',
        '```json',
        JSON.stringify([
          {
            kind: 'node_add_annotation',
            nodeId: 'note-a',
            name: 'A',
            x: 100,
            y: 120,
            cardWidth: 280,
            cardHeight: 180,
            text: 'Alpha',
          },
          {
            kind: 'node_add_annotation',
            nodeId: 'note-b',
            name: 'B',
            x: 420,
            y: 120,
            cardWidth: 280,
            cardHeight: 180,
            text: 'Beta',
          },
        ], null, 2),
        '```',
      ].join('\n');
    case 'annotation-arrows':
      return [
        '# Example: Annotation Arrows',
        '',
        `Use \`${ANNOTATION_CONNECTION_PORT}\` for card-edge presentation endpoints.`,
        '',
        '```json',
        JSON.stringify([
          {
            kind: 'connection_add',
            connectionId: 'arrow-top',
            sourceNodeId: 'note-a',
            sourcePort: ANNOTATION_CONNECTION_PORT,
            sourceAnchor: { side: 'bottom', offset: 0.25 },
            targetNodeId: 'note-b',
            targetPort: ANNOTATION_CONNECTION_PORT,
            targetAnchor: { side: 'top', offset: 0.75 },
          },
        ], null, 2),
        '```',
      ].join('\n');
    case 'annotation-multi-arrows':
      return [
        '# Example: Multiple Inbound Annotation Arrows',
        '',
        'Two inbound presentation arrows can target the same annotation side only when they use distinct target anchors.',
        'If you want replacement behavior instead of coexistence, use `connection_set` for the occupied target slot.',
        '',
        '```json',
        JSON.stringify([
          {
            kind: 'connection_add',
            connectionId: 'arrow-top',
            sourceNodeId: 'note-a',
            sourcePort: ANNOTATION_CONNECTION_PORT,
            sourceAnchor: { side: 'right', offset: 0.5 },
            targetNodeId: 'note-target',
            targetPort: ANNOTATION_CONNECTION_PORT,
            targetAnchor: { side: 'left', offset: 0.35 },
          },
          {
            kind: 'connection_add',
            connectionId: 'arrow-bottom',
            sourceNodeId: 'note-b',
            sourcePort: ANNOTATION_CONNECTION_PORT,
            sourceAnchor: { side: 'right', offset: 0.5 },
            targetNodeId: 'note-target',
            targetPort: ANNOTATION_CONNECTION_PORT,
            targetAnchor: { side: 'left', offset: 0.75 },
          },
        ], null, 2),
        '```',
      ].join('\n');
    case 'algo-run':
      return [
        '# Example: Run a Wasm Algo',
        '',
        '```json',
        JSON.stringify({
          graphId: 'graph-123',
          wasmPath: '/absolute/path/to/rename-graph.wasm',
          entrypoint: 'run',
          input: {
            nextName: 'Renamed by wasm',
          },
        }, null, 2),
        '```',
      ].join('\n');
    case 'bulk-edit-call':
      return [
        '# Example: bulk_edit Tool Call',
        '',
        'Pass `commands` as raw structured objects in the MCP arguments. Do not stringify each command.',
        '',
        '```json',
        JSON.stringify({
          graphId: 'graph-123',
          baseRevision: 7,
          commands: [
            {
              kind: 'node_add_annotation',
              nodeId: 'note-a',
              name: 'A',
              x: 100,
              y: 120,
              cardWidth: 280,
              cardHeight: 180,
              text: 'Alpha',
            },
            {
              kind: 'connection_add',
              connectionId: 'arrow-a',
              sourceNodeId: 'note-a',
              sourcePort: ANNOTATION_CONNECTION_PORT,
              targetNodeId: 'note-b',
              targetPort: ANNOTATION_CONNECTION_PORT,
              targetAnchor: { side: 'left', offset: 0.5 },
            },
          ],
        }, null, 2),
        '```',
      ].join('\n');
    case 'bulk-edit-retry':
      return [
        '# Example: bulk_edit Retry After Conflict',
        '',
        '1. Call `graph_get` or `graph_query` to refresh graph state.',
        '2. Read `revision` from the latest graph.',
        '3. Retry `bulk_edit` with `baseRevision` set to that value.',
      ].join('\n');
    case 'graph-query':
      return [
        '# Example: graph_query for Annotation Inspection',
        '',
        '```json',
        JSON.stringify({
          operation: 'overview',
          nodeFields: ['id', 'name', 'type', 'position', 'annotationText', 'config'],
          connectionFields: ['id', 'sourceNodeId', 'sourcePort', 'sourceAnchor', 'targetNodeId', 'targetPort', 'targetAnchor'],
        }, null, 2),
        '```',
      ].join('\n');
    default:
      return '# Unknown example topic';
  }
}

function createTextResource(uri: string, text: string) {
  return {
    contents: [
      {
        uri,
        mimeType: 'text/markdown',
        text,
      },
    ],
  };
}

function createJsonSchemaResource(uri: string, schema: ZodTypeAny, name: string) {
  return {
    contents: [
      {
        uri,
        mimeType: 'application/json',
        text: JSON.stringify(renderJsonSchema(schema, name), null, 2),
      },
    ],
  };
}

export function registerDocumentationResources(server: any): void {
  server.registerResource(
    'mcp-overview',
    MCP_OVERVIEW_URI,
    {
      title: 'k8v MCP Overview',
      description: 'High-level MCP contract summary and discoverability pointers.',
      mimeType: 'text/markdown',
    },
    async () => createTextResource(MCP_OVERVIEW_URI, buildMcpOverviewText())
  );

  server.registerResource(
    'graph-command-schema',
    GRAPH_COMMAND_SCHEMA_URI,
    {
      title: 'GraphCommand Schema',
      description: 'JSON schema for GraphCommand[] payloads used by bulk_edit.',
      mimeType: 'application/json',
    },
    async () =>
      createJsonSchemaResource(
        GRAPH_COMMAND_SCHEMA_URI,
        GraphCommandDocumentationSchema,
        'GraphCommand'
      )
  );

  server.registerResource(
    'graph-query-schema',
    GRAPH_QUERY_SCHEMA_URI,
    {
      title: 'Graph Query Schema',
      description: 'JSON schema for graph_query requests.',
      mimeType: 'application/json',
    },
    async () =>
      createJsonSchemaResource(
        GRAPH_QUERY_SCHEMA_URI,
        GraphQueryDocumentationSchema,
        'GraphQueryRequest'
      )
  );

  server.registerResource(
    'annotation-workflows',
    ANNOTATION_WORKFLOWS_URI,
    {
      title: 'Annotation Workflows',
      description: 'Examples for annotation node creation, updates, and presentation arrows.',
      mimeType: 'text/markdown',
    },
    async () => createTextResource(ANNOTATION_WORKFLOWS_URI, buildAnnotationWorkflowsText())
  );

  server.registerResource(
    'wasm-algo-invocation',
    WASM_ALGO_INVOCATION_URI,
    {
      title: 'Wasm Algo Invocation',
      description: 'ABI and workflow guidance for transient wasm algo invocation.',
      mimeType: 'text/markdown',
    },
    async () => createTextResource(WASM_ALGO_INVOCATION_URI, buildAlgoInjectionsText())
  );

  const examplesTemplate = new ResourceTemplate('k8v://docs/examples/{topic}', {
    list: async () => ({
      resources: [
        { uri: 'k8v://docs/examples/annotation-board', name: 'annotation-board' },
        { uri: 'k8v://docs/examples/annotation-arrows', name: 'annotation-arrows' },
        { uri: 'k8v://docs/examples/annotation-multi-arrows', name: 'annotation-multi-arrows' },
        { uri: 'k8v://docs/examples/algo-run', name: 'algo-run' },
        { uri: 'k8v://docs/examples/bulk-edit-call', name: 'bulk-edit-call' },
        { uri: 'k8v://docs/examples/bulk-edit-retry', name: 'bulk-edit-retry' },
        { uri: 'k8v://docs/examples/graph-query', name: 'graph-query' },
      ],
    }),
    complete: {
      topic: async () => [
        'annotation-board',
        'annotation-arrows',
        'annotation-multi-arrows',
        'algo-run',
        'bulk-edit-call',
        'bulk-edit-retry',
        'graph-query',
      ],
    },
  });

  server.registerResource(
    'workflow-examples',
    examplesTemplate,
    {
      title: 'Workflow Examples',
      description: 'Topic-specific MCP usage examples for k8v graph workflows.',
      mimeType: 'text/markdown',
    },
    async (uri, variables) => {
      const topic = typeof variables.topic === 'string' ? variables.topic : uri.pathname.replace(/^\//, '');
      return createTextResource(uri.toString(), buildExampleText(topic as ExampleTopic));
    }
  );
}
