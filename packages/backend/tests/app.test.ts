import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { AddressInfo } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { createApp } from '../src/app.ts';
import { DataStore } from '../src/core/DataStore.ts';
import { NodeExecutor } from '../src/core/NodeExecutor.ts';
import { GraphEngine } from '../src/core/GraphEngine.ts';
import {
  buildGraphCommandsFromGraphUpdate,
  buildGraphCommandsFromSnapshotChange,
  type GraphCommand,
} from '../../domain/dist/index.js';

interface AppTestContext {
  baseUrl: string;
  dataStore: DataStore;
  close: () => Promise<void>;
}

const AUTOTEST_GRAPH_PREFIX = 'autotests_';
const PNG_4X4_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAIUlEQVR4AVXBMQ0AIAADsJJM1mTjD+61h/uKoogaUSNqfK+QAylVq4ulAAAAAElFTkSuQmCC';

function toAutotestGraphName(name: string): string {
  return name.startsWith(AUTOTEST_GRAPH_PREFIX)
    ? name
    : `${AUTOTEST_GRAPH_PREFIX}${name}`;
}

function createValidInlineNode() {
  return {
    id: 'node-1',
    type: 'inline_code',
    position: { x: 0, y: 0 },
    metadata: {
      name: 'Inline',
      inputs: [],
      outputs: [{ name: 'output', schema: { type: 'number' } }],
    },
    config: {
      type: 'inline_code',
      code: 'outputs.output = 1;',
      runtime: 'javascript_vm',
    },
    version: '1',
  };
}

function createPassThroughNode(id: string) {
  return {
    id,
    type: 'inline_code',
    position: { x: 0, y: 0 },
    metadata: {
      name: `Node ${id}`,
      inputs: [{ name: 'input', schema: { type: 'number' } }],
      outputs: [{ name: 'output', schema: { type: 'number' } }],
    },
    config: {
      type: 'inline_code',
      code: 'outputs.output = inputs.input;',
      runtime: 'javascript_vm',
    },
    version: '1',
  };
}

function createNumericInputNode(id: string, value: number) {
  return {
    id,
    type: 'numeric_input',
    position: { x: 0, y: 0 },
    metadata: {
      name: `Numeric ${id}`,
      inputs: [],
      outputs: [{ name: 'value', schema: { type: 'number' } }],
    },
    config: {
      type: 'numeric_input',
      config: {
        value,
        min: 0,
        max: 100,
        step: 1,
      },
    },
    version: '1',
  };
}

function createAnnotationNode(id: string) {
  return {
    id,
    type: 'annotation',
    position: { x: 0, y: 0 },
    metadata: {
      name: `Annotation ${id}`,
      inputs: [],
      outputs: [],
    },
    config: {
      type: 'annotation',
      config: {
        text: '# Note',
        backgroundColor: '#fef3c7',
        fontColor: '#1f2937',
      },
    },
    version: '1',
  };
}

function createPngGraphicsNode(id: string) {
  return {
    id,
    type: 'inline_code',
    position: { x: 0, y: 0 },
    metadata: {
      name: `Graphics ${id}`,
      inputs: [],
      outputs: [],
    },
    config: {
      type: 'inline_code',
      runtime: 'javascript_vm',
      code: `outputGraphics("data:image/png;base64,${PNG_4X4_BASE64}");`,
    },
    version: '1',
  };
}

async function setupTestServer(): Promise<AppTestContext> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'k8v-app-test-'));
  const dataStore = new DataStore(':memory:', tmpDir);
  const nodeExecutor = new NodeExecutor(dataStore);
  const graphEngine = new GraphEngine(dataStore, nodeExecutor);
  const app = createApp({ dataStore, graphEngine });
  const server = app.listen(0);
  const port = (server.address() as AddressInfo).port;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    dataStore,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await graphEngine.dispose();
      dataStore.close();
      await fs.rm(tmpDir, { recursive: true, force: true });
    },
  };
}

function toCreateGraphPayload(payload?: Record<string, unknown>) {
  const requestedName = typeof payload?.name === 'string'
    ? payload.name
    : 'runtime_graph';
  return {
    name: toAutotestGraphName(requestedName),
  };
}

function toGraphSeedPayload(payload?: Record<string, unknown>) {
  if (!payload) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(payload).filter(([key]) => key !== 'name')
  );
}

async function createGraph(baseUrl: string, payload?: Record<string, unknown>) {
  const createResponse = await fetch(`${baseUrl}/api/graphs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(toCreateGraphPayload(payload)),
  });

  if (createResponse.status !== 200) {
    return createResponse;
  }

  const seedPayload = toGraphSeedPayload(payload);
  if (Object.keys(seedPayload).length === 0) {
    return createResponse;
  }

  const createdGraph = await createResponse.json();
  const currentGraph = await fetchGraph(baseUrl, createdGraph.id);
  const commands = buildGraphCommandsFromGraphUpdate(seedPayload);
  if (commands.length === 0) {
    return new Response(JSON.stringify(currentGraph), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }

  const seedResponse = await submitGraphCommands(
    baseUrl,
    createdGraph.id,
    currentGraph.revision ?? 0,
    commands
  );
  if (seedResponse.status !== 200) {
    return seedResponse;
  }

  const seededGraph = await fetchGraph(baseUrl, createdGraph.id);
  return new Response(JSON.stringify(seededGraph), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

async function fetchGraph(baseUrl: string, graphId: string) {
  const response = await fetch(`${baseUrl}/api/graphs/${graphId}`);
  assert.equal(response.status, 200);
  return response.json();
}

async function submitGraphCommands(
  baseUrl: string,
  graphId: string,
  baseRevision: number,
  commands: GraphCommand[],
  options: { noRecompute?: boolean } = {}
) {
  const query = options.noRecompute ? '?noRecompute=true' : '';
  const response = await fetch(`${baseUrl}/api/graphs/${graphId}/commands${query}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      baseRevision,
      commands,
    }),
  });
  return response;
}

async function computeNode(baseUrl: string, graphId: string, nodeId: string) {
  const graph = await fetchGraph(baseUrl, graphId);
  const response = await submitGraphCommands(baseUrl, graphId, graph.revision ?? 0, [
    { kind: 'compute_node', nodeId },
  ]);
  return response;
}

async function computeGraph(baseUrl: string, graphId: string) {
  const graph = await fetchGraph(baseUrl, graphId);
  const response = await submitGraphCommands(baseUrl, graphId, graph.revision ?? 0, [
    { kind: 'compute_graph' },
  ]);
  return response;
}

async function updateGraphWithCommands(
  baseUrl: string,
  graphId: string,
  mutate: (graph: any) => any,
  options: { noRecompute?: boolean } = {}
) {
  const currentGraph = await fetchGraph(baseUrl, graphId);
  const nextGraph = mutate(structuredClone(currentGraph));
  const commands = buildGraphCommandsFromSnapshotChange(currentGraph, nextGraph);
  return submitGraphCommands(
    baseUrl,
    graphId,
    currentGraph.revision ?? 0,
    commands,
    options
  );
}

async function fetchRuntimeState(baseUrl: string, graphId: string) {
  const response = await fetch(`${baseUrl}/api/graphs/${graphId}/runtime-state`);
  return response;
}

async function waitForRuntimeIdle(
  baseUrl: string,
  graphId: string,
  attempts = 60,
  delayMs = 20
): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const statusResponse = await fetchRuntimeState(baseUrl, graphId);
    assert.equal(statusResponse.status, 200);
    const status = await statusResponse.json();
    const nodeStates = status.nodeStates ?? {};
    const hasActiveWork =
      status.queueLength > 0 ||
      Object.values(nodeStates).some((state: any) => state?.isPending || state?.isComputing);
    if (!hasActiveWork) {
      return;
    }
    await delay(delayMs);
  }
}

function createSampleDrawing(id: string) {
  return {
    id,
    name: `Drawing ${id}`,
    position: { x: 100, y: 120 },
    paths: [
      {
        id: `${id}-path-1`,
        color: 'green',
        thickness: 3,
        points: [
          { x: 0, y: 0 },
          { x: 20, y: 10 },
        ],
      },
    ],
  };
}

function createLargeDrawing(id: string, pointCount = 12_000) {
  return {
    id,
    name: `Large Drawing ${id}`,
    position: { x: 80, y: 90 },
    paths: [
      {
        id: `${id}-path-1`,
        color: 'white',
        thickness: 3,
        points: Array.from({ length: pointCount }, (_value, index) => ({
          x: index % 480,
          y: Math.floor(index / 480),
        })),
      },
    ],
  };
}

function resolveBrightness(color: string): number {
  const r = Number.parseInt(color.slice(1, 3), 16);
  const g = Number.parseInt(color.slice(3, 5), 16);
  const b = Number.parseInt(color.slice(5, 7), 16);
  return (0.299 * r) + (0.587 * g) + (0.114 * b);
}

