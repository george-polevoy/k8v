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
    };
  };
  version: string;
}

interface GraphResponse {
  id: string;
  canvasBackground?: {
    mode?: unknown;
    baseColor?: unknown;
  };
  nodes: Array<{
    id: string;
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
      };
    };
  }>;
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

export async function createNumericInputGraph(options?: {
  value?: number;
  min?: number;
  max?: number;
  step?: number;
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
      },
    },
    version: Date.now().toString(),
  };

  const response = await fetch(`${E2E_BACKEND_URL}/api/graphs`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      name: toAutotestGraphName(`e2e_numeric_slider_${Date.now()}`),
      nodes: [node],
      connections: [],
      drawings: [],
    }),
  });

  const graph = await expectJsonResponse(response, 'Create graph') as GraphResponse;
  assert.ok(graph.id, 'Create graph response should include graph id');
  return { graphId: graph.id, nodeId };
}

export async function createEmptyGraph(name?: string): Promise<{ graphId: string }> {
  const response = await fetch(`${E2E_BACKEND_URL}/api/graphs`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      name: toAutotestGraphName(name ?? `e2e_graph_${Date.now()}`),
      nodes: [],
      connections: [],
      drawings: [],
    }),
  });

  const graph = await expectJsonResponse(response, 'Create empty graph') as GraphResponse;
  assert.ok(graph.id, 'Create empty graph response should include graph id');
  return { graphId: graph.id };
}

export async function getNumericNodeValue(graphId: string, nodeId: string): Promise<number> {
  const response = await fetch(`${E2E_BACKEND_URL}/api/graphs/${graphId}`, {
    method: 'GET',
    headers: {
      accept: 'application/json',
    },
  });
  const graph = await expectJsonResponse(response, `Fetch graph ${graphId}`) as GraphResponse;
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
  const response = await fetch(`${E2E_BACKEND_URL}/api/graphs/${graphId}`, {
    method: 'GET',
    headers: {
      accept: 'application/json',
    },
  });
  const graph = await expectJsonResponse(response, `Fetch graph ${graphId}`) as GraphResponse;
  const node = graph.nodes.find((candidate) => candidate.id === nodeId);
  assert.ok(node, `Graph ${graphId} is missing node ${nodeId}`);

  const widthCandidate = node.config?.config?.cardWidth;
  const heightCandidate = node.config?.config?.cardHeight;
  const width = typeof widthCandidate === 'number' && Number.isFinite(widthCandidate) ? widthCandidate : null;
  const height = typeof heightCandidate === 'number' && Number.isFinite(heightCandidate) ? heightCandidate : null;
  return { width, height };
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

export async function waitForGraphNodeByName(
  graphId: string,
  nodeName: string,
  timeoutMs = E2E_ASSERT_TIMEOUT_MS
): Promise<GraphResponse['nodes'][number]> {
  const startedAt = Date.now();

  while ((Date.now() - startedAt) < timeoutMs) {
    const response = await fetch(`${E2E_BACKEND_URL}/api/graphs/${graphId}`, {
      method: 'GET',
      headers: {
        accept: 'application/json',
      },
    });
    const graph = await expectJsonResponse(response, `Fetch graph ${graphId}`) as GraphResponse;
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
  const response = await fetch(`${E2E_BACKEND_URL}/api/graphs/${graphId}`, {
    method: 'GET',
    headers: {
      accept: 'application/json',
    },
  });
  const graph = await expectJsonResponse(response, `Fetch graph ${graphId}`) as GraphResponse;

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
