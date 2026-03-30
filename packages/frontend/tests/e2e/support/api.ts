import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { E2E_ASSERT_TIMEOUT_MS, E2E_BACKEND_URL } from './config.ts';

const AUTOTEST_GRAPH_PREFIX = 'autotests_';

interface GraphNodePayload {
  id: string;
  type: 'numeric_input';
  position: { x: number; y: number };
  metadata: {
    name: string;
    inputs: [];
    outputs: Array<{ name: string; schema: { type: 'number' } }>;
  };
  config: {
    type: 'numeric_input';
    config: {
      value: number;
      min: number;
      max: number;
      step: number;
      propagateWhileDragging?: boolean;
      dragDebounceSeconds?: number;
    };
  };
  version: string;
}

interface AnnotationNodePayload {
  id: string;
  type: 'annotation';
  position: { x: number; y: number };
  metadata: {
    name: string;
    inputs: [];
    outputs: [];
  };
  config: {
    type: 'annotation';
    config: {
      text: string;
      backgroundColor: string;
      borderColor: string;
      fontColor: string;
      fontSize?: number;
      cardWidth?: number;
      cardHeight?: number;
    };
  };
  version: string;
}

interface InlineNodePayload {
  id: string;
  type: 'inline_code';
  position: { x: number; y: number };
  metadata: {
    name: string;
    inputs: Array<{ name: string; schema: { type: 'number' } }>;
    outputs: Array<{ name: string; schema: { type: 'number' } }>;
  };
  config: {
    type: 'inline_code';
    code: string;
    runtime: 'javascript_vm';
  };
  version: string;
}

interface ConnectionAnchorPayload {
  side: 'top' | 'right' | 'bottom' | 'left';
  offset: number;
}

interface GraphResponse {
  id: string;
  revision?: number;
  name?: string;
  canvasBackground?: {
    mode?: unknown;
    baseColor?: unknown;
  };
  connectionStroke?: {
    foregroundColor?: unknown;
    backgroundColor?: unknown;
    foregroundWidth?: unknown;
    backgroundWidth?: unknown;
  };
  nodes: Array<{
    id: string;
    position?: {
      x?: unknown;
      y?: unknown;
    };
    metadata?: {
      name?: string;
      inputs?: Array<{ name?: string }>;
      outputs?: Array<{ name?: string }>;
    };
    config: {
      type?: string;
      runtime?: string;
      config?: {
        value?: unknown;
        cardWidth?: unknown;
        cardHeight?: unknown;
        text?: unknown;
        fontSize?: unknown;
      };
    };
  }>;
  connections?: Array<{
    id?: string;
    sourceNodeId?: string;
    sourcePort?: string;
    sourceAnchor?: {
      side?: unknown;
      offset?: unknown;
    };
    targetNodeId?: string;
    targetPort?: string;
    targetAnchor?: {
      side?: unknown;
      offset?: unknown;
    };
  }>;
}

interface GraphCommandsResponse {
  graph?: GraphResponse;
}

export async function getGraphConnectionStroke(
  graphId: string
): Promise<{
  foregroundColor: string;
  backgroundColor: string;
  foregroundWidth: number;
  backgroundWidth: number;
}> {
  const graph = await readGraphSnapshot(graphId);

  const foregroundColor = graph.connectionStroke?.foregroundColor;
  const backgroundColor = graph.connectionStroke?.backgroundColor;
  const foregroundWidth = graph.connectionStroke?.foregroundWidth;
  const backgroundWidth = graph.connectionStroke?.backgroundWidth;

  if (typeof foregroundColor !== 'string') {
    throw new Error(`Graph ${graphId} connectionStroke.foregroundColor should be a string`);
  }
  if (typeof backgroundColor !== 'string') {
    throw new Error(`Graph ${graphId} connectionStroke.backgroundColor should be a string`);
  }
  if (typeof foregroundWidth !== 'number' || !Number.isFinite(foregroundWidth)) {
    throw new Error(`Graph ${graphId} connectionStroke.foregroundWidth should be a finite number`);
  }
  if (typeof backgroundWidth !== 'number' || !Number.isFinite(backgroundWidth)) {
    throw new Error(`Graph ${graphId} connectionStroke.backgroundWidth should be a finite number`);
  }

  return {
    foregroundColor: foregroundColor.toLowerCase(),
    backgroundColor: backgroundColor.toLowerCase(),
    foregroundWidth,
    backgroundWidth,
  };
}