test('POST /api/graphs creates an empty graph and accepts only name payload', async () => {
  const ctx = await setupTestServer();

  try {
    const response = await createGraph(ctx.baseUrl);
    assert.equal(response.status, 200);
    const graph = await response.json();
    assert.equal(graph.nodes.length, 0);
    assert.equal(graph.connections.length, 0);
    assert.equal(typeof graph.name, 'string');
    assert.ok(graph.name.startsWith(AUTOTEST_GRAPH_PREFIX));

    const invalidResponse = await fetch(`${ctx.baseUrl}/api/graphs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: toAutotestGraphName('invalid-create-payload'),
        nodes: [createValidInlineNode()],
      }),
    });
    assert.equal(invalidResponse.status, 400);
  } finally {
    await ctx.close();
  }
});

test('POST /api/graphs/:id/commands accepts initial card dimensions on add-node commands', async () => {
  const ctx = await setupTestServer();

  try {
    const createResponse = await createGraph(ctx.baseUrl);
    assert.equal(createResponse.status, 200);
    const createdGraph = await createResponse.json();

    const updateResponse = await submitGraphCommands(
      ctx.baseUrl,
      createdGraph.id,
      createdGraph.revision ?? 0,
      [
        {
          kind: 'node_add_inline',
          nodeId: 'inline-1',
          name: 'Inline Sized',
          x: 80,
          y: 120,
          code: 'outputs.output = 1;',
          cardWidth: 420,
          cardHeight: 180,
        },
        {
          kind: 'node_add_numeric_input',
          nodeId: 'numeric-1',
          name: 'Numeric Sized',
          x: 360,
          y: 120,
          value: 7,
          cardWidth: 340,
          cardHeight: 150,
        },
        {
          kind: 'node_add_annotation',
          nodeId: 'annotation-1',
          name: 'Annotation Sized',
          x: 620,
          y: 120,
          text: 'Sized note',
          cardWidth: 460,
          cardHeight: 240,
        },
      ] as GraphCommand[]
    );
    assert.equal(updateResponse.status, 200);
    const updatedGraph = (await updateResponse.json()).graph;

    const inlineNode = updatedGraph.nodes.find((node: any) => node.id === 'inline-1');
    const numericNode = updatedGraph.nodes.find((node: any) => node.id === 'numeric-1');
    const annotationNode = updatedGraph.nodes.find((node: any) => node.id === 'annotation-1');
    const defaultProjection = updatedGraph.projections.find((projection: any) => projection.id === 'default');

    assert.ok(inlineNode);
    assert.ok(numericNode);
    assert.ok(annotationNode);
    assert.ok(defaultProjection);
    assert.equal(inlineNode.config?.config?.cardWidth, 420);
    assert.equal(inlineNode.config?.config?.cardHeight, 180);
    assert.equal(numericNode.config?.config?.cardWidth, 340);
    assert.equal(numericNode.config?.config?.cardHeight, 150);
    assert.equal(annotationNode.config?.config?.cardWidth, 460);
    assert.equal(annotationNode.config?.config?.cardHeight, 240);
    assert.equal(defaultProjection.nodeCardSizes['inline-1'].width, 420);
    assert.equal(defaultProjection.nodeCardSizes['inline-1'].height, 180);
    assert.equal(defaultProjection.nodeCardSizes['numeric-1'].width, 340);
    assert.equal(defaultProjection.nodeCardSizes['numeric-1'].height, 150);
    assert.equal(defaultProjection.nodeCardSizes['annotation-1'].width, 460);
    assert.equal(defaultProjection.nodeCardSizes['annotation-1'].height, 240);
  } finally {
    await ctx.close();
  }
});

test('POST /api/graphs accepts python_process runtime in node config', async () => {
  const ctx = await setupTestServer();

  try {
    const node = createValidInlineNode();
    node.config.runtime = 'python_process';
    node.config.code = 'outputs.output = inputs.input * 2';
    node.metadata.inputs = [{ name: 'input', schema: { type: 'number' } }];

    const response = await createGraph(ctx.baseUrl, {
      nodes: [node],
    });
    assert.equal(response.status, 200);
    const graph = await response.json();
    assert.equal(graph.nodes[0].config.runtime, 'python_process');
  } finally {
    await ctx.close();
  }
});

test('POST /api/graphs rejects legacy library node payloads', async () => {
  const ctx = await setupTestServer();

  try {
    const legacyLibraryNode = {
      id: 'library-1',
      type: 'library',
      position: { x: 0, y: 0 },
      metadata: {
        name: 'Legacy Library',
        inputs: [],
        outputs: [],
      },
      config: {
        type: 'library',
      },
      version: '1',
    };

    const response = await createGraph(ctx.baseUrl, {
      nodes: [legacyLibraryNode],
    });
    assert.equal(response.status, 400);
  } finally {
    await ctx.close();
  }
});

test('library node manifest API is not exposed', async () => {
  const ctx = await setupTestServer();

  try {
    const response = await fetch(`${ctx.baseUrl}/api/library-nodes`);
    assert.equal(response.status, 404);
  } finally {
    await ctx.close();
  }
});

test('POST /api/graphs accepts numeric_input nodes and command compute returns numeric value', async () => {
  const ctx = await setupTestServer();

  try {
    const numericNode = createNumericInputNode('numeric-1', 42);
    const createResponse = await createGraph(ctx.baseUrl, {
      nodes: [numericNode],
    });
    assert.equal(createResponse.status, 200);
    const createdGraph = await createResponse.json();
    assert.equal(createdGraph.nodes[0].type, 'numeric_input');

    const computeResponse = await computeNode(ctx.baseUrl, createdGraph.id, 'numeric-1');
    assert.equal(computeResponse.status, 200);
    const commandResponse = await computeResponse.json();
    const result = commandResponse.runtimeState.results['numeric-1'];
    assert.equal(result.outputs.value, 42);
  } finally {
    await ctx.close();
  }
});

test('annotation nodes are accepted and are non-executable via command compute', async () => {
  const ctx = await setupTestServer();

  try {
    const annotationNode = createAnnotationNode('annotation-1');
    const createResponse = await createGraph(ctx.baseUrl, {
      nodes: [annotationNode],
    });
    assert.equal(createResponse.status, 200);
    const createdGraph = await createResponse.json();
    assert.equal(createdGraph.nodes[0].type, 'annotation');

    const computeResponse = await computeNode(ctx.baseUrl, createdGraph.id, 'annotation-1');
    assert.equal(computeResponse.status, 500);
    const body = await computeResponse.json();
    assert.match(String(body.error ?? ''), /not executable/i);
  } finally {
    await ctx.close();
  }
});

test('presentation-only connections preserve anchors and are excluded from DAG validation', async () => {
  const ctx = await setupTestServer();

  try {
    const sourceNode = createPassThroughNode('node-1');
    const targetNode = createPassThroughNode('node-2');
    const createResponse = await createGraph(ctx.baseUrl, {
      nodes: [sourceNode, targetNode],
      connections: [
        {
          id: 'c1',
          sourceNodeId: 'node-1',
          sourcePort: '__annotation__',
          sourceAnchor: {
            side: 'bottom',
            offset: 0.25,
          },
          targetNodeId: 'node-2',
          targetPort: '__annotation__',
          targetAnchor: {
            side: 'top',
            offset: 0.75,
          },
        },
        {
          id: 'c2',
          sourceNodeId: 'node-2',
          sourcePort: '__annotation__',
          sourceAnchor: {
            side: 'left',
            offset: 0.5,
          },
          targetNodeId: 'node-1',
          targetPort: '__annotation__',
          targetAnchor: {
            side: 'right',
            offset: 0.25,
          },
        },
      ],
    });
    assert.equal(createResponse.status, 200);
    const createdGraph = await createResponse.json();

    assert.equal(createdGraph.connections.length, 2);
    const sourceToTarget = createdGraph.connections.find((connection: any) => connection.id === 'c1');
    const targetToSource = createdGraph.connections.find((connection: any) => connection.id === 'c2');
    assert.deepEqual(sourceToTarget?.sourceAnchor, {
      side: 'bottom',
      offset: 0.25,
    });
    assert.deepEqual(sourceToTarget?.targetAnchor, {
      side: 'top',
      offset: 0.75,
    });
    assert.deepEqual(targetToSource?.sourceAnchor, {
      side: 'left',
      offset: 0.5,
    });
  } finally {
    await ctx.close();
  }
});

test('POST /api/graphs/:id/commands performs manual recompute even when node version is unchanged', async () => {
  const ctx = await setupTestServer();

  try {
    const createResponse = await createGraph(ctx.baseUrl, {
      nodes: [createValidInlineNode()],
    });
    assert.equal(createResponse.status, 200);
    const createdGraph = await createResponse.json();

    const firstComputeResponse = await computeNode(ctx.baseUrl, createdGraph.id, 'node-1');
    assert.equal(firstComputeResponse.status, 200);
    const firstCommandResponse = await firstComputeResponse.json();
    const firstResult = firstCommandResponse.runtimeState.results['node-1'];
    assert.equal(firstResult.outputs.output, 1);

    await delay(5);

    const secondComputeResponse = await computeNode(ctx.baseUrl, createdGraph.id, 'node-1');
    assert.equal(secondComputeResponse.status, 200);
    const secondCommandResponse = await secondComputeResponse.json();
    const secondResult = secondCommandResponse.runtimeState.results['node-1'];
    assert.equal(secondResult.outputs.output, 1);

    assert.equal(typeof firstResult.timestamp, 'number');
    assert.equal(typeof secondResult.timestamp, 'number');
    assert.ok(
      secondResult.timestamp > firstResult.timestamp,
      `expected second manual recompute timestamp (${secondResult.timestamp}) to be newer than first (${firstResult.timestamp})`
    );
  } finally {
    await ctx.close();
  }
});

test('POST /api/graphs applies default graph execution timeout', async () => {
  const ctx = await setupTestServer();

  try {
    const response = await createGraph(ctx.baseUrl, {
      nodes: [createValidInlineNode()],
    });
    assert.equal(response.status, 200);
    const graph = await response.json();
    assert.equal(graph.executionTimeoutMs, 30_000);
  } finally {
    await ctx.close();
  }
});

test('POST /api/graphs/:id/commands persists graph execution timeout and allows large values', async () => {
  const ctx = await setupTestServer();

  try {
    const createResponse = await createGraph(ctx.baseUrl, {
      nodes: [createValidInlineNode()],
    });
    assert.equal(createResponse.status, 200);
    const createdGraph = await createResponse.json();
    assert.equal(createdGraph.executionTimeoutMs, 30_000);

    const updateResponse = await updateGraphWithCommands(ctx.baseUrl, createdGraph.id, (graph) => ({
      ...graph,
      executionTimeoutMs: 100_000_000,
    }));
    assert.equal(updateResponse.status, 200);
    const updatedGraph = (await updateResponse.json()).graph;
    assert.equal(updatedGraph.executionTimeoutMs, 100_000_000);
  } finally {
    await ctx.close();
  }
});

test('POST /api/graphs/:id/query returns lightweight overview fields by default', async () => {
  const ctx = await setupTestServer();

  try {
    const sourceNode = createValidInlineNode();
    sourceNode.id = 'node-a';
    sourceNode.metadata.name = 'Source A';

    const targetNode = createPassThroughNode('node-b');
    targetNode.metadata.name = 'Target B';

    const createResponse = await createGraph(ctx.baseUrl, {
      nodes: [sourceNode, targetNode],
      connections: [
        {
          id: 'conn-ab',
          sourceNodeId: 'node-a',
          sourcePort: 'output',
          targetNodeId: 'node-b',
          targetPort: 'input',
        },
      ],
    });
    assert.equal(createResponse.status, 200);
    const createdGraph = await createResponse.json();

    const queryResponse = await fetch(`${ctx.baseUrl}/api/graphs/${createdGraph.id}/query`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operation: 'overview' }),
    });
    assert.equal(queryResponse.status, 200);
    const query = await queryResponse.json();

    assert.equal(query.operation, 'overview');
    assert.deepEqual(query.nodeFields, ['id', 'name']);
    assert.deepEqual(query.connectionFields, [
      'sourceNodeId',
      'targetNodeId',
      'sourcePort',
      'targetPort',
    ]);
    assert.deepEqual(query.nodes, [
      { id: 'node-a', name: 'Source A' },
      { id: 'node-b', name: 'Target B' },
    ]);
    assert.deepEqual(query.connections, [
      {
        sourceNodeId: 'node-a',
        targetNodeId: 'node-b',
        sourcePort: 'output',
        targetPort: 'input',
      },
    ]);
  } finally {
    await ctx.close();
  }
});

test('POST /api/graphs/:id/query always includes connection source/target node ids', async () => {
  const ctx = await setupTestServer();

  try {
    const sourceNode = createValidInlineNode();
    sourceNode.id = 'node-a';
    sourceNode.metadata.name = 'Source A';

    const targetNode = createPassThroughNode('node-b');
    targetNode.metadata.name = 'Target B';

    const createResponse = await createGraph(ctx.baseUrl, {
      nodes: [sourceNode, targetNode],
      connections: [
        {
          id: 'conn-ab',
          sourceNodeId: 'node-a',
          sourcePort: 'output',
          targetNodeId: 'node-b',
          targetPort: 'input',
        },
      ],
    });
    assert.equal(createResponse.status, 200);
    const createdGraph = await createResponse.json();

    const queryResponse = await fetch(`${ctx.baseUrl}/api/graphs/${createdGraph.id}/query`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        operation: 'overview',
        connectionFields: ['sourcePort', 'targetPort'],
      }),
    });
    assert.equal(queryResponse.status, 200);
    const query = await queryResponse.json();

    assert.deepEqual(query.connectionFields, [
      'sourceNodeId',
      'targetNodeId',
      'sourcePort',
      'targetPort',
    ]);
    assert.deepEqual(query.connections, [
      {
        sourceNodeId: 'node-a',
        targetNodeId: 'node-b',
        sourcePort: 'output',
        targetPort: 'input',
      },
    ]);
  } finally {
    await ctx.close();
  }
});

test('POST /api/graphs/:id/query can project annotation text, position, card size, and config', async () => {
  const ctx = await setupTestServer();

  try {
    const annotationNode = createAnnotationNode('annotation-query');
    annotationNode.position = { x: 320, y: 180 };
    annotationNode.config.config = {
      ...annotationNode.config.config,
      text: '## Query me',
      cardWidth: 360,
      cardHeight: 220,
      borderColor: '#334155',
    };

    const createResponse = await createGraph(ctx.baseUrl, {
      nodes: [annotationNode],
    });
    assert.equal(createResponse.status, 200);
    const createdGraph = await createResponse.json();

    const queryResponse = await fetch(`${ctx.baseUrl}/api/graphs/${createdGraph.id}/query`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        operation: 'overview',
        nodeFields: ['id', 'type', 'position', 'annotationText', 'cardSize', 'config'],
      }),
    });
    assert.equal(queryResponse.status, 200);
    const query = await queryResponse.json();

    assert.deepEqual(query.nodeFields, ['id', 'type', 'position', 'annotationText', 'cardSize', 'config']);
    assert.deepEqual(query.nodes, [
      {
        id: 'annotation-query',
        type: 'annotation',
        position: { x: 320, y: 180 },
        annotationText: '## Query me',
        cardSize: { width: 360, height: 220 },
        config: annotationNode.config,
      },
    ]);
  } finally {
    await ctx.close();
  }
});

test('POST /api/graphs/:id/query supports BFS traversal with optional depth', async () => {
  const ctx = await setupTestServer();

  try {
    const nodeA = createValidInlineNode();
    nodeA.id = 'node-a';
    nodeA.metadata.name = 'A';

    const nodeB = createPassThroughNode('node-b');
    nodeB.metadata.name = 'B';
    const nodeC = createPassThroughNode('node-c');
    nodeC.metadata.name = 'C';
    const nodeD = createPassThroughNode('node-d');
    nodeD.metadata.name = 'D';
    const nodeE = createPassThroughNode('node-e');
    nodeE.metadata.name = 'E';

    const createResponse = await createGraph(ctx.baseUrl, {
      nodes: [nodeA, nodeB, nodeC, nodeD, nodeE],
      connections: [
        {
          id: 'conn-ab',
          sourceNodeId: 'node-a',
          sourcePort: 'output',
          targetNodeId: 'node-b',
          targetPort: 'input',
        },
        {
          id: 'conn-ac',
          sourceNodeId: 'node-a',
          sourcePort: 'output',
          targetNodeId: 'node-c',
          targetPort: 'input',
        },
        {
          id: 'conn-bd',
          sourceNodeId: 'node-b',
          sourcePort: 'output',
          targetNodeId: 'node-d',
          targetPort: 'input',
        },
        {
          id: 'conn-ce',
          sourceNodeId: 'node-c',
          sourcePort: 'output',
          targetNodeId: 'node-e',
          targetPort: 'input',
        },
      ],
    });
    assert.equal(createResponse.status, 200);
    const createdGraph = await createResponse.json();

    const queryResponse = await fetch(`${ctx.baseUrl}/api/graphs/${createdGraph.id}/query`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        operation: 'traverse_bfs',
        startNodeIds: ['node-a'],
        depth: 1,
        nodeFields: ['id'],
        connectionFields: ['sourceNodeId', 'targetNodeId'],
      }),
    });
    assert.equal(queryResponse.status, 200);
    const query = await queryResponse.json();

    assert.equal(query.operation, 'traverse_bfs');
    assert.deepEqual(query.startNodeIds, ['node-a']);
    assert.equal(query.depth, 1);
    assert.deepEqual(
      query.nodes.map((node: { id: string }) => node.id),
      ['node-a', 'node-b', 'node-c']
    );
    assert.deepEqual(query.connections, [
      { sourceNodeId: 'node-a', targetNodeId: 'node-b' },
      { sourceNodeId: 'node-a', targetNodeId: 'node-c' },
    ]);
  } finally {
    await ctx.close();
  }
});

test('POST /api/graphs/:id/query traverses presentation-linked nodes and returns anchor fields', async () => {
  const ctx = await setupTestServer();

  try {
    const sourceNode = createPassThroughNode('node-a');
    sourceNode.metadata.name = 'Source';
    const inlineNode = createPassThroughNode('node-b');
    inlineNode.metadata.name = 'Inline';
    const targetNode = createPassThroughNode('node-c');
    targetNode.metadata.name = 'Target';

    const createResponse = await createGraph(ctx.baseUrl, {
      nodes: [sourceNode, inlineNode, targetNode],
      connections: [
        {
          id: 'conn-annotation-inline',
          sourceNodeId: 'node-a',
          sourcePort: '__annotation__',
          sourceAnchor: {
            side: 'bottom',
            offset: 0.25,
          },
          targetNodeId: 'node-b',
          targetPort: '__annotation__',
          targetAnchor: {
            side: 'top',
            offset: 0.75,
          },
        },
        {
          id: 'conn-inline-annotation',
          sourceNodeId: 'node-b',
          sourcePort: '__annotation__',
          sourceAnchor: {
            side: 'right',
            offset: 0.5,
          },
          targetNodeId: 'node-c',
          targetPort: '__annotation__',
          targetAnchor: {
            side: 'left',
            offset: 0.5,
          },
        },
      ],
    });
    assert.equal(createResponse.status, 200);
    const createdGraph = await createResponse.json();

    const queryResponse = await fetch(`${ctx.baseUrl}/api/graphs/${createdGraph.id}/query`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        operation: 'traverse_bfs',
        startNodeIds: ['node-a'],
        nodeFields: ['id', 'type'],
        connectionFields: [
          'id',
          'sourceNodeId',
          'sourcePort',
          'sourceAnchor',
          'targetNodeId',
          'targetPort',
          'targetAnchor',
        ],
      }),
    });
    assert.equal(queryResponse.status, 200);
    const query = await queryResponse.json();

    assert.deepEqual(query.nodes, [
      { id: 'node-a', type: 'inline_code' },
      { id: 'node-b', type: 'inline_code' },
      { id: 'node-c', type: 'inline_code' },
    ]);
    assert.deepEqual(query.connections, [
      {
        id: 'conn-annotation-inline',
        sourceNodeId: 'node-a',
        sourcePort: '__annotation__',
        sourceAnchor: {
          side: 'bottom',
          offset: 0.25,
        },
        targetNodeId: 'node-b',
        targetPort: '__annotation__',
        targetAnchor: {
          side: 'top',
          offset: 0.75,
        },
      },
      {
        id: 'conn-inline-annotation',
        sourceNodeId: 'node-b',
        sourcePort: '__annotation__',
        sourceAnchor: {
          side: 'right',
          offset: 0.5,
        },
        targetNodeId: 'node-c',
        targetPort: '__annotation__',
        targetAnchor: {
          side: 'left',
          offset: 0.5,
        },
      },
    ]);
  } finally {
    await ctx.close();
  }
});

test('POST /api/graphs/:id/query supports DFS traversal with max node limit', async () => {
  const ctx = await setupTestServer();

  try {
    const nodeA = createValidInlineNode();
    nodeA.id = 'node-a';
    nodeA.metadata.name = 'A';

    const nodeB = createPassThroughNode('node-b');
    nodeB.metadata.name = 'B';
    const nodeC = createPassThroughNode('node-c');
    nodeC.metadata.name = 'C';
    const nodeD = createPassThroughNode('node-d');
    nodeD.metadata.name = 'D';
    const nodeE = createPassThroughNode('node-e');
    nodeE.metadata.name = 'E';

    const createResponse = await createGraph(ctx.baseUrl, {
      nodes: [nodeA, nodeB, nodeC, nodeD, nodeE],
      connections: [
        {
          id: 'conn-ab',
          sourceNodeId: 'node-a',
          sourcePort: 'output',
          targetNodeId: 'node-b',
          targetPort: 'input',
        },
        {
          id: 'conn-bd',
          sourceNodeId: 'node-b',
          sourcePort: 'output',
          targetNodeId: 'node-d',
          targetPort: 'input',
        },
        {
          id: 'conn-ac',
          sourceNodeId: 'node-a',
          sourcePort: 'output',
          targetNodeId: 'node-c',
          targetPort: 'input',
        },
        {
          id: 'conn-ce',
          sourceNodeId: 'node-c',
          sourcePort: 'output',
          targetNodeId: 'node-e',
          targetPort: 'input',
        },
      ],
    });
    assert.equal(createResponse.status, 200);
    const createdGraph = await createResponse.json();

    const queryResponse = await fetch(`${ctx.baseUrl}/api/graphs/${createdGraph.id}/query`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        operation: 'traverse_dfs',
        startNodeIds: ['node-a'],
        maxNodes: 3,
        nodeFields: ['id'],
        connectionFields: ['sourceNodeId', 'targetNodeId'],
      }),
    });
    assert.equal(queryResponse.status, 200);
    const query = await queryResponse.json();

    assert.equal(query.operation, 'traverse_dfs');
    assert.equal(query.maxNodes, 3);
    assert.deepEqual(
      query.nodes.map((node: { id: string }) => node.id),
      ['node-a', 'node-b', 'node-d']
    );
    assert.deepEqual(query.connections, [
      { sourceNodeId: 'node-a', targetNodeId: 'node-b' },
      { sourceNodeId: 'node-b', targetNodeId: 'node-d' },
    ]);
  } finally {
    await ctx.close();
  }
});

test('POST /api/graphs/:id/query returns starting vertices with no downstream connections', async () => {
  const ctx = await setupTestServer();

  try {
    const nodeA = createValidInlineNode();
    nodeA.id = 'node-a';
    nodeA.metadata.name = 'A';
    const nodeB = createPassThroughNode('node-b');
    nodeB.metadata.name = 'B';
    const nodeC = createPassThroughNode('node-c');
    nodeC.metadata.name = 'C';
    const nodeD = createPassThroughNode('node-d');
    nodeD.metadata.name = 'D';

    const createResponse = await createGraph(ctx.baseUrl, {
      nodes: [nodeA, nodeB, nodeC, nodeD],
      connections: [
        {
          id: 'conn-ab',
          sourceNodeId: 'node-a',
          sourcePort: 'output',
          targetNodeId: 'node-b',
          targetPort: 'input',
        },
        {
          id: 'conn-bd',
          sourceNodeId: 'node-b',
          sourcePort: 'output',
          targetNodeId: 'node-d',
          targetPort: 'input',
        },
      ],
    });
    assert.equal(createResponse.status, 200);
    const createdGraph = await createResponse.json();

    const queryResponse = await fetch(`${ctx.baseUrl}/api/graphs/${createdGraph.id}/query`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        operation: 'starting_vertices',
        nodeFields: ['id'],
      }),
    });
    assert.equal(queryResponse.status, 200);
    const query = await queryResponse.json();

    assert.equal(query.operation, 'starting_vertices');
    assert.deepEqual(query.nodes, [{ id: 'node-c' }, { id: 'node-d' }]);
  } finally {
    await ctx.close();
  }
});

test('POST /api/graphs/:id/query rejects missing traversal start nodes', async () => {
  const ctx = await setupTestServer();

  try {
    const createResponse = await createGraph(ctx.baseUrl, {
      nodes: [createValidInlineNode()],
      connections: [],
    });
    assert.equal(createResponse.status, 200);
    const createdGraph = await createResponse.json();

    const queryResponse = await fetch(`${ctx.baseUrl}/api/graphs/${createdGraph.id}/query`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        operation: 'traverse_bfs',
        startNodeIds: ['missing-node'],
      }),
    });
    assert.equal(queryResponse.status, 400);
    const body = await queryResponse.json();
    assert.match(String(body.error ?? ''), /missing-node/);
  } finally {
    await ctx.close();
  }
});

test('POST /api/graphs applies default canvas background settings', async () => {
  const ctx = await setupTestServer();

  try {
    const response = await createGraph(ctx.baseUrl, {
      nodes: [createValidInlineNode()],
    });
    assert.equal(response.status, 200);
    const graph = await response.json();
    assert.deepEqual(graph.canvasBackground, {
      mode: 'gradient',
      baseColor: '#1d437e',
    });
  } finally {
    await ctx.close();
  }
});

test('POST /api/graphs applies default connection stroke settings', async () => {
  const ctx = await setupTestServer();

  try {
    const response = await createGraph(ctx.baseUrl, {
      nodes: [createValidInlineNode()],
    });
    assert.equal(response.status, 200);
    const graph = await response.json();
    assert.deepEqual(graph.connectionStroke, {
      foregroundColor: '#334155',
      backgroundColor: '#cbd5e1',
      foregroundWidth: 1,
      backgroundWidth: 2,
    });
  } finally {
    await ctx.close();
  }
});

test('POST /api/graphs/:id/commands normalizes and persists connection stroke settings', async () => {
  const ctx = await setupTestServer();

  try {
    const createResponse = await createGraph(ctx.baseUrl, {
      connectionStroke: {
        foregroundColor: '#334455',
        backgroundColor: '#334455',
        foregroundWidth: 1.5,
        backgroundWidth: 9,
      },
    });
    assert.equal(createResponse.status, 200);
    const createdGraph = await createResponse.json();
    assert.equal(createdGraph.connectionStroke.foregroundColor, '#334455');
    assert.equal(createdGraph.connectionStroke.foregroundWidth, 1.5);
    assert.equal(createdGraph.connectionStroke.backgroundWidth, 3);
    assert.ok(
      Math.abs(
        resolveBrightness(createdGraph.connectionStroke.foregroundColor) -
        resolveBrightness(createdGraph.connectionStroke.backgroundColor)
      ) >= 24
    );

    const updateResponse = await updateGraphWithCommands(
      ctx.baseUrl,
      createdGraph.id,
      (graph) => ({
        ...graph,
        connectionStroke: {
          foregroundColor: '#204060',
          backgroundColor: '#204060',
          foregroundWidth: 2.25,
          backgroundWidth: 11,
        },
      })
    );

    assert.equal(updateResponse.status, 200);
    const updatedGraph = (await updateResponse.json()).graph;
    assert.equal(updatedGraph.connectionStroke.foregroundColor, '#204060');
    assert.equal(updatedGraph.connectionStroke.foregroundWidth, 2.25);
    assert.equal(updatedGraph.connectionStroke.backgroundWidth, 4.5);
    assert.ok(
      Math.abs(
        resolveBrightness(updatedGraph.connectionStroke.foregroundColor) -
        resolveBrightness(updatedGraph.connectionStroke.backgroundColor)
      ) >= 24
    );
  } finally {
    await ctx.close();
  }
});

test('POST /api/graphs/:id/commands persists canvas background mode and base color updates', async () => {
  const ctx = await setupTestServer();

  try {
    const createResponse = await createGraph(ctx.baseUrl, {
      canvasBackground: {
        mode: 'solid',
        baseColor: '#204060',
      },
    });
    assert.equal(createResponse.status, 200);
    const createdGraph = await createResponse.json();
    assert.deepEqual(createdGraph.canvasBackground, {
      mode: 'solid',
      baseColor: '#204060',
    });

    const updateResponse = await updateGraphWithCommands(
      ctx.baseUrl,
      createdGraph.id,
      (graph) => ({
        ...graph,
        canvasBackground: {
          mode: 'gradient',
          baseColor: '#4a7ab4',
        },
      })
    );

    assert.equal(updateResponse.status, 200);
    const updatedGraph = (await updateResponse.json()).graph;
    assert.deepEqual(updatedGraph.canvasBackground, {
      mode: 'gradient',
      baseColor: '#4a7ab4',
    });
  } finally {
    await ctx.close();
  }
});

test('POST /api/graphs initializes default projection metadata when omitted', async () => {
  const ctx = await setupTestServer();

  try {
    const response = await createGraph(ctx.baseUrl, {
      nodes: [createValidInlineNode()],
    });
    assert.equal(response.status, 200);
    const graph = await response.json();

    assert.equal(graph.activeProjectionId, 'default');
    assert.ok(Array.isArray(graph.projections));
    assert.equal(graph.projections.length, 1);
    assert.equal(graph.projections[0].id, 'default');
    assert.equal(graph.projections[0].name, 'Default');
    assert.equal(graph.projections[0].nodePositions['node-1'].x, 0);
    assert.equal(graph.projections[0].nodePositions['node-1'].y, 0);
    assert.ok(graph.projections[0].nodeCardSizes['node-1'].width > 0);
    assert.ok(graph.projections[0].nodeCardSizes['node-1'].height > 0);
    assert.deepEqual(graph.projections[0].canvasBackground, {
      mode: 'gradient',
      baseColor: '#1d437e',
    });
  } finally {
    await ctx.close();
  }
});

test('POST /api/graphs initializes default camera metadata when omitted', async () => {
  const ctx = await setupTestServer();

  try {
    const response = await createGraph(ctx.baseUrl, {
      nodes: [createValidInlineNode()],
    });
    assert.equal(response.status, 200);
    const graph = await response.json();

    assert.ok(Array.isArray(graph.cameras));
    assert.equal(graph.cameras.length, 1);
    assert.equal(graph.cameras[0].id, 'default-camera');
    assert.equal(graph.cameras[0].name, 'Default Camera');
    assert.deepEqual(graph.cameras[0].floatingWindows, {});
    assert.equal(graph.cameras[0].viewport, undefined);
  } finally {
    await ctx.close();
  }
});

test('POST /api/graphs/:id/commands preserves the default camera when camera updates would otherwise remove all cameras', async () => {
  const ctx = await setupTestServer();

  try {
    const createResponse = await createGraph(ctx.baseUrl, {
      nodes: [createValidInlineNode()],
    });
    assert.equal(createResponse.status, 200);
    const graph = await createResponse.json();

    const updateResponse = await updateGraphWithCommands(ctx.baseUrl, graph.id, (currentGraph) => ({
      ...currentGraph,
      cameras: [],
    }));

    assert.equal(updateResponse.status, 200);
    const updatedGraph = (await updateResponse.json()).graph;
    assert.deepEqual(updatedGraph.cameras, [
      {
        id: 'default-camera',
        name: 'Default Camera',
        floatingWindows: {},
      },
    ]);
  } finally {
    await ctx.close();
  }
});

test('POST /api/graphs preserves oversized fallback node card dimensions', async () => {
  const ctx = await setupTestServer();

  try {
    const node = createValidInlineNode();
    node.config.config = {
      cardWidth: 20_000,
      cardHeight: 20_000,
    };

    const response = await createGraph(ctx.baseUrl, {
      nodes: [node],
    });
    assert.equal(response.status, 200);
    const graph = await response.json();

    assert.equal(graph.projections[0].nodeCardSizes['node-1'].width, 20_000);
    assert.equal(graph.projections[0].nodeCardSizes['node-1'].height, 20_000);
    assert.equal(graph.nodes[0].config.config.cardWidth, 20_000);
    assert.equal(graph.nodes[0].config.config.cardHeight, 20_000);
  } finally {
    await ctx.close();
  }
});

test('POST /api/graphs/:id/commands recomputes target node after inbound connection changes without manual rename', async () => {
  const ctx = await setupTestServer();

  try {
    const sourceNode = createNumericInputNode('source-node', 5);
    sourceNode.version = 'source-v1';

    const targetNode = createValidInlineNode();
    targetNode.id = 'target-node';
    targetNode.metadata.name = 'Inline Code';
    targetNode.metadata.inputs = [{ name: 'A', schema: { type: 'number' } }];
    targetNode.metadata.outputs = [{ name: 'output', schema: { type: 'number' } }];
    targetNode.config.runtime = 'python_process';
    targetNode.config.code = 'outputs.output = inputs.A + 1';
    targetNode.version = 'target-v1';

    const createResponse = await createGraph(ctx.baseUrl, {
      nodes: [sourceNode, targetNode],
      connections: [],
    });
    assert.equal(createResponse.status, 200);
    const createdGraph = await createResponse.json();

    const computeSourceResponse = await computeNode(ctx.baseUrl, createdGraph.id, 'source-node');
    assert.equal(computeSourceResponse.status, 200);

    const computeTargetBeforeConnectionResponse = await computeNode(ctx.baseUrl, createdGraph.id, 'target-node');
    assert.equal(computeTargetBeforeConnectionResponse.status, 200);
    const beforeConnection = (await computeTargetBeforeConnectionResponse.json()).runtimeState.results['target-node'];
    assert.match(String(beforeConnection.textOutput ?? ''), /Error: A/);

    const currentGraphResponse = await fetch(`${ctx.baseUrl}/api/graphs/${createdGraph.id}`);
    assert.equal(currentGraphResponse.status, 200);
    const currentGraph = await currentGraphResponse.json();
    const targetNodeBeforeUpdate = currentGraph.nodes.find((node: any) => node.id === 'target-node');
    assert.ok(targetNodeBeforeUpdate);

    const updateResponse = await updateGraphWithCommands(
      ctx.baseUrl,
      createdGraph.id,
      (graph) => ({
        ...graph,
        connections: [
          {
            id: 'conn-source-to-target',
            sourceNodeId: 'source-node',
            sourcePort: 'value',
            targetNodeId: 'target-node',
            targetPort: 'A',
          },
        ],
      })
    );
    assert.equal(updateResponse.status, 200);
    const updatedGraph = (await updateResponse.json()).graph;
    const targetNodeAfterUpdate = updatedGraph.nodes.find((node: any) => node.id === 'target-node');
    assert.ok(targetNodeAfterUpdate);
    assert.notEqual(targetNodeAfterUpdate.version, targetNodeBeforeUpdate.version);

    const computeTargetAfterConnectionResponse = await computeNode(ctx.baseUrl, createdGraph.id, 'target-node');
    assert.equal(computeTargetAfterConnectionResponse.status, 200);
    const afterConnection = (await computeTargetAfterConnectionResponse.json()).runtimeState.results['target-node'];
    assert.equal(afterConnection.outputs.output, 6);
    assert.ok(!String(afterConnection.textOutput ?? '').includes('Error: A'));
  } finally {
    await ctx.close();
  }
});

test('runtime state reports graph-level worker concurrency and revision', async () => {
  const ctx = await setupTestServer();

  try {
    const node = createValidInlineNode();
    const createResponse = await createGraph(ctx.baseUrl, {
      nodes: [node],
      recomputeConcurrency: 3,
    });
    assert.equal(createResponse.status, 200);
    const createdGraph = await createResponse.json();
    assert.equal(createdGraph.recomputeConcurrency, 3);

    const statusResponse = await fetchRuntimeState(ctx.baseUrl, createdGraph.id);
    assert.equal(statusResponse.status, 200);
    const status = await statusResponse.json();
    assert.equal(status.workerConcurrency, 3);
    assert.equal(status.revision, createdGraph.revision);

    const updateResponse = await updateGraphWithCommands(ctx.baseUrl, createdGraph.id, (graph) => ({
      ...graph,
      recomputeConcurrency: 2,
    }));
    assert.equal(updateResponse.status, 200);
    const updatedGraph = (await updateResponse.json()).graph;
    assert.equal(updatedGraph.recomputeConcurrency, 2);

    const updatedStatusResponse = await fetchRuntimeState(ctx.baseUrl, createdGraph.id);
    assert.equal(updatedStatusResponse.status, 200);
    const updatedStatus = await updatedStatusResponse.json();
    assert.equal(updatedStatus.workerConcurrency, 2);
    assert.equal(updatedStatus.revision, updatedGraph.revision);
  } finally {
    await ctx.close();
  }
});

test('POST /api/graphs/:id/commands enqueues backend recompute for all impacted descendants', async () => {
  const ctx = await setupTestServer();

  try {
    const rootNode = {
      id: 'node-a',
      type: 'inline_code',
      position: { x: 0, y: 0 },
      metadata: {
        name: 'A',
        inputs: [],
        outputs: [{ name: 'output', schema: { type: 'number' } }],
      },
      config: {
        type: 'inline_code',
        runtime: 'python_process',
        code: 'import time\\ntime.sleep(0.25)\\noutputs.output = 2',
        config: { autoRecompute: true },
      },
      version: 'a-v1',
    };
    const middleNode = {
      id: 'node-b',
      type: 'inline_code',
      position: { x: 200, y: 0 },
      metadata: {
        name: 'B',
        inputs: [{ name: 'input', schema: { type: 'number' } }],
        outputs: [{ name: 'output', schema: { type: 'number' } }],
      },
      config: {
        type: 'inline_code',
        runtime: 'javascript_vm',
        code: 'outputs.output = inputs.input;',
        config: { autoRecompute: true },
      },
      version: 'b-v1',
    };
    const leafNode = {
      id: 'node-c',
      type: 'inline_code',
      position: { x: 400, y: 0 },
      metadata: {
        name: 'C',
        inputs: [{ name: 'input', schema: { type: 'number' } }],
        outputs: [{ name: 'output', schema: { type: 'number' } }],
      },
      config: {
        type: 'inline_code',
        runtime: 'javascript_vm',
        code: 'outputs.output = inputs.input;',
        config: { autoRecompute: true },
      },
      version: 'c-v1',
    };

    const createResponse = await createGraph(ctx.baseUrl, {
      nodes: [rootNode, middleNode, leafNode],
      connections: [
        {
          id: 'ab',
          sourceNodeId: 'node-a',
          sourcePort: 'output',
          targetNodeId: 'node-b',
          targetPort: 'input',
        },
        {
          id: 'bc',
          sourceNodeId: 'node-b',
          sourcePort: 'output',
          targetNodeId: 'node-c',
          targetPort: 'input',
        },
      ],
      recomputeConcurrency: 1,
    });
    assert.equal(createResponse.status, 200);
    const createdGraph = await createResponse.json();

    const updateResponse = await updateGraphWithCommands(ctx.baseUrl, createdGraph.id, (graph) => ({
      ...graph,
      nodes: graph.nodes.map((node: any) =>
          node.id === 'node-a'
            ? {
                ...node,
                version: 'a-v2',
                config: {
                  ...node.config,
                  code: 'import time\\ntime.sleep(0.25)\\noutputs.output = 7',
                },
              }
            : node
        ),
    }));
    assert.equal(updateResponse.status, 200);

    let sawRootActive = false;
    let sawMiddlePending = false;
    let sawLeafPending = false;

    for (let attempt = 0; attempt < 40; attempt += 1) {
      const statusResponse = await fetchRuntimeState(ctx.baseUrl, createdGraph.id);
      assert.equal(statusResponse.status, 200);
      const status = await statusResponse.json();
      const nodeStates = status.nodeStates ?? {};

      const rootState = nodeStates['node-a'];
      const middleState = nodeStates['node-b'];
      const leafState = nodeStates['node-c'];

      if (rootState?.isPending || rootState?.isComputing) {
        sawRootActive = true;
      }
      if (middleState?.isPending) {
        sawMiddlePending = true;
      }
      if (leafState?.isPending) {
        sawLeafPending = true;
      }

      const queueDrained = status.queueLength === 0;
      const noNodeActive = !Object.values(nodeStates).some((state: any) => state?.isPending || state?.isComputing);
      if (queueDrained && noNodeActive) {
        break;
      }

      await delay(30);
    }

    assert.equal(sawRootActive, true);
    assert.equal(sawMiddlePending, true);
    assert.equal(sawLeafPending, true);

    const settledStatusResponse = await fetchRuntimeState(ctx.baseUrl, createdGraph.id);
    assert.equal(settledStatusResponse.status, 200);
    const settledStatus = await settledStatusResponse.json();
    const settledNodeStates = settledStatus.nodeStates ?? {};
    assert.equal(Boolean(settledNodeStates['node-b']?.isPending), false);
    assert.equal(Boolean(settledNodeStates['node-b']?.isComputing), false);
    assert.equal(Boolean(settledNodeStates['node-c']?.isPending), false);
    assert.equal(Boolean(settledNodeStates['node-c']?.isComputing), false);
  } finally {
    await ctx.close();
  }
});

test('POST /api/graphs/:id/commands replaces pending graph-update recomputes with the latest update', async () => {
  const ctx = await setupTestServer();

  try {
    const rootNode = {
      id: 'node-a',
      type: 'inline_code',
      position: { x: 0, y: 0 },
      metadata: {
        name: 'A',
        inputs: [],
        outputs: [{ name: 'output', schema: { type: 'number' } }],
      },
      config: {
        type: 'inline_code',
        runtime: 'python_process',
        code: 'import time\ntime.sleep(0.35)\noutputs.output = 1',
        config: { autoRecompute: true },
      },
      version: 'a-v1',
    };
    const leafNode = {
      id: 'node-b',
      type: 'inline_code',
      position: { x: 200, y: 0 },
      metadata: {
        name: 'B',
        inputs: [{ name: 'input', schema: { type: 'number' } }],
        outputs: [{ name: 'output', schema: { type: 'number' } }],
      },
      config: {
        type: 'inline_code',
        runtime: 'javascript_vm',
        code: 'outputs.output = inputs.input;',
        config: { autoRecompute: true },
      },
      version: 'b-v1',
    };

    const createResponse = await createGraph(ctx.baseUrl, {
      nodes: [rootNode, leafNode],
      connections: [
        {
          id: 'ab',
          sourceNodeId: 'node-a',
          sourcePort: 'output',
          targetNodeId: 'node-b',
          targetPort: 'input',
        },
      ],
      recomputeConcurrency: 1,
    });
    assert.equal(createResponse.status, 200);
    const createdGraph = await createResponse.json();
    await waitForRuntimeIdle(ctx.baseUrl, createdGraph.id, 120, 20);

    const firstUpdateResponse = await updateGraphWithCommands(ctx.baseUrl, createdGraph.id, (graph) => ({
      ...graph,
      nodes: graph.nodes.map((node: any) =>
        node.id === 'node-a'
          ? {
              ...node,
              version: 'a-v2',
              config: {
                ...node.config,
                code: 'import time\ntime.sleep(0.35)\noutputs.output = 2',
              },
            }
          : node
      ),
    }));
    assert.equal(firstUpdateResponse.status, 200);

    let activeRunStarted = false;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const statusResponse = await fetchRuntimeState(ctx.baseUrl, createdGraph.id);
      assert.equal(statusResponse.status, 200);
      const status = await statusResponse.json();
      if (status.nodeStates?.['node-a']?.isComputing) {
        activeRunStarted = true;
        break;
      }
      await delay(20);
    }
    assert.equal(activeRunStarted, true);

    const secondUpdateResponse = await updateGraphWithCommands(ctx.baseUrl, createdGraph.id, (graph) => ({
      ...graph,
      nodes: graph.nodes.map((node: any) =>
        node.id === 'node-a'
          ? {
              ...node,
              version: 'a-v3',
              config: {
                ...node.config,
                code: 'import time\ntime.sleep(0.35)\noutputs.output = 3',
              },
            }
          : node
      ),
    }));
    assert.equal(secondUpdateResponse.status, 200);

    const thirdUpdateResponse = await updateGraphWithCommands(ctx.baseUrl, createdGraph.id, (graph) => ({
      ...graph,
      nodes: graph.nodes.map((node: any) =>
        node.id === 'node-a'
          ? {
              ...node,
              version: 'a-v4',
              config: {
                ...node.config,
                code: 'import time\ntime.sleep(0.35)\noutputs.output = 4',
              },
            }
          : node
      ),
    }));
    assert.equal(thirdUpdateResponse.status, 200);

    let observedCollapsedQueue = false;
    let observedOversizedQueue = false;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const statusResponse = await fetchRuntimeState(ctx.baseUrl, createdGraph.id);
      assert.equal(statusResponse.status, 200);
      const status = await statusResponse.json();

      if (status.queueLength === 2) {
        observedCollapsedQueue = true;
      }
      if (status.queueLength > 2) {
        observedOversizedQueue = true;
      }

      await delay(10);
    }

    assert.equal(observedCollapsedQueue, true);
    assert.equal(observedOversizedQueue, false);

    await waitForRuntimeIdle(ctx.baseUrl, createdGraph.id, 120, 20);

    const settledLeafResult = await ctx.dataStore.getResult(createdGraph.id, 'node-b');
    assert.equal(settledLeafResult?.outputs.output, 4);
  } finally {
    await ctx.close();
  }
});

test('POST /api/graphs/:id/commands rebuilds pending graph-update recomputes from the whole graph stale set', async () => {
  const ctx = await setupTestServer();

  try {
    const makeRootNode = (id: string, output: number, sleepSeconds = 0) => ({
      id,
      type: 'inline_code',
      position: { x: 0, y: 0 },
      metadata: {
        name: id,
        inputs: [],
        outputs: [{ name: 'output', schema: { type: 'number' } }],
      },
      config: {
        type: 'inline_code',
        runtime: 'python_process',
        code: `import time\ntime.sleep(${sleepSeconds})\noutputs.output = ${output}`,
        config: { autoRecompute: true },
      },
      version: `${id}-v1`,
    });
    const makeLeafNode = (id: string) => ({
      id,
      type: 'inline_code',
      position: { x: 200, y: 0 },
      metadata: {
        name: id,
        inputs: [{ name: 'input', schema: { type: 'number' } }],
        outputs: [{ name: 'output', schema: { type: 'number' } }],
      },
      config: {
        type: 'inline_code',
        runtime: 'javascript_vm',
        code: 'outputs.output = inputs.input;',
        config: { autoRecompute: true },
      },
      version: `${id}-v1`,
    });

    const createResponse = await createGraph(ctx.baseUrl, {
      nodes: [
        makeRootNode('node-a-root', 1),
        makeLeafNode('node-a-leaf'),
        makeRootNode('node-b-root', 2),
        makeLeafNode('node-b-leaf'),
        makeRootNode('node-c-root', 3),
        makeLeafNode('node-c-leaf'),
      ],
      connections: [
        {
          id: 'a-chain',
          sourceNodeId: 'node-a-root',
          sourcePort: 'output',
          targetNodeId: 'node-a-leaf',
          targetPort: 'input',
        },
        {
          id: 'b-chain',
          sourceNodeId: 'node-b-root',
          sourcePort: 'output',
          targetNodeId: 'node-b-leaf',
          targetPort: 'input',
        },
        {
          id: 'c-chain',
          sourceNodeId: 'node-c-root',
          sourcePort: 'output',
          targetNodeId: 'node-c-leaf',
          targetPort: 'input',
        },
      ],
      recomputeConcurrency: 1,
    });
    assert.equal(createResponse.status, 200);
    const createdGraph = await createResponse.json();
    await waitForRuntimeIdle(ctx.baseUrl, createdGraph.id, 120, 20);

    const activeUpdateResponse = await updateGraphWithCommands(ctx.baseUrl, createdGraph.id, (graph) => ({
      ...graph,
      nodes: graph.nodes.map((node: any) =>
        node.id === 'node-c-root'
          ? {
              ...node,
              version: 'node-c-root-v2',
              config: {
                ...node.config,
                code: 'import time\ntime.sleep(0.35)\noutputs.output = 30',
              },
            }
          : node
      ),
    }));
    assert.equal(activeUpdateResponse.status, 200);

    let activeRunStarted = false;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const statusResponse = await fetchRuntimeState(ctx.baseUrl, createdGraph.id);
      assert.equal(statusResponse.status, 200);
      const status = await statusResponse.json();
      if (status.nodeStates?.['node-c-root']?.isComputing) {
        activeRunStarted = true;
        break;
      }
      await delay(20);
    }
    assert.equal(activeRunStarted, true);

    const pendingAResponse = await updateGraphWithCommands(ctx.baseUrl, createdGraph.id, (graph) => ({
      ...graph,
      nodes: graph.nodes.map((node: any) =>
        node.id === 'node-a-root'
          ? {
              ...node,
              version: 'node-a-root-v2',
              config: {
                ...node.config,
                code: 'import time\ntime.sleep(0)\noutputs.output = 10',
              },
            }
          : node
      ),
    }));
    assert.equal(pendingAResponse.status, 200);

    const latestBResponse = await updateGraphWithCommands(ctx.baseUrl, createdGraph.id, (graph) => ({
      ...graph,
      nodes: graph.nodes.map((node: any) =>
        node.id === 'node-b-root'
          ? {
              ...node,
              version: 'node-b-root-v2',
              config: {
                ...node.config,
                code: 'import time\ntime.sleep(0)\noutputs.output = 20',
              },
            }
          : node
      ),
    }));
    assert.equal(latestBResponse.status, 200);

    await waitForRuntimeIdle(ctx.baseUrl, createdGraph.id, 180, 20);

    const nodeALeafResult = await ctx.dataStore.getResult(createdGraph.id, 'node-a-leaf');
    const nodeBLeafResult = await ctx.dataStore.getResult(createdGraph.id, 'node-b-leaf');
    const nodeCLeafResult = await ctx.dataStore.getResult(createdGraph.id, 'node-c-leaf');
    assert.equal(nodeALeafResult?.outputs.output, 10);
    assert.equal(nodeBLeafResult?.outputs.output, 20);
    assert.equal(nodeCLeafResult?.outputs.output, 30);
  } finally {
    await ctx.close();
  }
});

test('POST /api/graphs/:id/commands supports noRecompute query flag for topology updates', async () => {
  const ctx = await setupTestServer();

  try {
    const rootNode = {
      id: 'node-a',
      type: 'inline_code',
      position: { x: 0, y: 0 },
      metadata: {
        name: 'A',
        inputs: [],
        outputs: [{ name: 'output', schema: { type: 'number' } }],
      },
      config: {
        type: 'inline_code',
        runtime: 'python_process',
        code: 'import time\\ntime.sleep(0.25)\\noutputs.output = 2',
        config: { autoRecompute: true },
      },
      version: 'a-v1',
    };
    const leafNode = {
      id: 'node-b',
      type: 'inline_code',
      position: { x: 200, y: 0 },
      metadata: {
        name: 'B',
        inputs: [{ name: 'input', schema: { type: 'number' } }],
        outputs: [{ name: 'output', schema: { type: 'number' } }],
      },
      config: {
        type: 'inline_code',
        runtime: 'javascript_vm',
        code: 'outputs.output = inputs.input;',
        config: { autoRecompute: true },
      },
      version: 'b-v1',
    };

    const createResponse = await createGraph(ctx.baseUrl, {
      nodes: [rootNode, leafNode],
      connections: [
        {
          id: 'ab',
          sourceNodeId: 'node-a',
          sourcePort: 'output',
          targetNodeId: 'node-b',
          targetPort: 'input',
        },
      ],
      recomputeConcurrency: 1,
    });
    assert.equal(createResponse.status, 200);
    const createdGraph = await createResponse.json();
    await waitForRuntimeIdle(ctx.baseUrl, createdGraph.id);

    const updateResponse = await updateGraphWithCommands(
      ctx.baseUrl,
      createdGraph.id,
      (graph) => ({
        ...graph,
        connections: [],
      }),
      { noRecompute: true }
    );
    assert.equal(updateResponse.status, 200);

    let sawQueuedWork = false;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const statusResponse = await fetchRuntimeState(ctx.baseUrl, createdGraph.id);
      assert.equal(statusResponse.status, 200);
      const status = await statusResponse.json();
      const nodeStates = status.nodeStates ?? {};

      if (
        status.queueLength > 0 ||
        Object.values(nodeStates).some((state: any) => state?.isPending || state?.isComputing)
      ) {
        sawQueuedWork = true;
        break;
      }

      await delay(20);
    }

    assert.equal(sawQueuedWork, false);
  } finally {
    await ctx.close();
  }
});

test('POST /api/graphs/:id/commands preserves node layout and projection metadata on connections-only updates', async () => {
  const ctx = await setupTestServer();

  try {
    const sourceNode = {
      id: 'node-a',
      type: 'inline_code',
      position: { x: 40, y: 80 },
      metadata: {
        name: 'A',
        inputs: [],
        outputs: [{ name: 'output', schema: { type: 'number' } }],
      },
      config: {
        type: 'inline_code',
        runtime: 'javascript_vm',
        code: 'outputs.output = 1;',
        config: {
          cardWidth: 260,
          cardHeight: 160,
        },
      },
      version: 'a-v1',
    };
    const targetNode = {
      id: 'node-b',
      type: 'inline_code',
      position: { x: 340, y: 120 },
      metadata: {
        name: 'B',
        inputs: [{ name: 'input', schema: { type: 'number' } }],
        outputs: [{ name: 'output', schema: { type: 'number' } }],
      },
      config: {
        type: 'inline_code',
        runtime: 'javascript_vm',
        code: 'outputs.output = inputs.input;',
        config: {
          cardWidth: 320,
          cardHeight: 210,
        },
      },
      version: 'b-v1',
    };

    const createResponse = await createGraph(ctx.baseUrl, {
      nodes: [sourceNode, targetNode],
      connections: [],
      projections: [
        {
          id: 'default',
          name: 'Default',
          nodePositions: {
            'node-a': { x: 40, y: 80 },
            'node-b': { x: 340, y: 120 },
          },
          nodeCardSizes: {
            'node-a': { width: 260, height: 160 },
            'node-b': { width: 320, height: 210 },
          },
          canvasBackground: {
            mode: 'gradient',
            baseColor: '#1d437e',
          },
        },
        {
          id: 'alt',
          name: 'Alt',
          nodePositions: {
            'node-a': { x: 400, y: 200 },
            'node-b': { x: 760, y: 320 },
          },
          nodeCardSizes: {
            'node-a': { width: 280, height: 180 },
            'node-b': { width: 340, height: 230 },
          },
          canvasBackground: {
            mode: 'solid',
            baseColor: '#204080',
          },
        },
      ],
      activeProjectionId: 'alt',
    });
    assert.equal(createResponse.status, 200);
    const createdGraph = await createResponse.json();

    const updateResponse = await updateGraphWithCommands(
      ctx.baseUrl,
      createdGraph.id,
      (graph) => ({
        ...graph,
        connections: [
          {
            id: 'ab',
            sourceNodeId: 'node-a',
            sourcePort: 'output',
            targetNodeId: 'node-b',
            targetPort: 'input',
          },
        ],
      })
    );
    assert.equal(updateResponse.status, 200);
    const updatedGraph = (await updateResponse.json()).graph;

    const extractLayout = (graph: any) =>
      graph.nodes
        .map((node: any) => ({
          id: node.id,
          position: node.position,
          cardWidth: node.config?.config?.cardWidth,
          cardHeight: node.config?.config?.cardHeight,
        }))
        .sort((left: any, right: any) => String(left.id).localeCompare(String(right.id)));

    assert.equal(updatedGraph.activeProjectionId, createdGraph.activeProjectionId);
    assert.deepEqual(updatedGraph.projections, createdGraph.projections);
    assert.deepEqual(extractLayout(updatedGraph), extractLayout(createdGraph));
  } finally {
    await ctx.close();
  }
});

test('POST /api/graphs/:id/commands syncs active projection layout on nodes-only updates', async () => {
  const ctx = await setupTestServer();

  try {
    const node = createValidInlineNode();
    node.position = { x: 320, y: 180 };
    node.config.config = {
      cardWidth: 360,
      cardHeight: 200,
    };

    const createResponse = await createGraph(ctx.baseUrl, {
      nodes: [node],
      projections: [
        {
          id: 'default',
          name: 'Default',
          nodePositions: {
            'node-1': { x: 40, y: 80 },
          },
          nodeCardSizes: {
            'node-1': { width: 220, height: 120 },
          },
          canvasBackground: {
            mode: 'gradient',
            baseColor: '#1d437e',
          },
        },
        {
          id: 'alt',
          name: 'Alt',
          nodePositions: {
            'node-1': { x: 320, y: 180 },
          },
          nodeCardSizes: {
            'node-1': { width: 360, height: 200 },
          },
          canvasBackground: {
            mode: 'solid',
            baseColor: '#204060',
          },
        },
      ],
      activeProjectionId: 'alt',
    });
    assert.equal(createResponse.status, 200);
    const createdGraph = await createResponse.json();

    const updateResponse = await updateGraphWithCommands(ctx.baseUrl, createdGraph.id, (graph) => ({
      ...graph,
      nodes: graph.nodes.map((candidate: any) =>
          candidate.id === 'node-1'
            ? {
                ...candidate,
                position: { x: 520, y: 360 },
                config: {
                  ...candidate.config,
                  config: {
                    ...(candidate.config?.config ?? {}),
                    cardWidth: 410,
                    cardHeight: 260,
                  },
                },
              }
            : candidate
        ),
    }));
    assert.equal(updateResponse.status, 200);
    const updatedGraph = (await updateResponse.json()).graph;

    const defaultProjection = updatedGraph.projections.find((projection: any) => projection.id === 'default');
    const altProjection = updatedGraph.projections.find((projection: any) => projection.id === 'alt');

    assert.ok(defaultProjection);
    assert.ok(altProjection);
    assert.equal(updatedGraph.nodes[0].position.x, 520);
    assert.equal(updatedGraph.nodes[0].position.y, 360);
    assert.equal(updatedGraph.nodes[0].config?.config?.cardWidth, 410);
    assert.equal(updatedGraph.nodes[0].config?.config?.cardHeight, 260);
    assert.equal(defaultProjection.nodePositions['node-1'].x, 40);
    assert.equal(defaultProjection.nodePositions['node-1'].y, 80);
    assert.equal(defaultProjection.nodeCardSizes['node-1'].width, 220);
    assert.equal(defaultProjection.nodeCardSizes['node-1'].height, 120);
    assert.equal(altProjection.nodePositions['node-1'].x, 520);
    assert.equal(altProjection.nodePositions['node-1'].y, 360);
    assert.equal(altProjection.nodeCardSizes['node-1'].width, 410);
    assert.equal(altProjection.nodeCardSizes['node-1'].height, 260);
  } finally {
    await ctx.close();
  }
});

test('POST /api/graphs/:id/commands switches active projection and applies projected node coordinates', async () => {
  const ctx = await setupTestServer();

  try {
    const createResponse = await createGraph(ctx.baseUrl, {
      nodes: [createValidInlineNode()],
    });
    assert.equal(createResponse.status, 200);
    const createdGraph = await createResponse.json();

    const altProjectionId = 'alt-projection';
    const updateResponse = await updateGraphWithCommands(
      ctx.baseUrl,
      createdGraph.id,
      (graph) => ({
        ...graph,
        projections: [
          {
            id: 'default',
            name: 'Default',
            nodePositions: {
              'node-1': { x: 0, y: 0 },
            },
            nodeCardSizes: {
              'node-1': { width: 220, height: 80 },
            },
            canvasBackground: {
              mode: 'gradient',
              baseColor: '#1d437e',
            },
          },
          {
            id: altProjectionId,
            name: 'Projection 2',
            nodePositions: {
              'node-1': { x: 320, y: 180 },
            },
            nodeCardSizes: {
              'node-1': { width: 360, height: 200 },
            },
            canvasBackground: {
              mode: 'solid',
              baseColor: '#204060',
            },
          },
        ],
        activeProjectionId: altProjectionId,
      })
    );

    assert.equal(updateResponse.status, 200);
    const updatedGraph = (await updateResponse.json()).graph;
    assert.equal(updatedGraph.activeProjectionId, altProjectionId);
    assert.equal(updatedGraph.nodes[0].position.x, 320);
    assert.equal(updatedGraph.nodes[0].position.y, 180);
    assert.equal(updatedGraph.nodes[0].config.config.cardWidth, 360);
    assert.equal(updatedGraph.nodes[0].config.config.cardHeight, 200);
    assert.deepEqual(updatedGraph.canvasBackground, {
      mode: 'solid',
      baseColor: '#204060',
    });
    assert.equal(
      updatedGraph.projections.find((projection: any) => projection.id === altProjectionId)?.nodePositions['node-1'].x,
      320
    );
    assert.equal(
      updatedGraph.projections.find((projection: any) => projection.id === altProjectionId)?.nodePositions['node-1'].y,
      180
    );
    assert.equal(
      updatedGraph.projections.find((projection: any) => projection.id === altProjectionId)?.nodeCardSizes['node-1'].width,
      360
    );
    assert.equal(
      updatedGraph.projections.find((projection: any) => projection.id === altProjectionId)?.nodeCardSizes['node-1'].height,
      200
    );
  } finally {
    await ctx.close();
  }
});

test('POST /api/graphs/:id/commands switches graph canvas background to selected projection background', async () => {
  const ctx = await setupTestServer();

  try {
    const createResponse = await createGraph(ctx.baseUrl, {
      nodes: [createValidInlineNode()],
      projections: [
        {
          id: 'default',
          name: 'Default',
          nodePositions: {
            'node-1': { x: 0, y: 0 },
          },
          nodeCardSizes: {
            'node-1': { width: 220, height: 80 },
          },
          canvasBackground: {
            mode: 'gradient',
            baseColor: '#1d437e',
          },
        },
        {
          id: 'alt',
          name: 'Alt',
          nodePositions: {
            'node-1': { x: 40, y: 60 },
          },
          nodeCardSizes: {
            'node-1': { width: 300, height: 180 },
          },
          canvasBackground: {
            mode: 'solid',
            baseColor: '#305070',
          },
        },
      ],
      activeProjectionId: 'default',
    });
    assert.equal(createResponse.status, 200);
    const createdGraph = await createResponse.json();
    assert.deepEqual(createdGraph.canvasBackground, {
      mode: 'gradient',
      baseColor: '#1d437e',
    });

    const updateResponse = await updateGraphWithCommands(ctx.baseUrl, createdGraph.id, (graph) => ({
      ...graph,
      activeProjectionId: 'alt',
    }));
    assert.equal(updateResponse.status, 200);
    const updatedGraph = (await updateResponse.json()).graph;
    assert.equal(updatedGraph.activeProjectionId, 'alt');
    assert.deepEqual(updatedGraph.canvasBackground, {
      mode: 'solid',
      baseColor: '#305070',
    });
  } finally {
    await ctx.close();
  }
});

test('POST /api/graphs/:id/commands rejects updates that remove all projections', async () => {
  const ctx = await setupTestServer();

  try {
    const createResponse = await createGraph(ctx.baseUrl, {
      nodes: [createValidInlineNode()],
    });
    assert.equal(createResponse.status, 200);
    const createdGraph = await createResponse.json();

    const updateResponse = await updateGraphWithCommands(ctx.baseUrl, createdGraph.id, (graph) => ({
      ...graph,
      projections: [],
    }));

    assert.equal(updateResponse.status, 400);
    const payload = await updateResponse.json();
    assert.match(payload.error, /at least one projection/i);
  } finally {
    await ctx.close();
  }
});

test('POST /api/graphs/:id/commands rejects stale baseRevision values with conflict', async () => {
  const ctx = await setupTestServer();

  try {
    const createResponse = await createGraph(ctx.baseUrl, {
      nodes: [createValidInlineNode()],
    });
    assert.equal(createResponse.status, 200);
    const createdGraph = await createResponse.json();

    const firstUpdateResponse = await submitGraphCommands(
      ctx.baseUrl,
      createdGraph.id,
      createdGraph.revision ?? 0,
      [
        {
          kind: 'set_graph_name',
          name: toAutotestGraphName('conflict_name_seed'),
        },
      ]
    );
    assert.equal(firstUpdateResponse.status, 200);

    const updateResponse = await submitGraphCommands(
      ctx.baseUrl,
      createdGraph.id,
      createdGraph.revision ?? 0,
      [
        {
          kind: 'set_graph_name',
          name: toAutotestGraphName('conflict_name'),
        },
      ]
    );

    assert.equal(updateResponse.status, 409);
    const payload = await updateResponse.json();
    assert.match(payload.error, /reload the latest graph and retry/i);
    assert.equal(payload.currentRevision, (createdGraph.revision ?? 0) + 1);
  } finally {
    await ctx.close();
  }
});

test('DELETE /api/graphs/:id deletes graph and subsequent fetch returns 404', async () => {
  const ctx = await setupTestServer();

  try {
    const createResponse = await createGraph(ctx.baseUrl, {
      name: 'Delete Target Graph',
    });
    assert.equal(createResponse.status, 200);
    const createdGraph = await createResponse.json();

    const deleteResponse = await fetch(`${ctx.baseUrl}/api/graphs/${createdGraph.id}`, {
      method: 'DELETE',
    });
    assert.equal(deleteResponse.status, 204);

    const getDeletedResponse = await fetch(`${ctx.baseUrl}/api/graphs/${createdGraph.id}`);
    assert.equal(getDeletedResponse.status, 404);
  } finally {
    await ctx.close();
  }
});

test('DELETE /api/graphs/:id returns 404 for missing graph', async () => {
  const ctx = await setupTestServer();

  try {
    const deleteResponse = await fetch(`${ctx.baseUrl}/api/graphs/missing-graph-id`, {
      method: 'DELETE',
    });
    assert.equal(deleteResponse.status, 404);
    const payload = await deleteResponse.json();
    assert.match(payload.error, /graph not found/i);
  } finally {
    await ctx.close();
  }
});

test('POST /api/graphs accepts graph python env definitions and node env references', async () => {
  const ctx = await setupTestServer();

  try {
    const node = createValidInlineNode();
    node.config.runtime = 'python_process';
    node.config.pythonEnv = 'analytics';
    node.config.code = 'outputs.output = inputs.input * 2';
    node.metadata.inputs = [{ name: 'input', schema: { type: 'number' } }];

    const response = await createGraph(ctx.baseUrl, {
      nodes: [node],
      pythonEnvs: [
        {
          name: 'analytics',
          pythonPath: '/tmp/python-a',
          cwd: '/tmp/work-a',
        },
      ],
    });
    assert.equal(response.status, 200);
    const graph = await response.json();
    assert.equal(graph.pythonEnvs.length, 1);
    assert.equal(graph.nodes[0].config.pythonEnv, 'analytics');
  } finally {
    await ctx.close();
  }
});

test('POST /api/graphs rejects duplicate graph python env names', async () => {
  const ctx = await setupTestServer();

  try {
    const response = await createGraph(ctx.baseUrl, {
      pythonEnvs: [
        { name: 'dup', pythonPath: '/tmp/python-a', cwd: '/tmp/work-a' },
        { name: 'dup', pythonPath: '/tmp/python-b', cwd: '/tmp/work-b' },
      ],
    });

    assert.equal(response.status, 400);
    const payload = await response.json();
    assert.match(payload.error, /must be unique/i);
  } finally {
    await ctx.close();
  }
});

test('POST /api/graphs rejects python env references that do not exist on graph', async () => {
  const ctx = await setupTestServer();

  try {
    const node = createValidInlineNode();
    node.config.runtime = 'python_process';
    node.config.pythonEnv = 'missing';
    node.config.code = 'outputs.output = inputs.input * 2';
    node.metadata.inputs = [{ name: 'input', schema: { type: 'number' } }];

    const response = await createGraph(ctx.baseUrl, {
      nodes: [node],
      pythonEnvs: [],
    });

    assert.equal(response.status, 400);
    const payload = await response.json();
    assert.match(payload.error, /unknown pythonEnv/i);
  } finally {
    await ctx.close();
  }
});

test('POST /api/graphs rejects python env name on non-python runtime node', async () => {
  const ctx = await setupTestServer();

  try {
    const node = createValidInlineNode();
    node.config.runtime = 'javascript_vm';
    node.config.pythonEnv = 'analytics';

    const response = await createGraph(ctx.baseUrl, {
      nodes: [node],
      pythonEnvs: [
        { name: 'analytics', pythonPath: '/tmp/python-a', cwd: '/tmp/work-a' },
      ],
    });

    assert.equal(response.status, 400);
    const payload = await response.json();
    assert.match(payload.error, /runtime "javascript_vm" is not "python_process"/i);
  } finally {
    await ctx.close();
  }
});

test('POST /api/graphs accepts persisted drawings payload', async () => {
  const ctx = await setupTestServer();

  try {
    const response = await createGraph(ctx.baseUrl, {
      drawings: [createSampleDrawing('drawing-1')],
    });

    assert.equal(response.status, 200);
    const graph = await response.json();
    assert.equal(graph.drawings.length, 1);
    assert.equal(graph.drawings[0].paths.length, 1);
    assert.equal(graph.drawings[0].paths[0].points.length, 2);
  } finally {
    await ctx.close();
  }
});

test('POST /api/graphs normalizes drawing colors to hex format', async () => {
  const ctx = await setupTestServer();

  try {
    const response = await createGraph(ctx.baseUrl, {
      drawings: [
        {
          id: 'drawing-colors',
          name: 'Drawing Colors',
          position: { x: 10, y: 10 },
          paths: [
            {
              id: 'path-legacy',
              color: 'green',
              thickness: 3,
              points: [{ x: 0, y: 0 }],
            },
            {
              id: 'path-hex',
              color: '#123abc',
              thickness: 3,
              points: [{ x: 4, y: 4 }],
            },
          ],
        },
      ],
    });

    assert.equal(response.status, 200);
    const graph = await response.json();
    assert.equal(graph.drawings[0].paths[0].color, '#22c55e');
    assert.equal(graph.drawings[0].paths[1].color, '#123abc');
  } finally {
    await ctx.close();
  }
});

test('POST /api/graphs/:id/commands accepts updates with payload larger than 100KB', async () => {
  const ctx = await setupTestServer();

  try {
    const createResponse = await createGraph(ctx.baseUrl, {
      drawings: [createSampleDrawing('seed-drawing')],
    });
    assert.equal(createResponse.status, 200);
    const createdGraph = await createResponse.json();

    const updatePayload = {
      nodes: [...createdGraph.nodes, createPassThroughNode('node-2')],
      connections: createdGraph.connections,
      drawings: [...createdGraph.drawings, createLargeDrawing('large-drawing')],
    };

    const serializedPayload = JSON.stringify(updatePayload);
    assert.ok(
      serializedPayload.length > 102_400,
      `Expected test payload > 100KB, received ${serializedPayload.length} bytes`
    );

    const updateResponse = await updateGraphWithCommands(ctx.baseUrl, createdGraph.id, (graph) => ({
      ...graph,
      ...updatePayload,
    }));

    assert.equal(updateResponse.status, 200);
    const updatedGraph = (await updateResponse.json()).graph;
    assert.equal(updatedGraph.nodes.length, 1);
    assert.equal(updatedGraph.drawings.length, 2);
    assert.equal(updatedGraph.drawings[1].paths[0].points.length, 12_000);
  } finally {
    await ctx.close();
  }
});

test('POST /api/graphs rejects duplicate drawing ids', async () => {
  const ctx = await setupTestServer();

  try {
    const response = await createGraph(ctx.baseUrl, {
      drawings: [createSampleDrawing('dup-drawing'), createSampleDrawing('dup-drawing')],
    });

    assert.equal(response.status, 400);
    const payload = await response.json();
    assert.match(payload.error, /drawing ids must be unique/i);
  } finally {
    await ctx.close();
  }
});

test('POST /api/graphs rejects duplicate node ids', async () => {
  const ctx = await setupTestServer();

  try {
    const response = await createGraph(ctx.baseUrl, {
      nodes: [
        createValidInlineNode(),
        {
          ...createPassThroughNode('node-1'),
          position: { x: 180, y: 40 },
        },
      ],
    });

    assert.equal(response.status, 400);
    const payload = await response.json();
    assert.match(payload.error, /node ids must be unique/i);
  } finally {
    await ctx.close();
  }
});

test('POST /api/graphs/:id/commands rejects duplicate node ids', async () => {
  const ctx = await setupTestServer();

  try {
    const createResponse = await createGraph(ctx.baseUrl, {
      nodes: [createValidInlineNode(), createPassThroughNode('node-2')],
    });
    assert.equal(createResponse.status, 200);
    const createdGraph = await createResponse.json();

    const updateResponse = await updateGraphWithCommands(
      ctx.baseUrl,
      createdGraph.id,
      (graph) => ({
        ...graph,
        nodes: [
          createdGraph.nodes[0],
          {
            ...createPassThroughNode(createdGraph.nodes[0].id),
            position: { x: 180, y: 40 },
          },
        ],
        connections: [],
      })
    );

    assert.equal(updateResponse.status, 400);
    const payload = await updateResponse.json();
    assert.match(payload.error, /node ids must be unique/i);
  } finally {
    await ctx.close();
  }
});

test('POST /api/graphs rejects duplicate drawing path ids within a drawing', async () => {
  const ctx = await setupTestServer();

  try {
    const drawing = createSampleDrawing('drawing-with-dup-path');
    drawing.paths.push({
      id: drawing.paths[0].id,
      color: 'red',
      thickness: 1,
      points: [{ x: 1, y: 1 }],
    });

    const response = await createGraph(ctx.baseUrl, {
      drawings: [drawing],
    });

    assert.equal(response.status, 400);
    const payload = await response.json();
    assert.match(payload.error, /path ids must be unique/i);
  } finally {
    await ctx.close();
  }
});

test('POST /api/graphs rejects malformed node config', async () => {
  const ctx = await setupTestServer();

  try {
    const invalidNode = createValidInlineNode();
    invalidNode.config.runtime = '';

    const response = await createGraph(ctx.baseUrl, {
      name: 'Bad Graph',
      nodes: [invalidNode],
    });

    assert.equal(response.status, 400);
    const payload = await response.json();
    assert.equal(payload.error, 'Validation failed');
  } finally {
    await ctx.close();
  }
});

test('POST /api/graphs/:id/commands rejects malformed runtime updates', async () => {
  const ctx = await setupTestServer();

  try {
    const createResponse = await createGraph(ctx.baseUrl);
    assert.equal(createResponse.status, 200);
    const createdGraph = await createResponse.json();

    const invalidNode = createValidInlineNode();
    invalidNode.config.runtime = '';

    const updateResponse = await updateGraphWithCommands(ctx.baseUrl, createdGraph.id, (graph) => ({
      ...graph,
      nodes: [invalidNode],
    }));

    assert.equal(updateResponse.status, 400);
    const payload = await updateResponse.json();
    assert.equal(payload.error, 'Validation failed');
  } finally {
    await ctx.close();
  }
});

test('POST /api/graphs/:id/commands returns clear error for unregistered runtime', async () => {
  const ctx = await setupTestServer();

  try {
    const node = createValidInlineNode();
    node.config.runtime = 'unknown_runtime';

    const createResponse = await createGraph(ctx.baseUrl, {
      nodes: [node],
    });
    assert.equal(createResponse.status, 200);
    const createdGraph = await createResponse.json();

    const computeResponse = await computeGraph(ctx.baseUrl, createdGraph.id);

    assert.equal(computeResponse.status, 500);
    const payload = await computeResponse.json();
    assert.match(payload.error, /not registered/);
  } finally {
    await ctx.close();
  }
});

test('POST /api/graphs rejects cyclic graph structures', async () => {
  const ctx = await setupTestServer();

  try {
    const nodeA = createPassThroughNode('node-a');
    const nodeB = createPassThroughNode('node-b');

    const response = await createGraph(ctx.baseUrl, {
      name: 'Cyclic Graph',
      nodes: [nodeA, nodeB],
      connections: [
        {
          id: 'c1',
          sourceNodeId: 'node-a',
          sourcePort: 'output',
          targetNodeId: 'node-b',
          targetPort: 'input',
        },
        {
          id: 'c2',
          sourceNodeId: 'node-b',
          sourcePort: 'output',
          targetNodeId: 'node-a',
          targetPort: 'input',
        },
      ],
    });

    assert.equal(response.status, 400);
    const payload = await response.json();
    assert.match(payload.error, /circular dependency/i);
  } finally {
    await ctx.close();
  }
});

test('POST /api/graphs/:id/commands rejects updates that introduce cycles', async () => {
  const ctx = await setupTestServer();

  try {
    const nodeA = createPassThroughNode('node-a');
    const nodeB = createPassThroughNode('node-b');

    const createResponse = await createGraph(ctx.baseUrl, {
      name: 'Acyclic Graph',
      nodes: [nodeA, nodeB],
      connections: [
        {
          id: 'c1',
          sourceNodeId: 'node-a',
          sourcePort: 'output',
          targetNodeId: 'node-b',
          targetPort: 'input',
        },
      ],
    });
    assert.equal(createResponse.status, 200);
    const createdGraph = await createResponse.json();

    const updateResponse = await updateGraphWithCommands(ctx.baseUrl, createdGraph.id, (graph) => ({
      ...graph,
      connections: [
        ...graph.connections,
        {
          id: 'c2',
          sourceNodeId: 'node-b',
          sourcePort: 'output',
          targetNodeId: 'node-a',
          targetPort: 'input',
        },
      ],
    }));

    assert.equal(updateResponse.status, 400);
    const payload = await updateResponse.json();
    assert.match(payload.error, /circular dependency/i);
  } finally {
    await ctx.close();
  }
});

test('POST /api/graphs/:id/commands rejects multiple inbound connections on the same input slot', async () => {
  const ctx = await setupTestServer();

  try {
    const sourceA = createNumericInputNode('source-a', 1);
    const sourceB = createNumericInputNode('source-b', 2);
    const target = createPassThroughNode('target');

    const createResponse = await createGraph(ctx.baseUrl, {
      name: 'Single Inbound Update Graph',
      nodes: [sourceA, sourceB, target],
      connections: [
        {
          id: 'conn-a',
          sourceNodeId: 'source-a',
          sourcePort: 'value',
          targetNodeId: 'target',
          targetPort: 'input',
        },
      ],
    });
    assert.equal(createResponse.status, 200);
    const createdGraph = await createResponse.json();

    const updateResponse = await updateGraphWithCommands(ctx.baseUrl, createdGraph.id, (graph) => ({
      ...graph,
      connections: [
        ...graph.connections,
        {
          id: 'conn-b',
          sourceNodeId: 'source-b',
          sourcePort: 'value',
          targetNodeId: 'target',
          targetPort: 'input',
        },
      ],
    }));

    assert.equal(updateResponse.status, 400);
    const payload = await updateResponse.json();
    assert.match(payload.error, /multiple inbound connections/i);
  } finally {
    await ctx.close();
  }
});

test('POST /api/graphs/:id/commands returns actionable errors for duplicate annotation target slots', async () => {
  const ctx = await setupTestServer();

  try {
    const sourceA = createAnnotationNode('source-a');
    const sourceB = createAnnotationNode('source-b');
    const target = createAnnotationNode('target-note');

    const createResponse = await createGraph(ctx.baseUrl, {
      name: 'Duplicate Annotation Slot Graph',
      nodes: [sourceA, sourceB, target],
      connections: [
        {
          id: 'arrow-a',
          sourceNodeId: 'source-a',
          sourcePort: '__annotation__',
          sourceAnchor: {
            side: 'right',
            offset: 0.5,
          },
          targetNodeId: 'target-note',
          targetPort: '__annotation__',
          targetAnchor: {
            side: 'left',
            offset: 0.5,
          },
        },
      ],
    });
    assert.equal(createResponse.status, 200);
    const createdGraph = await createResponse.json();

    const updateResponse = await updateGraphWithCommands(ctx.baseUrl, createdGraph.id, (graph) => ({
      ...graph,
      connections: [
        ...graph.connections,
        {
          id: 'arrow-b',
          sourceNodeId: 'source-b',
          sourcePort: '__annotation__',
          sourceAnchor: {
            side: 'right',
            offset: 0.5,
          },
          targetNodeId: 'target-note',
          targetPort: '__annotation__',
          targetAnchor: {
            side: 'left',
            offset: 0.5,
          },
        },
      ],
    }));

    assert.equal(updateResponse.status, 400);
    const payload = await updateResponse.json();
    assert.match(payload.error, /target-note:__annotation__@left:0\.5/i);
    assert.match(payload.error, /already occupied by connection arrow-a/i);
    assert.match(payload.error, /different targetAnchor/i);
    assert.match(payload.error, /connection_set/i);
  } finally {
    await ctx.close();
  }
});

test('POST /api/graphs/:id/commands rejects all updates on cyclic graphs (strict DAG)', async () => {
  const ctx = await setupTestServer();

  try {
    const nodeA = createPassThroughNode('node-a');
    const nodeB = createPassThroughNode('node-b');
    const legacyGraph = {
      id: 'legacy-cyclic',
      name: toAutotestGraphName('legacy_cyclic_graph'),
      revision: 0,
      nodes: [nodeA, nodeB],
      connections: [
        {
          id: 'c1',
          sourceNodeId: 'node-a',
          sourcePort: 'output',
          targetNodeId: 'node-b',
          targetPort: 'input',
        },
        {
          id: 'c2',
          sourceNodeId: 'node-b',
          sourcePort: 'output',
          targetNodeId: 'node-a',
          targetPort: 'input',
        },
      ],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await ctx.dataStore.storeGraph(legacyGraph);

    const updateResponse = await updateGraphWithCommands(ctx.baseUrl, legacyGraph.id, (graph) => ({
      ...graph,
      nodes: [...graph.nodes, createPassThroughNode('node-c')],
    }));

    assert.equal(updateResponse.status, 400);
    const payload = await updateResponse.json();
    assert.match(payload.error, /circular dependency/i);
  } finally {
    await ctx.close();
  }
});

test('compute command responses include graphics metadata without embedding raw image payload', async () => {
  const ctx = await setupTestServer();

  try {
    const graphicsNode = createPngGraphicsNode('node-graphics');
    const createResponse = await createGraph(ctx.baseUrl, {
      nodes: [graphicsNode],
    });
    assert.equal(createResponse.status, 200);
    const graph = await createResponse.json();

    const computeResponse = await computeNode(ctx.baseUrl, graph.id, graphicsNode.id);
    assert.equal(computeResponse.status, 200);
    const computed = (await computeResponse.json()).runtimeState.results[graphicsNode.id];

    assert.equal(typeof computed.graphics?.id, 'string');
    assert.equal(computed.graphics?.mimeType, 'image/png');
    assert.ok(Array.isArray(computed.graphics?.levels));
    assert.equal(computed.graphics?.levels[0]?.width, 4);
    assert.equal(computed.graphics?.levels[0]?.height, 4);
    assert.equal(computed.graphicsOutput, undefined);

    const resultResponse = await fetch(
      `${ctx.baseUrl}/api/graphs/${graph.id}/nodes/${graphicsNode.id}/result`
    );
    assert.equal(resultResponse.status, 200);
    const stored = await resultResponse.json();
    assert.equal(stored.graphics?.id, computed.graphics?.id);
    assert.equal(stored.graphicsOutput, undefined);
  } finally {
    await ctx.close();
  }
});

test('GET /api/graphics/:id/image selects mip level by maxPixels and returns binary', async () => {
  const ctx = await setupTestServer();

  try {
    const graphicsNode = createPngGraphicsNode('node-graphics-image');
    const createResponse = await createGraph(ctx.baseUrl, {
      nodes: [graphicsNode],
    });
    assert.equal(createResponse.status, 200);
    const graph = await createResponse.json();

    const computeResponse = await computeNode(ctx.baseUrl, graph.id, graphicsNode.id);
    assert.equal(computeResponse.status, 200);
    const computed = (await computeResponse.json()).runtimeState.results[graphicsNode.id];
    const graphicsId = computed.graphics?.id as string;
    assert.ok(graphicsId);

    const imageResponse = await fetch(
      `${ctx.baseUrl}/api/graphics/${encodeURIComponent(graphicsId)}/image?maxPixels=4`
    );
    assert.equal(imageResponse.status, 200);
    assert.equal(imageResponse.headers.get('content-type'), 'image/png');
    assert.equal(imageResponse.headers.get('x-k8v-graphics-width'), '2');
    assert.equal(imageResponse.headers.get('x-k8v-graphics-height'), '2');
    assert.equal(imageResponse.headers.get('x-k8v-graphics-pixels'), '4');
    const binary = Buffer.from(await imageResponse.arrayBuffer());
    assert.ok(binary.byteLength > 0);
  } finally {
    await ctx.close();
  }
});