export async function waitForGraphConnectionStroke(
  graphId: string,
  predicate: (stroke: {
    foregroundColor: string;
    backgroundColor: string;
    foregroundWidth: number;
    backgroundWidth: number;
  }) => boolean,
  timeoutMs = E2E_ASSERT_TIMEOUT_MS
): Promise<{
  foregroundColor: string;
  backgroundColor: string;
  foregroundWidth: number;
  backgroundWidth: number;
}> {
  const startedAt = Date.now();
  let lastStroke = {
    foregroundColor: '',
    backgroundColor: '',
    foregroundWidth: Number.NaN,
    backgroundWidth: Number.NaN,
  };

  while ((Date.now() - startedAt) < timeoutMs) {
    lastStroke = await getGraphConnectionStroke(graphId);
    if (predicate(lastStroke)) {
      return lastStroke;
    }

    await delay(120);
  }

  throw new Error(
    `Timed out waiting for connection stroke in graph ${graphId}. Last value: ${JSON.stringify(lastStroke)}`
  );
}

function toAutotestGraphName(name: string): string {
  return name.startsWith(AUTOTEST_GRAPH_PREFIX)
    ? name
    : `${AUTOTEST_GRAPH_PREFIX}${name}`;
}

async function expectJsonResponse(response: Response, context: string): Promise<any> {
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${context} failed (${response.status}): ${text}`);
  }
  try {
    return text.length > 0 ? JSON.parse(text) : {};
  } catch (error) {
    throw new Error(`${context} returned non-JSON payload: ${String(error)}`);
  }
}

async function waitForGraphAvailability(
  graphId: string,
  options?: {
    minRevision?: number;
    timeoutMs?: number;
  }
): Promise<GraphResponse> {
  const startedAt = Date.now();
  const minRevision = options?.minRevision ?? 0;
  const timeoutMs = options?.timeoutMs ?? E2E_ASSERT_TIMEOUT_MS;
  let lastStatus = 0;
  let lastRevision = Number.NaN;

  while ((Date.now() - startedAt) < timeoutMs) {
    const response = await fetch(`${E2E_BACKEND_URL}/api/graphs/${graphId}`, {
      method: 'GET',
      headers: {
        accept: 'application/json',
      },
    });

    lastStatus = response.status;
    if (response.ok) {
      const graph = await response.json() as GraphResponse;
      const revision = typeof graph.revision === 'number' ? graph.revision : 0;
      lastRevision = revision;
      if (revision >= minRevision) {
        return graph;
      }
    }

    await delay(120);
  }

  throw new Error(
    `Timed out waiting for graph ${graphId} availability (status=${lastStatus}, revision=${lastRevision}, minRevision=${minRevision})`
  );
}

async function readGraphSnapshot(
  graphId: string,
  timeoutMs = Math.min(E2E_ASSERT_TIMEOUT_MS, 8_000)
): Promise<GraphResponse> {
  return waitForGraphAvailability(graphId, {
    minRevision: 0,
    timeoutMs,
  });
}

async function createEmptyGraphDocumentOnce(name: string, context: string): Promise<GraphResponse> {
  const response = await fetch(`${E2E_BACKEND_URL}/api/graphs`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      name: toAutotestGraphName(name),
    }),
  });

  const graph = await expectJsonResponse(response, context) as GraphResponse;
  assert.ok(graph.id, `${context} response should include graph id`);
  return waitForGraphAvailability(graph.id, {
    minRevision: graph.revision ?? 0,
  });
}

async function createEmptyGraphDocument(name: string, context: string): Promise<GraphResponse> {
  const attempts = 3;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await createEmptyGraphDocumentOnce(name, context);
    } catch (error) {
      lastError = error;
      if (attempt === attempts) {
        break;
      }
      await delay(250);
    }
  }

  throw new Error(
    `${context} failed after ${attempts} attempts: ${lastError instanceof Error ? lastError.message : String(lastError)}`
  );
}

export async function submitGraphCommands(
  graphId: string,
  baseRevision: number,
  commands: Array<Record<string, unknown>>,
  context: string
): Promise<GraphResponse> {
  const startedAt = Date.now();
  const timeoutMs = E2E_ASSERT_TIMEOUT_MS;
  let payload: GraphCommandsResponse | null = null;
  let lastNotFoundBody = '';

  while ((Date.now() - startedAt) < timeoutMs) {
    const response = await fetch(`${E2E_BACKEND_URL}/api/graphs/${graphId}/commands`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        baseRevision,
        commands,
      }),
    });

    if (response.status === 404) {
      lastNotFoundBody = await response.text();
      await delay(120);
      continue;
    }

    payload = await expectJsonResponse(response, context) as GraphCommandsResponse;
    break;
  }

  if (!payload) {
    throw new Error(`${context} failed (404): ${lastNotFoundBody}`);
  }
  assert.ok(payload.graph?.id, `${context} response should include graph payload`);
  return waitForGraphAvailability(payload.graph.id, {
    minRevision: payload.graph.revision ?? baseRevision,
  });
}

async function createSeededGraphOnce(options: {
  name: string;
  nodes?: unknown[];
  connections?: unknown[];
  drawings?: unknown[];
  context: string;
}): Promise<GraphResponse> {
  const createdGraph = await createEmptyGraphDocument(options.name, options.context);
  const commands: Array<Record<string, unknown>> = [];

  if (Array.isArray(options.nodes) && options.nodes.length > 0) {
    commands.push({
      kind: 'replace_nodes',
      nodes: options.nodes,
    });
  }

  if (Array.isArray(options.connections) && options.connections.length > 0) {
    commands.push({
      kind: 'replace_connections',
      connections: options.connections,
    });
  }

  if (Array.isArray(options.drawings) && options.drawings.length > 0) {
    commands.push({
      kind: 'replace_drawings',
      drawings: options.drawings,
    });
  }

  if (commands.length === 0) {
    return createdGraph;
  }

  return submitGraphCommands(
    createdGraph.id,
    createdGraph.revision ?? 0,
    commands,
    `${options.context} seed commands`
  );
}

export async function createSeededGraph(options: {
  name: string;
  nodes?: unknown[];
  connections?: unknown[];
  drawings?: unknown[];
  context: string;
}): Promise<GraphResponse> {
  const attempts = 3;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await createSeededGraphOnce(options);
    } catch (error) {
      lastError = error;
      if (attempt === attempts) {
        break;
      }
      await delay(250);
    }
  }

  throw new Error(
    `${options.context} failed after ${attempts} attempts: ${lastError instanceof Error ? lastError.message : String(lastError)}`
  );
}

export async function fetchGraph(graphId: string): Promise<GraphResponse> {
  return readGraphSnapshot(graphId, E2E_ASSERT_TIMEOUT_MS);
}

export async function updateGraphName(graphId: string, name: string): Promise<void> {
  const graph = await fetchGraph(graphId);
  if (typeof graph.revision !== 'number') {
    throw new Error(`Graph ${graphId} is missing revision metadata`);
  }

  const response = await fetch(`${E2E_BACKEND_URL}/api/graphs/${graphId}/commands`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      baseRevision: graph.revision,
      commands: [
        {
          kind: 'set_graph_name',
          name,
        },
      ],
    }),
  });

  await expectJsonResponse(response, `Update graph ${graphId} name`);
}

export async function createNumericInputGraph(options?: {
  value?: number;
  min?: number;
  max?: number;
  step?: number;
  propagateWhileDragging?: boolean;
  dragDebounceSeconds?: number;
  nodeName?: string;
  nodePosition?: { x: number; y: number };
}): Promise<{ graphId: string; nodeId: string }> {
  const nodeId = randomUUID();
  const node: GraphNodePayload = {
    id: nodeId,
    type: 'numeric_input',
    position: options?.nodePosition ?? { x: 120, y: 140 },
    metadata: {
      name: options?.nodeName ?? 'Numeric Input',
      inputs: [],
      outputs: [{ name: 'value', schema: { type: 'number' } }],
    },
    config: {
      type: 'numeric_input',
      config: {
        value: options?.value ?? 0,
        min: options?.min ?? 0,
        max: options?.max ?? 100,
        step: options?.step ?? 1,
        dragDebounceSeconds: options?.dragDebounceSeconds ?? 0.1,
        ...(options?.propagateWhileDragging === true
          ? { propagateWhileDragging: true }
          : {}),
      },
    },
    version: Date.now().toString(),
  };

  const graph = await createSeededGraph({
    name: `e2e_numeric_slider_${Date.now()}`,
    nodes: [node],
    context: 'Create graph',
  });
  return { graphId: graph.id, nodeId };
}

export async function createEmptyGraph(name?: string): Promise<{ graphId: string }> {
  const graph = await createEmptyGraphDocument(
    name ?? `e2e_graph_${Date.now()}`,
    'Create empty graph'
  );
  return { graphId: graph.id };
}

export async function createAnnotationGraph(options?: {
  nodeName?: string;
  nodePosition?: { x: number; y: number };
  text?: string;
  backgroundColor?: string;
  borderColor?: string;
  fontColor?: string;
  fontSize?: number;
  cardWidth?: number;
  cardHeight?: number;
}): Promise<{ graphId: string; nodeId: string }> {
  const nodeId = randomUUID();
  const node: AnnotationNodePayload = {
    id: nodeId,
    type: 'annotation',
    position: options?.nodePosition ?? { x: 120, y: 140 },
    metadata: {
      name: options?.nodeName ?? 'Annotation',
      inputs: [],
      outputs: [],
    },
    config: {
      type: 'annotation',
      config: {
        text: options?.text ?? '',
        backgroundColor: options?.backgroundColor ?? '#fef3c7',
        borderColor: options?.borderColor ?? '#334155',
        fontColor: options?.fontColor ?? '#1f2937',
        ...(typeof options?.fontSize === 'number' ? { fontSize: options.fontSize } : {}),
        ...(typeof options?.cardWidth === 'number' ? { cardWidth: options.cardWidth } : {}),
        ...(typeof options?.cardHeight === 'number' ? { cardHeight: options.cardHeight } : {}),
      },
    },
    version: Date.now().toString(),
  };

  const graph = await createSeededGraph({
    name: `e2e_annotation_${Date.now()}`,
    nodes: [node],
    context: 'Create annotation graph',
  });
  return { graphId: graph.id, nodeId };
}

export async function createAnnotationArrowGraph(): Promise<{
  graphId: string;
  leftInlineId: string;
  middleInlineId: string;
  rightAnnotationId: string;
}> {
  const leftInlineId = randomUUID();
  const middleInlineId = randomUUID();
  const rightAnnotationId = randomUUID();

  const leftInline: InlineNodePayload = {
    id: leftInlineId,
    type: 'inline_code',
    position: { x: 100, y: 166 },
    metadata: {
      name: 'Left Inline',
      inputs: [{ name: 'input', schema: { type: 'number' } }],
      outputs: [{ name: 'output', schema: { type: 'number' } }],
    },
    config: {
      type: 'inline_code',
      code: 'outputs.output = inputs.input ?? 0;',
      runtime: 'javascript_vm',
    },
    version: Date.now().toString(),
  };

  const middleInline: InlineNodePayload = {
    id: middleInlineId,
    type: 'inline_code',
    position: { x: 440, y: 166 },
    metadata: {
      name: 'Middle Inline',
      inputs: [{ name: 'input', schema: { type: 'number' } }],
      outputs: [{ name: 'output', schema: { type: 'number' } }],
    },
    config: {
      type: 'inline_code',
      code: 'outputs.output = inputs.input ?? 0;',
      runtime: 'javascript_vm',
    },
    version: Date.now().toString(),
  };

  const rightAnnotation: AnnotationNodePayload = {
    id: rightAnnotationId,
    type: 'annotation',
    position: { x: 820, y: 100 },
    metadata: {
      name: 'Right Annotation',
      inputs: [],
      outputs: [],
    },
    config: {
      type: 'annotation',
      config: {
        text: 'Right note',
        backgroundColor: '#fef3c7',
        borderColor: '#334155',
        fontColor: '#1f2937',
        cardWidth: 320,
        cardHeight: 200,
      },
    },
    version: Date.now().toString(),
  };

  const graph = await createSeededGraph({
    name: `e2e_annotation_arrows_${Date.now()}`,
    nodes: [leftInline, middleInline, rightAnnotation],
    context: 'Create annotation arrow graph',
  });
  return {
    graphId: graph.id,
    leftInlineId,
    middleInlineId,
    rightAnnotationId,
  };
}

export async function createInlineInputReplacementGraph(): Promise<{
  graphId: string;
  sourceAId: string;
  sourceBId: string;
  targetId: string;
}> {
  const sourceAId = randomUUID();
  const sourceBId = randomUUID();
  const targetId = randomUUID();

  const sourceA: InlineNodePayload = {
    id: sourceAId,
    type: 'inline_code',
    position: { x: 120, y: 120 },
    metadata: {
      name: 'Source A',
      inputs: [],
      outputs: [{ name: 'output', schema: { type: 'number' } }],
    },
    config: {
      type: 'inline_code',
      code: 'outputs.output = 1;',
      runtime: 'javascript_vm',
    },
    version: Date.now().toString(),
  };

  const sourceB: InlineNodePayload = {
    id: sourceBId,
    type: 'inline_code',
    position: { x: 120, y: 300 },
    metadata: {
      name: 'Source B',
      inputs: [],
      outputs: [{ name: 'output', schema: { type: 'number' } }],
    },
    config: {
      type: 'inline_code',
      code: 'outputs.output = 2;',
      runtime: 'javascript_vm',
    },
    version: `${Date.now() + 1}`,
  };

  const target: InlineNodePayload = {
    id: targetId,
    type: 'inline_code',
    position: { x: 460, y: 210 },
    metadata: {
      name: 'Target',
      inputs: [{ name: 'input', schema: { type: 'number' } }],
      outputs: [{ name: 'output', schema: { type: 'number' } }],
    },
    config: {
      type: 'inline_code',
      code: 'outputs.output = inputs.input ?? 0;',
      runtime: 'javascript_vm',
    },
    version: `${Date.now() + 2}`,
  };

  const graph = await createSeededGraph({
    name: `e2e_single_inbound_${Date.now()}`,
    nodes: [sourceA, sourceB, target],
    connections: [
      {
        id: randomUUID(),
        sourceNodeId: sourceAId,
        sourcePort: 'output',
        targetNodeId: targetId,
        targetPort: 'input',
      },
    ],
    context: 'Create single-inbound graph',
  });
  return {
    graphId: graph.id,
    sourceAId,
    sourceBId,
    targetId,
  };
}

export interface GraphConnectionSnapshot {
  id: string;
  sourceNodeId: string;
  sourcePort: string;
  sourceAnchor?: ConnectionAnchorPayload;
  targetNodeId: string;
  targetPort: string;
  targetAnchor?: ConnectionAnchorPayload;
}

function normalizeConnectionAnchor(
  anchor: { side?: unknown; offset?: unknown } | undefined
): ConnectionAnchorPayload | undefined {
  if (!anchor) {
    return undefined;
  }

  const side = anchor.side;
  const offset = anchor.offset;
  if (
    (side !== 'top' && side !== 'right' && side !== 'bottom' && side !== 'left') ||
    typeof offset !== 'number' ||
    !Number.isFinite(offset)
  ) {
    throw new Error(`Invalid connection anchor: ${JSON.stringify(anchor)}`);
  }

  return { side, offset };
}

export async function getGraphConnections(graphId: string): Promise<GraphConnectionSnapshot[]> {
  const graph = await readGraphSnapshot(graphId);
  const connections = Array.isArray(graph.connections) ? graph.connections : [];

  return connections.map((connection) => {
    if (
      typeof connection.id !== 'string' ||
      typeof connection.sourceNodeId !== 'string' ||
      typeof connection.sourcePort !== 'string' ||
      typeof connection.targetNodeId !== 'string' ||
      typeof connection.targetPort !== 'string'
    ) {
      throw new Error(`Graph ${graphId} returned an invalid connection payload: ${JSON.stringify(connection)}`);
    }

    return {
      id: connection.id,
      sourceNodeId: connection.sourceNodeId,
      sourcePort: connection.sourcePort,
      sourceAnchor: normalizeConnectionAnchor(connection.sourceAnchor),
      targetNodeId: connection.targetNodeId,
      targetPort: connection.targetPort,
      targetAnchor: normalizeConnectionAnchor(connection.targetAnchor),
    };
  });
}

export async function waitForGraphConnections(
  graphId: string,
  predicate: (connections: GraphConnectionSnapshot[]) => boolean,
  timeoutMs = E2E_ASSERT_TIMEOUT_MS
): Promise<GraphConnectionSnapshot[]> {
  const startedAt = Date.now();
  let lastConnections: GraphConnectionSnapshot[] = [];

  while ((Date.now() - startedAt) < timeoutMs) {
    lastConnections = await getGraphConnections(graphId);
    if (predicate(lastConnections)) {
      return lastConnections;
    }
    await delay(120);
  }

  throw new Error(
    `Timed out waiting for graph connections in graph ${graphId}. Last value: ${JSON.stringify(lastConnections)}`
  );
}

export async function getNumericNodeValue(graphId: string, nodeId: string): Promise<number> {
  const graph = await readGraphSnapshot(graphId);
  const node = graph.nodes.find((candidate) => candidate.id === nodeId);
  assert.ok(node, `Graph ${graphId} is missing node ${nodeId}`);

  const value = node.config?.config?.value;
  assert.equal(typeof value, 'number', `Node ${nodeId} value must be a number`);
  return value;
}

export async function waitForNumericNodeValue(
  graphId: string,
  nodeId: string,
  predicate: (value: number) => boolean,
  timeoutMs = E2E_ASSERT_TIMEOUT_MS
): Promise<number> {
  const startedAt = Date.now();
  let lastValue = Number.NaN;

  while ((Date.now() - startedAt) < timeoutMs) {
    lastValue = await getNumericNodeValue(graphId, nodeId);
    if (predicate(lastValue)) {
      return lastValue;
    }
    await delay(120);
  }

  throw new Error(
    `Timed out waiting for numeric node value in graph ${graphId}. Last value: ${lastValue}`
  );
}

export async function getNodeCardSize(
  graphId: string,
  nodeId: string
): Promise<{ width: number | null; height: number | null }> {
  const graph = await readGraphSnapshot(graphId);
  const node = graph.nodes.find((candidate) => candidate.id === nodeId);
  assert.ok(node, `Graph ${graphId} is missing node ${nodeId}`);

  const widthCandidate = node.config?.config?.cardWidth;
  const heightCandidate = node.config?.config?.cardHeight;
  const width = typeof widthCandidate === 'number' && Number.isFinite(widthCandidate) ? widthCandidate : null;
  const height = typeof heightCandidate === 'number' && Number.isFinite(heightCandidate) ? heightCandidate : null;
  return { width, height };
}

export async function getNodePosition(
  graphId: string,
  nodeId: string
): Promise<{ x: number; y: number }> {
  const graph = await readGraphSnapshot(graphId);
  const node = graph.nodes.find((candidate) => candidate.id === nodeId);
  assert.ok(node, `Graph ${graphId} is missing node ${nodeId}`);
  assert.ok(
    node.position &&
    typeof node.position.x === 'number' &&
    typeof node.position.y === 'number',
    `Node ${nodeId} should include numeric position`
  );
  return {
    x: node.position.x,
    y: node.position.y,
  };
}

export async function getAnnotationNodeText(
  graphId: string,
  nodeId: string
): Promise<string> {
  const graph = await readGraphSnapshot(graphId);
  const node = graph.nodes.find((candidate) => candidate.id === nodeId);
  assert.ok(node, `Graph ${graphId} is missing node ${nodeId}`);
  const text = node.config?.config?.text;
  assert.equal(typeof text, 'string', `Node ${nodeId} annotation text must be a string`);
  return text;
}

export async function getAnnotationNodeFontSize(
  graphId: string,
  nodeId: string
): Promise<number> {
  const graph = await readGraphSnapshot(graphId);
  const node = graph.nodes.find((candidate) => candidate.id === nodeId);
  assert.ok(node, `Graph ${graphId} is missing node ${nodeId}`);
  const fontSize = node.config?.config?.fontSize;
  assert.equal(typeof fontSize, 'number', `Node ${nodeId} annotation fontSize must be a number`);
  return fontSize;
}

export async function waitForNodeCardSize(
  graphId: string,
  nodeId: string,
  predicate: (size: { width: number | null; height: number | null }) => boolean,
  timeoutMs = E2E_ASSERT_TIMEOUT_MS
): Promise<{ width: number | null; height: number | null }> {
  const startedAt = Date.now();
  let lastSize: { width: number | null; height: number | null } = { width: null, height: null };

  while ((Date.now() - startedAt) < timeoutMs) {
    lastSize = await getNodeCardSize(graphId, nodeId);
    if (predicate(lastSize)) {
      return lastSize;
    }
    await delay(120);
  }

  throw new Error(
    `Timed out waiting for node card size in graph ${graphId}. Last size: ${JSON.stringify(lastSize)}`
  );
}

export async function waitForNodePosition(
  graphId: string,
  nodeId: string,
  predicate: (position: { x: number; y: number }) => boolean,
  timeoutMs = E2E_ASSERT_TIMEOUT_MS
): Promise<{ x: number; y: number }> {
  const startedAt = Date.now();
  let lastPosition = { x: Number.NaN, y: Number.NaN };

  while ((Date.now() - startedAt) < timeoutMs) {
    lastPosition = await getNodePosition(graphId, nodeId);
    if (predicate(lastPosition)) {
      return lastPosition;
    }
    await delay(120);
  }

  throw new Error(
    `Timed out waiting for node position in graph ${graphId}. Last value: ${JSON.stringify(lastPosition)}`
  );
}

export async function waitForAnnotationNodeText(
  graphId: string,
  nodeId: string,
  predicate: (text: string) => boolean,
  timeoutMs = E2E_ASSERT_TIMEOUT_MS
): Promise<string> {
  const startedAt = Date.now();
  let lastText = '';

  while ((Date.now() - startedAt) < timeoutMs) {
    lastText = await getAnnotationNodeText(graphId, nodeId);
    if (predicate(lastText)) {
      return lastText;
    }
    await delay(120);
  }

  throw new Error(
    `Timed out waiting for annotation text in graph ${graphId}. Last value: ${JSON.stringify(lastText)}`
  );
}

export async function waitForAnnotationNodeFontSize(
  graphId: string,
  nodeId: string,
  predicate: (fontSize: number) => boolean,
  timeoutMs = E2E_ASSERT_TIMEOUT_MS
): Promise<number> {
  const startedAt = Date.now();
  let lastFontSize = Number.NaN;

  while ((Date.now() - startedAt) < timeoutMs) {
    lastFontSize = await getAnnotationNodeFontSize(graphId, nodeId);
    if (predicate(lastFontSize)) {
      return lastFontSize;
    }
    await delay(120);
  }

  throw new Error(
    `Timed out waiting for annotation font size in graph ${graphId}. Last value: ${JSON.stringify(lastFontSize)}`
  );
}

export async function waitForGraphNodeByName(
  graphId: string,
  nodeName: string,
  timeoutMs = E2E_ASSERT_TIMEOUT_MS
): Promise<GraphResponse['nodes'][number]> {
  const startedAt = Date.now();

  while ((Date.now() - startedAt) < timeoutMs) {
    const graph = await readGraphSnapshot(graphId);
    const node = graph.nodes.find((candidate) => candidate.metadata?.name === nodeName);
    if (node) {
      return node;
    }

    await delay(120);
  }

  throw new Error(
    `Timed out waiting for node "${nodeName}" in graph ${graphId}`
  );
}

export async function getGraphCanvasBackground(
  graphId: string
): Promise<{ mode: string; baseColor: string }> {
  const graph = await readGraphSnapshot(graphId);

  const mode = graph.canvasBackground?.mode;
  const baseColor = graph.canvasBackground?.baseColor;
  if (typeof mode !== 'string') {
    throw new Error(`Graph ${graphId} canvas background mode should be a string`);
  }
  if (typeof baseColor !== 'string') {
    throw new Error(`Graph ${graphId} canvas background color should be a string`);
  }
  return {
    mode,
    baseColor: baseColor.toLowerCase(),
  };
}

export async function waitForGraphCanvasBackground(
  graphId: string,
  predicate: (background: { mode: string; baseColor: string }) => boolean,
  timeoutMs = E2E_ASSERT_TIMEOUT_MS
): Promise<{ mode: string; baseColor: string }> {
  const startedAt = Date.now();
  let lastBackground: { mode: string; baseColor: string } = { mode: '', baseColor: '' };

  while ((Date.now() - startedAt) < timeoutMs) {
    lastBackground = await getGraphCanvasBackground(graphId);
    if (predicate(lastBackground)) {
      return lastBackground;
    }

    await delay(120);
  }

  throw new Error(
    `Timed out waiting for canvas background in graph ${graphId}. Last value: ${JSON.stringify(lastBackground)}`
  );
}
