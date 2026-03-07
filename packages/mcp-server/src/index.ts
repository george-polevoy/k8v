import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { chromium } from 'playwright';
import { z } from 'zod';
import {
  applyProjectionToNodes,
  cloneProjectionNodeCardSizes,
  cloneProjectionNodePositions,
  type Connection,
  DEFAULT_GRAPH_PROJECTION_ID,
  type Graph,
  type GraphNode,
  type GraphProjection,
  normalizeCanvasBackground,
  normalizeDrawingColor,
  normalizeGraph,
  normalizeGraphProjectionState,
  type PortDefinition,
  type PythonEnvironment,
  type RenderBitmap,
  type RenderRegion,
} from './graphModel.js';

const DEFAULT_BACKEND_URL = process.env.K8V_BACKEND_URL ?? 'http://127.0.0.1:3000';
const DEFAULT_FRONTEND_URL = process.env.K8V_FRONTEND_URL ?? 'http://127.0.0.1:5173';
const PORT_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

function textResult(payload: unknown) {
  return {
    content: [
      {
        type: 'text' as const,
        text: typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2),
      },
    ],
  };
}

function sanitizeBaseUrl(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

async function requestJson<T>(
  baseUrl: string,
  endpoint: string,
  init?: RequestInit
): Promise<T> {
  const normalizedBaseUrl = sanitizeBaseUrl(baseUrl);
  const response = await fetch(`${normalizedBaseUrl}${endpoint}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });

  const raw = await response.text();
  let parsed: unknown = {};
  if (raw) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = { raw };
    }
  }

  if (!response.ok) {
    const message =
      typeof (parsed as { error?: unknown }).error === 'string'
        ? (parsed as { error: string }).error
        : `Request failed (${response.status} ${response.statusText})`;
    throw new Error(message);
  }

  return parsed as T;
}

async function requestBinary(
  baseUrl: string,
  endpoint: string,
  init?: RequestInit
): Promise<{ buffer: Buffer; headers: Headers }> {
  const normalizedBaseUrl = sanitizeBaseUrl(baseUrl);
  const response = await fetch(`${normalizedBaseUrl}${endpoint}`, init);

  if (!response.ok) {
    const raw = await response.text();
    let errorMessage = `Request failed (${response.status} ${response.statusText})`;
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as { error?: unknown };
        if (typeof parsed.error === 'string' && parsed.error.trim()) {
          errorMessage = parsed.error;
        }
      } catch {
        // Keep default error message.
      }
    }
    throw new Error(errorMessage);
  }

  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    headers: response.headers,
  };
}

function resolveBackendUrl(explicitUrl?: string): string {
  return sanitizeBaseUrl(explicitUrl ?? DEFAULT_BACKEND_URL);
}

function resolveFrontendUrl(explicitUrl?: string): string {
  return sanitizeBaseUrl(explicitUrl ?? DEFAULT_FRONTEND_URL);
}

const GRAPH_QUERY_NODE_FIELD_VALUES = [
  'id',
  'name',
  'type',
  'version',
  'inputNames',
  'outputNames',
] as const;
const GRAPH_QUERY_CONNECTION_FIELD_VALUES = [
  'id',
  'sourceNodeId',
  'sourcePort',
  'targetNodeId',
  'targetPort',
] as const;
const GRAPH_QUERY_OPERATION_VALUES = [
  'overview',
  'starting_vertices',
  'traverse_bfs',
  'traverse_dfs',
] as const;

const GRAPH_QUERY_NODE_FIELD_SCHEMA = z.enum(GRAPH_QUERY_NODE_FIELD_VALUES);
const GRAPH_QUERY_CONNECTION_FIELD_SCHEMA = z.enum(GRAPH_QUERY_CONNECTION_FIELD_VALUES);

export const GRAPH_QUERY_OPERATION_SCHEMA = z.discriminatedUnion('operation', [
  z.object({
    operation: z.literal('overview'),
    nodeFields: z.array(GRAPH_QUERY_NODE_FIELD_SCHEMA).optional(),
    connectionFields: z.array(GRAPH_QUERY_CONNECTION_FIELD_SCHEMA).optional(),
  }),
  z.object({
    operation: z.literal('starting_vertices'),
    nodeFields: z.array(GRAPH_QUERY_NODE_FIELD_SCHEMA).optional(),
    connectionFields: z.array(GRAPH_QUERY_CONNECTION_FIELD_SCHEMA).optional(),
  }),
  z.object({
    operation: z.literal('traverse_bfs'),
    startNodeIds: z.array(z.string().trim().min(1)).min(1),
    depth: z.number().int().nonnegative().optional(),
    nodeFields: z.array(GRAPH_QUERY_NODE_FIELD_SCHEMA).optional(),
    connectionFields: z.array(GRAPH_QUERY_CONNECTION_FIELD_SCHEMA).optional(),
  }),
  z.object({
    operation: z.literal('traverse_dfs'),
    startNodeIds: z.array(z.string().trim().min(1)).min(1),
    maxNodes: z.number().int().positive(),
    nodeFields: z.array(GRAPH_QUERY_NODE_FIELD_SCHEMA).optional(),
    connectionFields: z.array(GRAPH_QUERY_CONNECTION_FIELD_SCHEMA).optional(),
  }),
]);
type GraphQueryOperation = z.infer<typeof GRAPH_QUERY_OPERATION_SCHEMA>;

async function getGraph(backendUrl: string, graphId: string): Promise<Graph> {
  const graph = await requestJson<Graph>(backendUrl, `/api/graphs/${encodeURIComponent(graphId)}`);
  return normalizeGraph(graph);
}

interface UpdateGraphRequestOptions {
  noRecompute?: boolean;
}

function buildGraphUpdateEndpoint(graphId: string, options?: UpdateGraphRequestOptions): string {
  const params = new URLSearchParams();
  if (options?.noRecompute) {
    params.set('noRecompute', 'true');
  }
  const query = params.toString();
  return `/api/graphs/${encodeURIComponent(graphId)}${query ? `?${query}` : ''}`;
}

async function updateGraph(
  backendUrl: string,
  graphId: string,
  mutate: (graph: Graph) => Graph
): Promise<Graph> {
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const currentGraph = await getGraph(backendUrl, graphId);
    const nextGraph = normalizeGraph(mutate(structuredClone(currentGraph)));
    const body = {
      ...nextGraph,
      id: graphId,
      updatedAt: Date.now(),
      ifMatchUpdatedAt: currentGraph.updatedAt,
    };

    try {
      const persisted = await requestJson<Graph>(backendUrl, buildGraphUpdateEndpoint(graphId), {
        method: 'PUT',
        body: JSON.stringify(body),
      });
      return normalizeGraph(persisted);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempt < maxAttempts && /reload and retry/i.test(message)) {
        continue;
      }
      throw error;
    }
  }

  throw new Error(`Failed to update graph ${graphId} after ${maxAttempts} attempts`);
}

async function updateGraphConnectionsWithResult<TResult>(
  backendUrl: string,
  graphId: string,
  mutateConnections: (graph: Graph) => { connections: Connection[]; result: TResult },
  options?: UpdateGraphRequestOptions
): Promise<{ graph: Graph; result: TResult }> {
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const currentGraph = await getGraph(backendUrl, graphId);
    const mutation = mutateConnections(structuredClone(currentGraph));

    const body = {
      connections: mutation.connections,
      ifMatchUpdatedAt: currentGraph.updatedAt,
    };

    try {
      const persisted = await requestJson<Graph>(
        backendUrl,
        buildGraphUpdateEndpoint(graphId, options),
        {
          method: 'PUT',
          body: JSON.stringify(body),
        }
      );
      return {
        graph: normalizeGraph(persisted),
        result: mutation.result,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempt < maxAttempts && /reload and retry/i.test(message)) {
        continue;
      }
      throw error;
    }
  }

  throw new Error(`Failed to update graph ${graphId} after ${maxAttempts} attempts`);
}

async function updateGraphConnections(
  backendUrl: string,
  graphId: string,
  mutateConnections: (graph: Graph) => Connection[],
  options?: UpdateGraphRequestOptions
): Promise<Graph> {
  const result = await updateGraphConnectionsWithResult(
    backendUrl,
    graphId,
    (graph) => ({
      connections: mutateConnections(graph),
      result: undefined,
    }),
    options
  );
  return result.graph;
}

function getNode(graph: Graph, nodeId: string): GraphNode {
  const node = graph.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) {
    throw new Error(`Node ${nodeId} not found in graph ${graph.id}`);
  }
  return node;
}

function assertValidPortName(name: string, kind: 'input' | 'output'): void {
  if (!PORT_NAME_PATTERN.test(name)) {
    throw new Error(
      `${kind} port name "${name}" is invalid. Use letters/numbers/underscore and start with letter/underscore.`
    );
  }
}

export interface ConnectionListFilters {
  nodeId?: string;
  targetPort?: string;
}

export function filterConnections(
  connections: Connection[],
  filters: ConnectionListFilters = {}
): Connection[] {
  const nodeId = filters.nodeId?.trim();
  const targetPort = filters.targetPort?.trim();

  return connections.filter((connection) => {
    if (nodeId && connection.sourceNodeId !== nodeId && connection.targetNodeId !== nodeId) {
      return false;
    }
    if (targetPort && connection.targetPort !== targetPort) {
      return false;
    }
    return true;
  });
}

interface ConnectionSetInput {
  sourceNodeId: string;
  sourcePort: string;
  targetNodeId: string;
  targetPort: string;
  connectionId?: string;
}

interface ConnectionSetResult {
  changed: boolean;
  connection: Connection;
  connections: Connection[];
  replacedConnectionIds: string[];
}

function assertConnectionPortsExist(
  graph: Graph,
  sourceNodeId: string,
  sourcePort: string,
  targetNodeId: string,
  targetPort: string
): void {
  const sourceNode = getNode(graph, sourceNodeId);
  const targetNode = getNode(graph, targetNodeId);
  if (!sourceNode.metadata.outputs.some((output) => output.name === sourcePort)) {
    throw new Error(`Source port ${sourcePort} not found on node ${sourceNodeId}`);
  }
  if (!targetNode.metadata.inputs.some((input) => input.name === targetPort)) {
    throw new Error(`Target port ${targetPort} not found on node ${targetNodeId}`);
  }
}

function applyConnectionSet(current: Graph, input: ConnectionSetInput): ConnectionSetResult {
  assertConnectionPortsExist(
    current,
    input.sourceNodeId,
    input.sourcePort,
    input.targetNodeId,
    input.targetPort
  );

  const inbound = current.connections.filter(
    (connection) =>
      connection.targetNodeId === input.targetNodeId &&
      connection.targetPort === input.targetPort
  );

  const matchingInbound = inbound.find(
    (connection) =>
      connection.sourceNodeId === input.sourceNodeId &&
      connection.sourcePort === input.sourcePort
  );

  const explicitConnectionId = input.connectionId?.trim() || undefined;
  if (explicitConnectionId) {
    const conflicting = current.connections.find(
      (connection) =>
        connection.id === explicitConnectionId &&
        !inbound.some((candidate) => candidate.id === explicitConnectionId)
    );
    if (conflicting) {
      throw new Error(`Connection id ${explicitConnectionId} already exists in graph ${current.id}`);
    }
  }

  const nextConnectionId = explicitConnectionId ?? matchingInbound?.id ?? randomUUID();
  const existingSingleInbound = inbound.length === 1 ? inbound[0] : undefined;
  const unchanged =
    Boolean(existingSingleInbound) &&
    existingSingleInbound?.sourceNodeId === input.sourceNodeId &&
    existingSingleInbound?.sourcePort === input.sourcePort &&
    existingSingleInbound?.id === nextConnectionId;

  if (unchanged && existingSingleInbound) {
    return {
      changed: false,
      connection: existingSingleInbound,
      connections: current.connections,
      replacedConnectionIds: [],
    };
  }

  const nextConnection: Connection = {
    id: nextConnectionId,
    sourceNodeId: input.sourceNodeId,
    sourcePort: input.sourcePort,
    targetNodeId: input.targetNodeId,
    targetPort: input.targetPort,
  };

  return {
    changed: true,
    connection: nextConnection,
    connections: [
      ...current.connections.filter(
        (connection) =>
          !(connection.targetNodeId === input.targetNodeId && connection.targetPort === input.targetPort)
      ),
      nextConnection,
    ],
    replacedConnectionIds: inbound
      .filter((connection) => connection.id !== nextConnectionId)
      .map((connection) => connection.id),
  };
}

interface PortMatch {
  name: string;
  index: number;
}

const DICT_HELPER_METHODS = new Set([
  'get',
  'items',
  'keys',
  'values',
  'pop',
  'setdefault',
  'update',
  'copy',
  'clear',
  'fromkeys',
]);

function collectPortMatches(code: string, pattern: RegExp): PortMatch[] {
  const matches: PortMatch[] = [];
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(code)) !== null) {
    const candidate = match[1];
    if (!candidate || !PORT_NAME_PATTERN.test(candidate)) {
      continue;
    }

    matches.push({
      name: candidate,
      index: match.index,
    });
  }

  return matches;
}

function uniquePortNamesByAppearance(matches: PortMatch[]): string[] {
  const ordered = [...matches].sort((left, right) => left.index - right.index);
  const seen = new Set<string>();
  const names: string[] = [];

  for (const entry of ordered) {
    if (seen.has(entry.name)) {
      continue;
    }
    seen.add(entry.name);
    names.push(entry.name);
  }

  return names;
}

function inferInputPortNamesFromCode(code: string): string[] {
  if (!code.trim()) {
    return [];
  }

  const dotMatches = collectPortMatches(code, /\binputs\.([A-Za-z_][A-Za-z0-9_]*)\b/g)
    .filter((entry) => !DICT_HELPER_METHODS.has(entry.name));
  const bracketMatches = collectPortMatches(
    code,
    /\binputs\s*\[\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]\s*\]/g
  );
  const getMatches = collectPortMatches(
    code,
    /\binputs\.get\(\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]\s*(?:,|\))/g
  );

  return uniquePortNamesByAppearance([...dotMatches, ...bracketMatches, ...getMatches]);
}

function inferOutputPortNamesFromCode(code: string): string[] {
  if (!code.trim()) {
    return [];
  }

  const dotMatches = collectPortMatches(code, /\boutputs\.([A-Za-z_][A-Za-z0-9_]*)\b/g)
    .filter((entry) => !DICT_HELPER_METHODS.has(entry.name));
  const bracketMatches = collectPortMatches(
    code,
    /\boutputs\s*\[\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]\s*\]/g
  );

  return uniquePortNamesByAppearance([...dotMatches, ...bracketMatches]);
}

function reconcileInlineOutputPorts(
  node: GraphNode,
  code: string,
  connections: Connection[]
): PortDefinition[] {
  const inferredNames = inferOutputPortNamesFromCode(code);
  if (inferredNames.length === 0) {
    return node.metadata.outputs;
  }

  const existingByName = new Map(node.metadata.outputs.map((port) => [port.name, port]));
  const connectedOutputNames = new Set(
    connections
      .filter((connection) => connection.sourceNodeId === node.id)
      .map((connection) => connection.sourcePort)
  );

  const orderedNames: string[] = [];
  const seen = new Set<string>();
  const pushUnique = (name: string) => {
    if (seen.has(name)) {
      return;
    }
    seen.add(name);
    orderedNames.push(name);
  };

  for (const name of inferredNames) {
    pushUnique(name);
  }

  for (const output of node.metadata.outputs) {
    if (connectedOutputNames.has(output.name)) {
      pushUnique(output.name);
    }
  }

  return orderedNames.map((name) => {
    const existing = existingByName.get(name);
    if (existing) {
      return existing;
    }
    return {
      name,
      schema: { type: 'object' },
    };
  });
}

function updateInlineCodeNodeCode(
  node: GraphNode,
  code: string,
  connections: Connection[],
  outputNames?: string[],
  runtime?: string,
  pythonEnv?: string
): GraphNode {
  const existingByName = new Map(node.metadata.outputs.map((port) => [port.name, port]));
  const connectedOutputNames = new Set(
    connections
      .filter((connection) => connection.sourceNodeId === node.id)
      .map((connection) => connection.sourcePort)
  );
  const resolveExplicitOutputNames = (): string[] | null => {
    if (!Array.isArray(outputNames)) {
      return null;
    }

    const orderedNames: string[] = [];
    const seen = new Set<string>();
    const pushUnique = (name: string) => {
      if (!name || seen.has(name)) {
        return;
      }
      seen.add(name);
      orderedNames.push(name);
    };

    for (const candidateName of outputNames) {
      assertValidPortName(candidateName, 'output');
      pushUnique(candidateName);
    }

    for (const existing of node.metadata.outputs) {
      if (connectedOutputNames.has(existing.name)) {
        pushUnique(existing.name);
      }
    }

    return orderedNames;
  };

  const explicitOutputNames = resolveExplicitOutputNames();
  const nextOutputs = node.type === 'inline_code'
    ? (explicitOutputNames
      ? explicitOutputNames.map((name) => existingByName.get(name) ?? { name, schema: { type: 'object' } })
      : reconcileInlineOutputPorts(node, code, connections))
    : node.metadata.outputs;
  const outputNamesChanged =
    nextOutputs.length !== node.metadata.outputs.length ||
    nextOutputs.some((output, index) => output.name !== node.metadata.outputs[index]?.name);

  return {
    ...node,
    ...(outputNamesChanged
      ? {
          metadata: {
            ...node.metadata,
            outputs: nextOutputs,
          },
        }
      : {}),
    config: {
      ...node.config,
      code,
      ...(runtime ? { runtime } : {}),
      ...(pythonEnv ? { pythonEnv } : {}),
    },
    version: ensureNodeVersion(node),
  };
}

function ensureNodeVersion(node: GraphNode): string {
  return `${Date.now()}-${node.id}`;
}

function getNextProjectionName(existingProjections: GraphProjection[]): string {
  const existingNames = new Set(existingProjections.map((projection) => projection.name));
  let index = 1;
  let candidate = `Projection ${index}`;
  while (existingNames.has(candidate)) {
    index += 1;
    candidate = `Projection ${index}`;
  }
  return candidate;
}

interface NumericInputConfig {
  value: number;
  min: number;
  max: number;
  step: number;
}

interface NumericInputNodeOptions {
  nodeId?: string;
  name?: string;
  x: number;
  y: number;
  value?: number;
  min?: number;
  max?: number;
  step?: number;
  autoRecompute?: boolean;
}

function toFiniteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function countStepDecimals(step: number): number {
  const text = step.toString().toLowerCase();
  if (text.includes('e-')) {
    const exponent = Number.parseInt(text.split('e-')[1] ?? '0', 10);
    return Number.isFinite(exponent) ? exponent : 0;
  }

  const decimalIndex = text.indexOf('.');
  if (decimalIndex === -1) {
    return 0;
  }

  return text.length - decimalIndex - 1;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function snapNumericInputValue(value: number, min: number, max: number, step: number): number {
  if (max <= min) {
    return min;
  }

  const clamped = clamp(value, min, max);
  const steps = Math.round((clamped - min) / step);
  const snapped = min + (steps * step);
  const decimals = countStepDecimals(step);
  const rounded = Number(snapped.toFixed(decimals));
  return clamp(rounded, min, max);
}

function normalizeNumericInputConfig(config: {
  value?: unknown;
  min?: unknown;
  max?: unknown;
  step?: unknown;
}): NumericInputConfig {
  const min = toFiniteNumber(config.min, 0);
  const maxCandidate = toFiniteNumber(config.max, 100);
  const max = maxCandidate >= min ? maxCandidate : min;
  const stepCandidate = toFiniteNumber(config.step, 1);
  const step = stepCandidate > 0 ? stepCandidate : 1;
  const valueCandidate = toFiniteNumber(config.value, min);
  const value = snapNumericInputValue(valueCandidate, min, max, step);
  return { value, min, max, step };
}

function createNumericInputNode(options: NumericInputNodeOptions): GraphNode {
  const nodeId = options.nodeId?.trim() || randomUUID();
  const nowVersion = `${Date.now()}-${nodeId}`;
  const numericConfig = normalizeNumericInputConfig({
    value: options.value,
    min: options.min,
    max: options.max,
    step: options.step,
  });

  return {
    id: nodeId,
    type: 'numeric_input',
    position: { x: options.x, y: options.y },
    metadata: {
      name: options.name ?? 'Numeric Input',
      inputs: [],
      outputs: [{ name: 'value', schema: { type: 'number' } }],
    },
    config: {
      type: 'numeric_input',
      config: {
        value: numericConfig.value,
        min: numericConfig.min,
        max: numericConfig.max,
        step: numericConfig.step,
        ...(typeof options.autoRecompute === 'boolean'
          ? { autoRecompute: options.autoRecompute }
          : {}),
      },
    },
    version: nowVersion,
  };
}

export const BULK_EDIT_OPERATION_SCHEMA = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('graph_set_name'),
    name: z.string(),
  }),
  z.object({
    op: z.literal('graph_projection_add'),
    projectionId: z.string().trim().min(1).optional(),
    name: z.string().trim().min(1).optional(),
    sourceProjectionId: z.string().trim().min(1).optional(),
    activate: z.boolean().optional(),
  }),
  z.object({
    op: z.literal('graph_projection_select'),
    projectionId: z.string().trim().min(1),
  }),
  z.object({
    op: z.literal('graph_python_env_add'),
    name: z.string().trim().min(1),
    pythonPath: z.string().trim().min(1),
    cwd: z.string().trim().min(1),
  }),
  z.object({
    op: z.literal('graph_python_env_edit'),
    envName: z.string().trim().min(1),
    name: z.string().trim().min(1).optional(),
    pythonPath: z.string().trim().min(1).optional(),
    cwd: z.string().trim().min(1).optional(),
  }),
  z.object({
    op: z.literal('graph_python_env_delete'),
    envName: z.string().trim().min(1),
  }),
  z.object({
    op: z.literal('drawing_create'),
    drawingId: z.string().trim().min(1).optional(),
    name: z.string().optional(),
    x: z.number().optional(),
    y: z.number().optional(),
  }),
  z.object({
    op: z.literal('drawing_add_path'),
    drawingId: z.string(),
    points: z.array(z.object({ x: z.number(), y: z.number() })).min(1),
    color: z.union([z.string().regex(/^#[0-9a-fA-F]{6}$/), z.enum(['white', 'green', 'red'])]).optional(),
    thickness: z.number().positive().optional(),
    pathId: z.string().optional(),
    coordinateSpace: z.enum(['world', 'local']).optional(),
  }),
  z.object({
    op: z.literal('drawing_move'),
    drawingId: z.string(),
    x: z.number(),
    y: z.number(),
  }),
  z.object({
    op: z.literal('drawing_set_name'),
    drawingId: z.string(),
    name: z.string(),
  }),
  z.object({
    op: z.literal('drawing_delete'),
    drawingId: z.string(),
  }),
  z.object({
    op: z.literal('node_add_inline'),
    nodeId: z.string().trim().min(1).optional(),
    name: z.string().optional(),
    x: z.number(),
    y: z.number(),
    inputNames: z.array(z.string()).optional(),
    outputNames: z.array(z.string()).optional(),
    code: z.string().optional(),
    runtime: z.string().optional(),
    pythonEnv: z.string().optional(),
    autoRecompute: z.boolean().optional(),
  }),
  z.object({
    op: z.literal('node_add_numeric_input'),
    nodeId: z.string().trim().min(1).optional(),
    name: z.string().optional(),
    x: z.number(),
    y: z.number(),
    value: z.number().optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    step: z.number().optional(),
    autoRecompute: z.boolean().optional(),
  }),
  z.object({
    op: z.literal('node_move'),
    nodeId: z.string(),
    x: z.number(),
    y: z.number(),
  }),
  z.object({
    op: z.literal('node_set_name'),
    nodeId: z.string(),
    name: z.string(),
  }),
  z.object({
    op: z.literal('node_set_code'),
    nodeId: z.string(),
    code: z.string(),
    outputNames: z.array(z.string()).optional(),
    runtime: z.string().optional(),
    pythonEnv: z.string().optional(),
  }),
  z.object({
    op: z.literal('node_set_auto_recompute'),
    nodeId: z.string(),
    enabled: z.boolean(),
  }),
  z.object({
    op: z.literal('node_add_input'),
    nodeId: z.string(),
    inputName: z.string(),
  }),
  z.object({
    op: z.literal('node_delete_input'),
    nodeId: z.string(),
    inputName: z.string(),
  }),
  z.object({
    op: z.literal('node_move_input'),
    nodeId: z.string(),
    inputName: z.string(),
    direction: z.enum(['up', 'down']),
  }),
  z.object({
    op: z.literal('node_rename_input'),
    nodeId: z.string(),
    oldName: z.string(),
    newName: z.string(),
  }),
  z.object({
    op: z.literal('node_delete'),
    nodeId: z.string(),
  }),
  z.object({
    op: z.literal('connection_add'),
    sourceNodeId: z.string(),
    sourcePort: z.string(),
    targetNodeId: z.string(),
    targetPort: z.string(),
    connectionId: z.string().optional(),
  }),
  z.object({
    op: z.enum(['connection_set', 'connection_replace']),
    sourceNodeId: z.string(),
    sourcePort: z.string(),
    targetNodeId: z.string(),
    targetPort: z.string(),
    connectionId: z.string().optional(),
  }),
  z.object({
    op: z.literal('connection_delete'),
    connectionId: z.string(),
  }),
]);

type BulkEditOperation = z.infer<typeof BULK_EDIT_OPERATION_SCHEMA>;

type BulkEditOperationResult = {
  graph: Graph;
  details?: Record<string, unknown>;
};

export function applyBulkEditOperation(current: Graph, operation: BulkEditOperation): BulkEditOperationResult {
  switch (operation.op) {
    case 'graph_set_name':
      return {
        graph: {
          ...current,
          name: operation.name,
        },
      };
    case 'graph_projection_add': {
      const projectionState = normalizeGraphProjectionState(
        current.nodes,
        current.projections,
        current.activeProjectionId,
        current.canvasBackground
      );

      const sourceId = operation.sourceProjectionId?.trim() || projectionState.activeProjectionId;
      const sourceProjection = projectionState.projections.find((projection) => projection.id === sourceId);
      if (!sourceProjection) {
        throw new Error(`Projection "${sourceId}" was not found in graph ${current.id}`);
      }

      const nextProjectionId = operation.projectionId?.trim() || randomUUID();
      if (projectionState.projections.some((projection) => projection.id === nextProjectionId)) {
        throw new Error(`Projection "${nextProjectionId}" already exists in graph ${current.id}`);
      }

      const newProjection: GraphProjection = {
        id: nextProjectionId,
        name: operation.name?.trim() || getNextProjectionName(projectionState.projections),
        nodePositions: cloneProjectionNodePositions(current.nodes, sourceProjection),
        nodeCardSizes: cloneProjectionNodeCardSizes(current.nodes, sourceProjection),
        canvasBackground: normalizeCanvasBackground(
          sourceProjection.canvasBackground ?? current.canvasBackground
        ),
      };

      const nextActiveProjectionId = operation.activate === false
        ? projectionState.activeProjectionId
        : newProjection.id;
      const activeProjection = nextActiveProjectionId === newProjection.id
        ? newProjection
        : projectionState.projections.find(
            (projection) => projection.id === nextActiveProjectionId
          ) ?? newProjection;

      return {
        graph: {
          ...current,
          projections: [...projectionState.projections, newProjection],
          activeProjectionId: nextActiveProjectionId,
          nodes: applyProjectionToNodes(current.nodes, activeProjection),
          canvasBackground: normalizeCanvasBackground(
            activeProjection.canvasBackground ?? current.canvasBackground
          ),
        },
        details: {
          projectionId: newProjection.id,
          activeProjectionId: nextActiveProjectionId,
        },
      };
    }
    case 'graph_projection_select': {
      const projectionState = normalizeGraphProjectionState(
        current.nodes,
        current.projections,
        current.activeProjectionId,
        current.canvasBackground
      );
      const selectedProjection = projectionState.projections.find(
        (projection) => projection.id === operation.projectionId
      );
      if (!selectedProjection) {
        throw new Error(`Projection "${operation.projectionId}" was not found in graph ${current.id}`);
      }

      return {
        graph: {
          ...current,
          projections: projectionState.projections,
          activeProjectionId: selectedProjection.id,
          nodes: applyProjectionToNodes(current.nodes, selectedProjection),
          canvasBackground: normalizeCanvasBackground(
            selectedProjection.canvasBackground ?? current.canvasBackground
          ),
        },
      };
    }
    case 'graph_python_env_add': {
      const existingEnvs = current.pythonEnvs ?? [];
      if (existingEnvs.some((env) => env.name === operation.name)) {
        throw new Error(`Python environment "${operation.name}" already exists in graph ${current.id}`);
      }

      return {
        graph: {
          ...current,
          pythonEnvs: [
            ...existingEnvs,
            {
              name: operation.name,
              pythonPath: operation.pythonPath,
              cwd: operation.cwd,
            },
          ],
        },
      };
    }
    case 'graph_python_env_edit': {
      const existingEnvs = current.pythonEnvs ?? [];
      const envIndex = existingEnvs.findIndex((env) => env.name === operation.envName);
      if (envIndex === -1) {
        throw new Error(`Python environment "${operation.envName}" was not found in graph ${current.id}`);
      }

      const existingEnv = existingEnvs[envIndex];
      const nextEnvName = operation.name ?? existingEnv.name;
      const nextEnv: PythonEnvironment = {
        name: nextEnvName,
        pythonPath: operation.pythonPath ?? existingEnv.pythonPath,
        cwd: operation.cwd ?? existingEnv.cwd,
      };

      const duplicateName = existingEnvs.some(
        (env, index) => index !== envIndex && env.name === nextEnv.name
      );
      if (duplicateName) {
        throw new Error(`Python environment "${nextEnv.name}" already exists in graph ${current.id}`);
      }

      const nextNodes =
        nextEnvName === operation.envName
          ? current.nodes
          : current.nodes.map((node) =>
              node.config.pythonEnv === operation.envName
                ? {
                    ...node,
                    config: {
                      ...node.config,
                      pythonEnv: nextEnvName,
                    },
                    version: ensureNodeVersion(node),
                  }
                : node
            );

      return {
        graph: {
          ...current,
          pythonEnvs: existingEnvs.map((env, index) => (index === envIndex ? nextEnv : env)),
          nodes: nextNodes,
        },
      };
    }
    case 'graph_python_env_delete': {
      const existingEnvs = current.pythonEnvs ?? [];
      const hasEnv = existingEnvs.some((env) => env.name === operation.envName);
      if (!hasEnv) {
        throw new Error(`Python environment "${operation.envName}" was not found in graph ${current.id}`);
      }

      return {
        graph: {
          ...current,
          pythonEnvs: existingEnvs.filter((env) => env.name !== operation.envName),
          nodes: current.nodes.map((node) =>
            node.config.pythonEnv === operation.envName
              ? {
                  ...node,
                  config: {
                    ...node.config,
                    pythonEnv: undefined,
                  },
                  version: ensureNodeVersion(node),
                }
              : node
          ),
        },
      };
    }
    case 'drawing_create': {
      const drawingId = operation.drawingId?.trim() || randomUUID();
      if ((current.drawings ?? []).some((drawing) => drawing.id === drawingId)) {
        throw new Error(`Drawing ${drawingId} already exists in graph ${current.id}`);
      }

      return {
        graph: {
          ...current,
          drawings: [
            ...(current.drawings ?? []),
            {
              id: drawingId,
              name: operation.name ?? `Drawing ${((current.drawings ?? []).length + 1)}`,
              position: {
                x: operation.x ?? 0,
                y: operation.y ?? 0,
              },
              paths: [],
            },
          ],
        },
        details: { drawingId },
      };
    }
    case 'drawing_add_path': {
      const drawing = (current.drawings ?? []).find((candidate) => candidate.id === operation.drawingId);
      if (!drawing) {
        throw new Error(`Drawing ${operation.drawingId} not found in graph ${current.id}`);
      }

      const localPoints = (operation.coordinateSpace ?? 'world') === 'local'
        ? operation.points
        : operation.points.map((point) => ({
            x: point.x - drawing.position.x,
            y: point.y - drawing.position.y,
          }));
      const nextPathId = operation.pathId ?? randomUUID();

      return {
        graph: {
          ...current,
          drawings: (current.drawings ?? []).map((candidate) =>
            candidate.id === operation.drawingId
              ? {
                  ...candidate,
                  paths: [
                    ...candidate.paths,
                    {
                      id: nextPathId,
                      color: normalizeDrawingColor(operation.color, '#ffffff'),
                      thickness: operation.thickness ?? 3,
                      points: localPoints,
                    },
                  ],
                }
              : candidate
          ),
        },
        details: {
          drawingId: operation.drawingId,
          pathId: nextPathId,
        },
      };
    }
    case 'drawing_move':
      return {
        graph: {
          ...current,
          drawings: (current.drawings ?? []).map((drawing) =>
            drawing.id === operation.drawingId
              ? {
                  ...drawing,
                  position: { x: operation.x, y: operation.y },
                }
              : drawing
          ),
        },
      };
    case 'drawing_set_name':
      return {
        graph: {
          ...current,
          drawings: (current.drawings ?? []).map((drawing) =>
            drawing.id === operation.drawingId
              ? {
                  ...drawing,
                  name: operation.name,
                }
              : drawing
          ),
        },
      };
    case 'drawing_delete':
      return {
        graph: {
          ...current,
          drawings: (current.drawings ?? []).filter((drawing) => drawing.id !== operation.drawingId),
        },
      };
    case 'node_add_inline': {
      const nodeId = operation.nodeId?.trim() || randomUUID();
      if (current.nodes.some((node) => node.id === nodeId)) {
        throw new Error(`Node ${nodeId} already exists in graph ${current.id}`);
      }

      const nowVersion = `${Date.now()}-${nodeId}`;
      const inlineCode = operation.code ?? 'outputs.output = inputs.input;';
      const inferredInputNames = inferInputPortNamesFromCode(inlineCode);
      const inferredOutputNames = inferOutputPortNamesFromCode(inlineCode);
      const resolvedInputNames = operation.inputNames && operation.inputNames.length > 0
        ? operation.inputNames
        : (inferredInputNames.length > 0 ? inferredInputNames : ['input']);
      const resolvedOutputNames = operation.outputNames && operation.outputNames.length > 0
        ? operation.outputNames
        : (inferredOutputNames.length > 0 ? inferredOutputNames : ['output']);

      const inputs = resolvedInputNames.map(
        (portName) => {
          assertValidPortName(portName, 'input');
          return {
            name: portName,
            schema: { type: 'object' as const },
          };
        }
      );

      const outputs = resolvedOutputNames.map(
        (portName) => {
          assertValidPortName(portName, 'output');
          return {
            name: portName,
            schema: { type: 'object' as const },
          };
        }
      );

      const node: GraphNode = {
        id: nodeId,
        type: 'inline_code',
        position: { x: operation.x, y: operation.y },
        metadata: {
          name: operation.name ?? 'Inline Code',
          inputs,
          outputs,
        },
        config: {
          type: 'inline_code',
          runtime: operation.runtime ?? 'javascript_vm',
          ...(operation.pythonEnv ? { pythonEnv: operation.pythonEnv } : {}),
          code: inlineCode,
          config: {
            autoRecompute: operation.autoRecompute ?? false,
          },
        },
        version: nowVersion,
      };

      return {
        graph: {
          ...current,
          nodes: [...current.nodes, node],
        },
        details: { nodeId },
      };
    }
    case 'node_add_numeric_input': {
      const node = createNumericInputNode({
        nodeId: operation.nodeId,
        name: operation.name,
        x: operation.x,
        y: operation.y,
        value: operation.value,
        min: operation.min,
        max: operation.max,
        step: operation.step,
        autoRecompute: operation.autoRecompute,
      });
      if (current.nodes.some((candidate) => candidate.id === node.id)) {
        throw new Error(`Node ${node.id} already exists in graph ${current.id}`);
      }

      return {
        graph: {
          ...current,
          nodes: [...current.nodes, node],
        },
        details: { nodeId: node.id },
      };
    }
    case 'node_move': {
      getNode(current, operation.nodeId);
      const projectionState = normalizeGraphProjectionState(
        current.nodes,
        current.projections,
        current.activeProjectionId,
        current.canvasBackground
      );
      const updatedNodes = current.nodes.map((node) =>
        node.id === operation.nodeId
          ? {
              ...node,
              position: { x: operation.x, y: operation.y },
            }
          : node
      );
      const updatedProjections = projectionState.projections.map((projection) =>
        projection.id === projectionState.activeProjectionId
          ? {
              ...projection,
              nodePositions: {
                ...projection.nodePositions,
                [operation.nodeId]: { x: operation.x, y: operation.y },
              },
            }
          : projection
      );

      return {
        graph: {
          ...current,
          nodes: updatedNodes,
          projections: updatedProjections,
          activeProjectionId: projectionState.activeProjectionId,
        },
      };
    }
    case 'node_set_name':
      return {
        graph: {
          ...current,
          nodes: current.nodes.map((node) =>
            node.id === operation.nodeId
              ? {
                  ...node,
                  metadata: {
                    ...node.metadata,
                    name: operation.name,
                  },
                  version: ensureNodeVersion(node),
                }
              : node
          ),
        },
      };
    case 'node_set_code':
      return {
        graph: {
          ...current,
          nodes: current.nodes.map((node) =>
            node.id === operation.nodeId
              ? updateInlineCodeNodeCode(
                  node,
                  operation.code,
                  current.connections,
                  operation.outputNames,
                  operation.runtime,
                  operation.pythonEnv
                )
              : node
          ),
        },
      };
    case 'node_set_auto_recompute':
      return {
        graph: {
          ...current,
          nodes: current.nodes.map((node) =>
            node.id === operation.nodeId
              ? {
                  ...node,
                  config: {
                    ...node.config,
                    config: {
                      ...(node.config.config ?? {}),
                      autoRecompute: operation.enabled,
                    },
                  },
                  version: ensureNodeVersion(node),
                }
              : node
          ),
        },
      };
    case 'node_add_input': {
      assertValidPortName(operation.inputName, 'input');
      const node = getNode(current, operation.nodeId);
      if (node.metadata.inputs.some((input) => input.name === operation.inputName)) {
        throw new Error(`Input port ${operation.inputName} already exists on node ${operation.nodeId}`);
      }

      return {
        graph: {
          ...current,
          nodes: current.nodes.map((candidate) =>
            candidate.id === operation.nodeId
              ? {
                  ...candidate,
                  metadata: {
                    ...candidate.metadata,
                    inputs: [
                      ...candidate.metadata.inputs,
                      {
                        name: operation.inputName,
                        schema: { type: 'object' },
                      },
                    ],
                  },
                  version: ensureNodeVersion(candidate),
                }
              : candidate
          ),
        },
      };
    }
    case 'node_delete_input': {
      const node = getNode(current, operation.nodeId);
      if (!node.metadata.inputs.some((input) => input.name === operation.inputName)) {
        throw new Error(`Input port ${operation.inputName} was not found on node ${operation.nodeId}`);
      }

      return {
        graph: {
          ...current,
          nodes: current.nodes.map((candidate) =>
            candidate.id === operation.nodeId
              ? {
                  ...candidate,
                  metadata: {
                    ...candidate.metadata,
                    inputs: candidate.metadata.inputs.filter((input) => input.name !== operation.inputName),
                  },
                  version: ensureNodeVersion(candidate),
                }
              : candidate
          ),
          connections: current.connections.filter(
            (connection) =>
              !(connection.targetNodeId === operation.nodeId && connection.targetPort === operation.inputName)
          ),
        },
      };
    }
    case 'node_move_input': {
      const node = getNode(current, operation.nodeId);
      const inputs = [...node.metadata.inputs];
      const index = inputs.findIndex((input) => input.name === operation.inputName);
      if (index === -1) {
        throw new Error(`Input port ${operation.inputName} was not found on node ${operation.nodeId}`);
      }

      const targetIndex = operation.direction === 'up' ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= inputs.length) {
        return { graph: current };
      }

      [inputs[index], inputs[targetIndex]] = [inputs[targetIndex], inputs[index]];

      return {
        graph: {
          ...current,
          nodes: current.nodes.map((candidate) =>
            candidate.id === operation.nodeId
              ? {
                  ...candidate,
                  metadata: {
                    ...candidate.metadata,
                    inputs,
                  },
                  version: ensureNodeVersion(candidate),
                }
              : candidate
          ),
        },
      };
    }
    case 'node_rename_input': {
      assertValidPortName(operation.newName, 'input');
      const node = getNode(current, operation.nodeId);
      if (!node.metadata.inputs.some((input) => input.name === operation.oldName)) {
        throw new Error(`Input port ${operation.oldName} was not found on node ${operation.nodeId}`);
      }
      if (node.metadata.inputs.some((input) => input.name === operation.newName)) {
        throw new Error(`Input port ${operation.newName} already exists on node ${operation.nodeId}`);
      }

      return {
        graph: {
          ...current,
          nodes: current.nodes.map((candidate) =>
            candidate.id === operation.nodeId
              ? {
                  ...candidate,
                  metadata: {
                    ...candidate.metadata,
                    inputs: candidate.metadata.inputs.map((input) =>
                      input.name === operation.oldName
                        ? {
                            ...input,
                            name: operation.newName,
                          }
                        : input
                    ),
                  },
                  version: ensureNodeVersion(candidate),
                }
              : candidate
          ),
          connections: current.connections.map((connection) =>
            connection.targetNodeId === operation.nodeId && connection.targetPort === operation.oldName
              ? {
                  ...connection,
                  targetPort: operation.newName,
                }
              : connection
          ),
        },
      };
    }
    case 'node_delete':
      return {
        graph: {
          ...current,
          nodes: current.nodes.filter((node) => node.id !== operation.nodeId),
          connections: current.connections.filter(
            (connection) =>
              connection.sourceNodeId !== operation.nodeId && connection.targetNodeId !== operation.nodeId
          ),
        },
      };
    case 'connection_add': {
      assertConnectionPortsExist(
        current,
        operation.sourceNodeId,
        operation.sourcePort,
        operation.targetNodeId,
        operation.targetPort
      );

      const duplicate = current.connections.some(
        (connection) =>
          connection.sourceNodeId === operation.sourceNodeId &&
          connection.sourcePort === operation.sourcePort &&
          connection.targetNodeId === operation.targetNodeId &&
          connection.targetPort === operation.targetPort
      );
      if (duplicate) {
        return { graph: current };
      }

      return {
        graph: {
          ...current,
          connections: [
            ...current.connections,
            {
              id: operation.connectionId ?? randomUUID(),
              sourceNodeId: operation.sourceNodeId,
              sourcePort: operation.sourcePort,
              targetNodeId: operation.targetNodeId,
              targetPort: operation.targetPort,
            },
          ],
        },
      };
    }
    case 'connection_set':
    case 'connection_replace': {
      const result = applyConnectionSet(current, {
        sourceNodeId: operation.sourceNodeId,
        sourcePort: operation.sourcePort,
        targetNodeId: operation.targetNodeId,
        targetPort: operation.targetPort,
        connectionId: operation.connectionId,
      });

      if (!result.changed) {
        return { graph: current };
      }

      return {
        graph: {
          ...current,
          connections: result.connections,
        },
        details: {
          connection: result.connection,
          replacedConnectionIds: result.replacedConnectionIds,
        },
      };
    }
    case 'connection_delete':
      return {
        graph: {
          ...current,
          connections: current.connections.filter(
            (connection) => connection.id !== operation.connectionId
          ),
        },
      };
  }
}

function resolveOutputPath(explicitPath?: string): string {
  if (explicitPath) {
    return path.isAbsolute(explicitPath)
      ? explicitPath
      : path.resolve(process.cwd(), explicitPath);
  }

  return path.resolve(
    process.cwd(),
    'tmp',
    'mcp-screenshots',
    `graph-region-${Date.now()}.png`
  );
}

export async function renderGraphRegionScreenshotFromFrontend(params: {
  frontendUrl: string;
  backendUrl: string;
  graphId: string;
  graphOverride?: Graph;
  region: RenderRegion;
  bitmap: RenderBitmap;
  outputPath?: string;
  includeBase64?: boolean;
}): Promise<{ outputPath: string; bytes: number; base64?: string }> {
  const graphData = params.graphOverride ? normalizeGraph(params.graphOverride) : null;
  const browser = await chromium.launch({
    headless: true,
    args: ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
  });

  try {
    const context = await browser.newContext({
      viewport: {
        width: Math.max(1, Math.round(params.bitmap.width)),
        height: Math.max(1, Math.round(params.bitmap.height)),
      },
      deviceScaleFactor: 1,
    });

    if (graphData) {
      await context.route(/\/api\/.*/, async (route) => {
        const request = route.request();
        const requestUrl = new URL(request.url());
        const method = request.method().toUpperCase();
        const proxyUrl = `${params.backendUrl}${requestUrl.pathname}${requestUrl.search}`;

        if (method === 'GET' && requestUrl.pathname === '/api/graphs/latest') {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(graphData),
          });
          return;
        }

        if (method === 'GET' && requestUrl.pathname === '/api/graphs') {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              graphs: [
                {
                  id: graphData.id,
                  name: graphData.name,
                  updatedAt: graphData.updatedAt,
                },
              ],
            }),
          });
          return;
        }

        if (method === 'GET' && requestUrl.pathname.startsWith('/api/graphs/')) {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(graphData),
          });
          return;
        }

        const requestHeaders = request.headers();
        const proxyHeaders = Object.fromEntries(
          Object.entries(requestHeaders).filter(([key]) => key.toLowerCase() !== 'host')
        );
        const requestBody = method === 'GET' || method === 'HEAD'
          ? undefined
          : request.postData() ?? undefined;
        const proxyResponse = await fetch(proxyUrl, {
          method,
          headers: proxyHeaders,
          body: requestBody,
        });
        const buffer = Buffer.from(await proxyResponse.arrayBuffer());
        const responseHeaders: Record<string, string> = {};
        proxyResponse.headers.forEach((value, key) => {
          responseHeaders[key] = value;
        });
        await route.fulfill({
          status: proxyResponse.status,
          headers: responseHeaders,
          body: buffer,
        });
      });
    }

    const page = await context.newPage();
    await page.addInitScript((targetGraphId: string) => {
      window.localStorage.setItem('k8v-current-graph-id', targetGraphId);
    }, params.graphId);
    const targetUrl = new URL(params.frontendUrl);
    targetUrl.searchParams.set('canvasOnly', '1');
    targetUrl.searchParams.set('mcpScreenshot', '1');
    await page.goto(targetUrl.toString(), { waitUntil: 'domcontentloaded' });

    await page.waitForFunction(() => {
      const bridge = (window as any).__k8vMcpScreenshotBridge;
      return Boolean(
        bridge &&
          typeof bridge.isCanvasReady === 'function' &&
          typeof bridge.isGraphReady === 'function' &&
          typeof bridge.setViewportRegion === 'function' &&
          bridge.isCanvasReady() &&
          bridge.isGraphReady()
      );
    });

    const applied = await page.evaluate((payload) => {
      const bridge = (window as any).__k8vMcpScreenshotBridge;
      if (!bridge || typeof bridge.setViewportRegion !== 'function') {
        return false;
      }
      return Boolean(bridge.setViewportRegion(payload.region, payload.bitmap));
    }, {
      region: params.region,
      bitmap: params.bitmap,
    });

    if (!applied) {
      throw new Error('Frontend canvas screenshot bridge could not apply requested region.');
    }

    await page.evaluate(async () => {
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => resolve());
        });
      });
    });

    const outputPath = resolveOutputPath(params.outputPath);
    await mkdir(path.dirname(outputPath), { recursive: true });

    const canvasRoot = page.locator('[data-testid="canvas-root"]');
    const imageBuffer = await canvasRoot.screenshot({
      path: outputPath,
      type: 'png',
    });

    await context.close();

    return {
      outputPath,
      bytes: imageBuffer.byteLength,
      ...(params.includeBase64
        ? {
            base64: imageBuffer.toString('base64'),
          }
        : {}),
    };
  } finally {
    await browser.close();
  }
}

const server: any = new McpServer({
  name: 'k8v-mcp-server',
  version: '0.1.0',
});

server.registerTool(
  'graph_list',
  {
    description: 'List available graphs.',
    inputSchema: {
      backendUrl: z.string().optional(),
    },
  },
  async ({ backendUrl }) => {
    const resolvedBackendUrl = resolveBackendUrl(backendUrl);
    const response = await requestJson<{ graphs: Array<{ id: string; name: string; updated_at: number }> }>(
      resolvedBackendUrl,
      '/api/graphs'
    );
    return textResult(response);
  }
);

server.registerTool(
  'graph_get',
  {
    description: 'Get a graph by id, or the latest graph when graphId is omitted.',
    inputSchema: {
      graphId: z.string().optional(),
      backendUrl: z.string().optional(),
    },
  },
  async ({ graphId, backendUrl }) => {
    const resolvedBackendUrl = resolveBackendUrl(backendUrl);
    const graph = graphId
      ? await getGraph(resolvedBackendUrl, graphId)
      : normalizeGraph(await requestJson<Graph>(resolvedBackendUrl, '/api/graphs/latest'));

    return textResult(graph);
  }
);

server.registerTool(
  'graph_query',
  {
    description:
      'Run lightweight graph queries (overview, BFS/DFS traversal, starting vertices) and return only requested fields.',
    inputSchema: {
      graphId: z.string(),
      operation: z.enum(GRAPH_QUERY_OPERATION_VALUES),
      startNodeIds: z.array(z.string()).optional(),
      depth: z.number().int().nonnegative().optional(),
      maxNodes: z.number().int().positive().optional(),
      nodeFields: z.array(GRAPH_QUERY_NODE_FIELD_SCHEMA).optional(),
      connectionFields: z.array(GRAPH_QUERY_CONNECTION_FIELD_SCHEMA).optional(),
      backendUrl: z.string().optional(),
    },
  },
  async ({
    graphId,
    operation,
    startNodeIds,
    depth,
    maxNodes,
    nodeFields,
    connectionFields,
    backendUrl,
  }) => {
    const resolvedBackendUrl = resolveBackendUrl(backendUrl);
    const parsedQuery: GraphQueryOperation = GRAPH_QUERY_OPERATION_SCHEMA.parse({
      operation,
      startNodeIds,
      depth,
      maxNodes,
      nodeFields,
      connectionFields,
    });

    const result = await requestJson<unknown>(
      resolvedBackendUrl,
      `/api/graphs/${encodeURIComponent(graphId)}/query`,
      {
        method: 'POST',
        body: JSON.stringify(parsedQuery),
      }
    );

    return textResult(result);
  }
);

server.registerTool(
  'graph_create',
  {
    description: 'Create a new empty graph.',
    inputSchema: {
      name: z.string().optional(),
      backendUrl: z.string().optional(),
    },
  },
  async ({ name, backendUrl }) => {
    const resolvedBackendUrl = resolveBackendUrl(backendUrl);
    const graph = normalizeGraph(await requestJson<Graph>(resolvedBackendUrl, '/api/graphs', {
      method: 'POST',
      body: JSON.stringify({ name: name ?? 'Untitled Graph' }),
    }));

    return textResult(graph);
  }
);

server.registerTool(
  'graph_set_name',
  {
    description: 'Update the graph display name.',
    inputSchema: {
      graphId: z.string(),
      name: z.string(),
      backendUrl: z.string().optional(),
    },
  },
  async ({ graphId, name, backendUrl }) => {
    const resolvedBackendUrl = resolveBackendUrl(backendUrl);
    const graph = await updateGraph(resolvedBackendUrl, graphId, (current) => ({
      ...current,
      name,
    }));

    return textResult(graph);
  }
);

server.registerTool(
  'bulk_edit',
  {
    description:
      'Apply multiple graph-edit operations sequentially in a single persisted graph update.',
    inputSchema: {
      graphId: z.string(),
      operations: z.array(BULK_EDIT_OPERATION_SCHEMA).min(1),
      backendUrl: z.string().optional(),
    },
  },
  async ({ graphId, operations, backendUrl }) => {
    const resolvedBackendUrl = resolveBackendUrl(backendUrl);
    const operationResults: Array<{
      index: number;
      op: BulkEditOperation['op'];
      details?: Record<string, unknown>;
    }> = [];

    const graph = await updateGraph(resolvedBackendUrl, graphId, (current) => {
      let nextGraph = current;
      for (let index = 0; index < operations.length; index += 1) {
        const operation = operations[index];
        try {
          const result = applyBulkEditOperation(nextGraph, operation);
          nextGraph = normalizeGraph(result.graph);
          operationResults.push({
            index,
            op: operation.op,
            ...(result.details ? { details: result.details } : {}),
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          throw new Error(`bulk_edit operation ${index + 1} (${operation.op}) failed: ${message}`);
        }
      }
      return nextGraph;
    });

    return textResult({
      graphId,
      operationsApplied: operationResults.length,
      operationResults,
      graph,
    });
  }
);

server.registerTool(
  'graph_projection_add',
  {
    description:
      'Add a new graph projection. Node coordinates, node card sizes, and projection background are cloned from the currently selected projection unless sourceProjectionId is provided.',
    inputSchema: {
      graphId: z.string(),
      projectionId: z.string().trim().min(1).optional(),
      name: z.string().trim().min(1).optional(),
      sourceProjectionId: z.string().trim().min(1).optional(),
      activate: z.boolean().optional(),
      backendUrl: z.string().optional(),
    },
  },
  async ({ graphId, projectionId, name, sourceProjectionId, activate, backendUrl }) => {
    const resolvedBackendUrl = resolveBackendUrl(backendUrl);
    const graph = await updateGraph(resolvedBackendUrl, graphId, (current) => {
      const projectionState = normalizeGraphProjectionState(
        current.nodes,
        current.projections,
        current.activeProjectionId,
        current.canvasBackground
      );

      const sourceId = sourceProjectionId?.trim() || projectionState.activeProjectionId;
      const sourceProjection = projectionState.projections.find((projection) => projection.id === sourceId);
      if (!sourceProjection) {
        throw new Error(`Projection "${sourceId}" was not found in graph ${graphId}`);
      }

      const nextProjectionId = projectionId?.trim() || randomUUID();
      if (projectionState.projections.some((projection) => projection.id === nextProjectionId)) {
        throw new Error(`Projection "${nextProjectionId}" already exists in graph ${graphId}`);
      }

      const newProjection: GraphProjection = {
        id: nextProjectionId,
        name: name?.trim() || getNextProjectionName(projectionState.projections),
        nodePositions: cloneProjectionNodePositions(current.nodes, sourceProjection),
        nodeCardSizes: cloneProjectionNodeCardSizes(current.nodes, sourceProjection),
        canvasBackground: normalizeCanvasBackground(
          sourceProjection.canvasBackground ?? current.canvasBackground
        ),
      };

      const nextActiveProjectionId = activate === false
        ? projectionState.activeProjectionId
        : newProjection.id;
      const activeProjection = nextActiveProjectionId === newProjection.id
        ? newProjection
        : projectionState.projections.find(
            (projection) => projection.id === nextActiveProjectionId
          ) ?? newProjection;

      return {
        ...current,
        projections: [...projectionState.projections, newProjection],
        activeProjectionId: nextActiveProjectionId,
        nodes: applyProjectionToNodes(current.nodes, activeProjection),
        canvasBackground: normalizeCanvasBackground(
          activeProjection.canvasBackground ?? current.canvasBackground
        ),
      };
    });

    return textResult(graph);
  }
);

server.registerTool(
  'graph_projection_select',
  {
    description: 'Set the active graph projection and apply its stored node coordinates, card sizes, and background to the graph.',
    inputSchema: {
      graphId: z.string(),
      projectionId: z.string().trim().min(1),
      backendUrl: z.string().optional(),
    },
  },
  async ({ graphId, projectionId, backendUrl }) => {
    const resolvedBackendUrl = resolveBackendUrl(backendUrl);
    const graph = await updateGraph(resolvedBackendUrl, graphId, (current) => {
      const projectionState = normalizeGraphProjectionState(
        current.nodes,
        current.projections,
        current.activeProjectionId,
        current.canvasBackground
      );
      const selectedProjection = projectionState.projections.find(
        (projection) => projection.id === projectionId
      );
      if (!selectedProjection) {
        throw new Error(`Projection "${projectionId}" was not found in graph ${graphId}`);
      }

      return {
        ...current,
        projections: projectionState.projections,
        activeProjectionId: selectedProjection.id,
        nodes: applyProjectionToNodes(current.nodes, selectedProjection),
        canvasBackground: normalizeCanvasBackground(
          selectedProjection.canvasBackground ?? current.canvasBackground
        ),
      };
    });

    return textResult(graph);
  }
);

server.registerTool(
  'graph_python_env_add',
  {
    description: 'Add a named Python environment definition to a graph.',
    inputSchema: {
      graphId: z.string(),
      name: z.string().trim().min(1),
      pythonPath: z.string().trim().min(1),
      cwd: z.string().trim().min(1),
      backendUrl: z.string().optional(),
    },
  },
  async ({ graphId, name, pythonPath, cwd, backendUrl }) => {
    const resolvedBackendUrl = resolveBackendUrl(backendUrl);
    const graph = await updateGraph(resolvedBackendUrl, graphId, (current) => {
      const existingEnvs = current.pythonEnvs ?? [];
      if (existingEnvs.some((env) => env.name === name)) {
        throw new Error(`Python environment "${name}" already exists in graph ${graphId}`);
      }

      return {
        ...current,
        pythonEnvs: [
          ...existingEnvs,
          {
            name,
            pythonPath,
            cwd,
          },
        ],
      };
    });

    return textResult(graph);
  }
);

server.registerTool(
  'graph_python_env_edit',
  {
    description:
      'Edit an existing graph Python environment by name (rename and/or update pythonPath/cwd).',
    inputSchema: {
      graphId: z.string(),
      envName: z.string().trim().min(1),
      name: z.string().trim().min(1).optional(),
      pythonPath: z.string().trim().min(1).optional(),
      cwd: z.string().trim().min(1).optional(),
      backendUrl: z.string().optional(),
    },
  },
  async ({ graphId, envName, name, pythonPath, cwd, backendUrl }) => {
    const resolvedBackendUrl = resolveBackendUrl(backendUrl);
    const graph = await updateGraph(resolvedBackendUrl, graphId, (current) => {
      const existingEnvs = current.pythonEnvs ?? [];
      const envIndex = existingEnvs.findIndex((env) => env.name === envName);
      if (envIndex === -1) {
        throw new Error(`Python environment "${envName}" was not found in graph ${graphId}`);
      }

      const existingEnv = existingEnvs[envIndex];
      const nextEnvName = name ?? existingEnv.name;
      const nextEnv: PythonEnvironment = {
        name: nextEnvName,
        pythonPath: pythonPath ?? existingEnv.pythonPath,
        cwd: cwd ?? existingEnv.cwd,
      };

      const duplicateName = existingEnvs.some(
        (env, index) => index !== envIndex && env.name === nextEnv.name
      );
      if (duplicateName) {
        throw new Error(`Python environment "${nextEnv.name}" already exists in graph ${graphId}`);
      }

      const nextNodes =
        nextEnvName === envName
          ? current.nodes
          : current.nodes.map((node) =>
              node.config.pythonEnv === envName
                ? {
                    ...node,
                    config: {
                      ...node.config,
                      pythonEnv: nextEnvName,
                    },
                    version: ensureNodeVersion(node),
                  }
                : node
            );

      return {
        ...current,
        pythonEnvs: existingEnvs.map((env, index) => (index === envIndex ? nextEnv : env)),
        nodes: nextNodes,
      };
    });

    return textResult(graph);
  }
);

server.registerTool(
  'graph_python_env_delete',
  {
    description:
      'Delete a graph Python environment by name and clear pythonEnv bindings from nodes that referenced it.',
    inputSchema: {
      graphId: z.string(),
      envName: z.string().trim().min(1),
      backendUrl: z.string().optional(),
    },
  },
  async ({ graphId, envName, backendUrl }) => {
    const resolvedBackendUrl = resolveBackendUrl(backendUrl);
    const graph = await updateGraph(resolvedBackendUrl, graphId, (current) => {
      const existingEnvs = current.pythonEnvs ?? [];
      const hasEnv = existingEnvs.some((env) => env.name === envName);
      if (!hasEnv) {
        throw new Error(`Python environment "${envName}" was not found in graph ${graphId}`);
      }

      return {
        ...current,
        pythonEnvs: existingEnvs.filter((env) => env.name !== envName),
        nodes: current.nodes.map((node) =>
          node.config.pythonEnv === envName
            ? {
                ...node,
                config: {
                  ...node.config,
                  pythonEnv: undefined,
                },
                version: ensureNodeVersion(node),
              }
            : node
        ),
      };
    });

    return textResult(graph);
  }
);

server.registerTool(
  'drawing_create',
  {
    description: 'Create a persistent drawing object with a draggable handle/title.',
    inputSchema: {
      graphId: z.string(),
      name: z.string().optional(),
      x: z.number().optional(),
      y: z.number().optional(),
      backendUrl: z.string().optional(),
    },
  },
  async ({ graphId, name, x, y, backendUrl }) => {
    const resolvedBackendUrl = resolveBackendUrl(backendUrl);
    const drawingId = randomUUID();

    const graph = await updateGraph(resolvedBackendUrl, graphId, (current) => ({
      ...current,
      drawings: [
        ...(current.drawings ?? []),
        {
          id: drawingId,
          name: name ?? `Drawing ${((current.drawings ?? []).length + 1)}`,
          position: {
            x: x ?? 0,
            y: y ?? 0,
          },
          paths: [],
        },
      ],
    }));

    return textResult({ graphId, drawingId, graph });
  }
);

server.registerTool(
  'drawing_add_path',
  {
    description: 'Append a path to an existing drawing object.',
    inputSchema: {
      graphId: z.string(),
      drawingId: z.string(),
      points: z.array(z.object({ x: z.number(), y: z.number() })).min(1),
      color: z.union([z.string().regex(/^#[0-9a-fA-F]{6}$/), z.enum(['white', 'green', 'red'])]).optional(),
      thickness: z.number().positive().optional(),
      pathId: z.string().optional(),
      coordinateSpace: z.enum(['world', 'local']).optional(),
      backendUrl: z.string().optional(),
    },
  },
  async ({
    graphId,
    drawingId,
    points,
    color,
    thickness,
    pathId,
    coordinateSpace,
    backendUrl,
  }) => {
    const resolvedBackendUrl = resolveBackendUrl(backendUrl);

    const graph = await updateGraph(resolvedBackendUrl, graphId, (current) => {
      const drawing = (current.drawings ?? []).find((candidate) => candidate.id === drawingId);
      if (!drawing) {
        throw new Error(`Drawing ${drawingId} not found in graph ${graphId}`);
      }

      const localPoints = (coordinateSpace ?? 'world') === 'local'
        ? points
        : points.map((point) => ({
            x: point.x - drawing.position.x,
            y: point.y - drawing.position.y,
          }));

      return {
        ...current,
        drawings: (current.drawings ?? []).map((candidate) =>
          candidate.id === drawingId
            ? {
                ...candidate,
                paths: [
                  ...candidate.paths,
                  {
                    id: pathId ?? randomUUID(),
                    color: normalizeDrawingColor(color, '#ffffff'),
                    thickness: thickness ?? 3,
                    points: localPoints,
                  },
                ],
              }
            : candidate
        ),
      };
    });

    return textResult(graph);
  }
);

server.registerTool(
  'drawing_move',
  {
    description: 'Move a drawing handle (and all of its paths) to a new world position.',
    inputSchema: {
      graphId: z.string(),
      drawingId: z.string(),
      x: z.number(),
      y: z.number(),
      backendUrl: z.string().optional(),
    },
  },
  async ({ graphId, drawingId, x, y, backendUrl }) => {
    const resolvedBackendUrl = resolveBackendUrl(backendUrl);

    const graph = await updateGraph(resolvedBackendUrl, graphId, (current) => ({
      ...current,
      drawings: (current.drawings ?? []).map((drawing) =>
        drawing.id === drawingId
          ? {
              ...drawing,
              position: { x, y },
            }
          : drawing
      ),
    }));

    return textResult(graph);
  }
);

server.registerTool(
  'drawing_set_name',
  {
    description: 'Rename a drawing object.',
    inputSchema: {
      graphId: z.string(),
      drawingId: z.string(),
      name: z.string(),
      backendUrl: z.string().optional(),
    },
  },
  async ({ graphId, drawingId, name, backendUrl }) => {
    const resolvedBackendUrl = resolveBackendUrl(backendUrl);

    const graph = await updateGraph(resolvedBackendUrl, graphId, (current) => ({
      ...current,
      drawings: (current.drawings ?? []).map((drawing) =>
        drawing.id === drawingId
          ? {
              ...drawing,
              name,
            }
          : drawing
      ),
    }));

    return textResult(graph);
  }
);

server.registerTool(
  'drawing_delete',
  {
    description: 'Delete a drawing object and all stored paths.',
    inputSchema: {
      graphId: z.string(),
      drawingId: z.string(),
      backendUrl: z.string().optional(),
    },
  },
  async ({ graphId, drawingId, backendUrl }) => {
    const resolvedBackendUrl = resolveBackendUrl(backendUrl);
    const graph = await updateGraph(resolvedBackendUrl, graphId, (current) => ({
      ...current,
      drawings: (current.drawings ?? []).filter((drawing) => drawing.id !== drawingId),
    }));

    return textResult(graph);
  }
);

server.registerTool(
  'node_add_inline',
  {
    description: 'Add an inline code node to a graph.',
    inputSchema: {
      graphId: z.string(),
      name: z.string().optional(),
      x: z.number(),
      y: z.number(),
      inputNames: z.array(z.string()).optional(),
      outputNames: z.array(z.string()).optional(),
      code: z.string().optional(),
      runtime: z.string().optional(),
      pythonEnv: z.string().optional(),
      autoRecompute: z.boolean().optional(),
      backendUrl: z.string().optional(),
    },
  },
  async ({
    graphId,
    name,
    x,
    y,
    inputNames,
    outputNames,
    code,
    runtime,
    pythonEnv,
    autoRecompute,
    backendUrl,
  }) => {
    const resolvedBackendUrl = resolveBackendUrl(backendUrl);
    const nodeId = randomUUID();
    const nowVersion = `${Date.now()}-${nodeId}`;
    const inlineCode = code ?? 'outputs.output = inputs.input;';
    const inferredInputNames = inferInputPortNamesFromCode(inlineCode);
    const inferredOutputNames = inferOutputPortNamesFromCode(inlineCode);
    const resolvedInputNames = inputNames && inputNames.length > 0
      ? inputNames
      : (inferredInputNames.length > 0 ? inferredInputNames : ['input']);
    const resolvedOutputNames = outputNames && outputNames.length > 0
      ? outputNames
      : (inferredOutputNames.length > 0 ? inferredOutputNames : ['output']);

    const inputs = resolvedInputNames.map(
      (portName) => {
        assertValidPortName(portName, 'input');
        return {
          name: portName,
          schema: { type: 'object' as const },
        };
      }
    );

    const outputs = resolvedOutputNames.map(
      (portName) => {
        assertValidPortName(portName, 'output');
        return {
          name: portName,
          schema: { type: 'object' as const },
        };
      }
    );

    const node: GraphNode = {
      id: nodeId,
      type: 'inline_code',
      position: { x, y },
      metadata: {
        name: name ?? 'Inline Code',
        inputs,
        outputs,
      },
      config: {
        type: 'inline_code',
        runtime: runtime ?? 'javascript_vm',
        ...(pythonEnv ? { pythonEnv } : {}),
        code: inlineCode,
        config: {
          autoRecompute: autoRecompute ?? false,
        },
      },
      version: nowVersion,
    };

    const graph = await updateGraph(resolvedBackendUrl, graphId, (current) => ({
      ...current,
      nodes: [...current.nodes, node],
    }));

    return textResult({ graphId, nodeId, graph });
  }
);

server.registerTool(
  'node_add_numeric_input',
  {
    description: 'Add a numeric input slider node to a graph.',
    inputSchema: {
      graphId: z.string(),
      name: z.string().optional(),
      x: z.number(),
      y: z.number(),
      value: z.number().optional(),
      min: z.number().optional(),
      max: z.number().optional(),
      step: z.number().optional(),
      autoRecompute: z.boolean().optional(),
      backendUrl: z.string().optional(),
    },
  },
  async ({ graphId, name, x, y, value, min, max, step, autoRecompute, backendUrl }) => {
    const resolvedBackendUrl = resolveBackendUrl(backendUrl);
    const node = createNumericInputNode({
      name,
      x,
      y,
      value,
      min,
      max,
      step,
      autoRecompute,
    });

    const graph = await updateGraph(resolvedBackendUrl, graphId, (current) => ({
      ...current,
      nodes: [...current.nodes, node],
    }));

    return textResult({ graphId, nodeId: node.id, graph });
  }
);

server.registerTool(
  'node_move',
  {
    description: 'Move a node to a new canvas position.',
    inputSchema: {
      graphId: z.string(),
      nodeId: z.string(),
      x: z.number(),
      y: z.number(),
      backendUrl: z.string().optional(),
    },
  },
  async ({ graphId, nodeId, x, y, backendUrl }) => {
    const resolvedBackendUrl = resolveBackendUrl(backendUrl);
    const graph = await updateGraph(resolvedBackendUrl, graphId, (current) => {
      getNode(current, nodeId);
      const projectionState = normalizeGraphProjectionState(
        current.nodes,
        current.projections,
        current.activeProjectionId,
        current.canvasBackground
      );
      const updatedNodes = current.nodes.map((node) =>
        node.id === nodeId
          ? {
              ...node,
              position: { x, y },
            }
          : node
      );
      const updatedProjections = projectionState.projections.map((projection) =>
        projection.id === projectionState.activeProjectionId
          ? {
              ...projection,
              nodePositions: {
                ...projection.nodePositions,
                [nodeId]: { x, y },
              },
            }
          : projection
      );

      return {
        ...current,
        nodes: updatedNodes,
        projections: updatedProjections,
        activeProjectionId: projectionState.activeProjectionId,
      };
    });

    return textResult(graph);
  }
);

server.registerTool(
  'node_set_name',
  {
    description: 'Rename a node/card.',
    inputSchema: {
      graphId: z.string(),
      nodeId: z.string(),
      name: z.string(),
      backendUrl: z.string().optional(),
    },
  },
  async ({ graphId, nodeId, name, backendUrl }) => {
    const resolvedBackendUrl = resolveBackendUrl(backendUrl);
    const graph = await updateGraph(resolvedBackendUrl, graphId, (current) => ({
      ...current,
      nodes: current.nodes.map((node) =>
        node.id === nodeId
          ? {
              ...node,
              metadata: {
                ...node.metadata,
                name,
              },
              version: ensureNodeVersion(node),
            }
          : node
      ),
    }));

    return textResult(graph);
  }
);

server.registerTool(
  'node_set_code',
  {
    description: 'Update inline code for a node.',
    inputSchema: {
      graphId: z.string(),
      nodeId: z.string(),
      code: z.string(),
      outputNames: z.array(z.string()).optional(),
      runtime: z.string().optional(),
      pythonEnv: z.string().optional(),
      backendUrl: z.string().optional(),
    },
  },
  async ({ graphId, nodeId, code, outputNames, runtime, pythonEnv, backendUrl }) => {
    const resolvedBackendUrl = resolveBackendUrl(backendUrl);
    const graph = await updateGraph(resolvedBackendUrl, graphId, (current) => ({
      ...current,
      nodes: current.nodes.map((node) =>
        node.id === nodeId
          ? updateInlineCodeNodeCode(node, code, current.connections, outputNames, runtime, pythonEnv)
          : node
      ),
    }));

    return textResult(graph);
  }
);

server.registerTool(
  'node_set_auto_recompute',
  {
    description: 'Enable/disable auto recompute for a node.',
    inputSchema: {
      graphId: z.string(),
      nodeId: z.string(),
      enabled: z.boolean(),
      backendUrl: z.string().optional(),
    },
  },
  async ({ graphId, nodeId, enabled, backendUrl }) => {
    const resolvedBackendUrl = resolveBackendUrl(backendUrl);
    const graph = await updateGraph(resolvedBackendUrl, graphId, (current) => ({
      ...current,
      nodes: current.nodes.map((node) =>
        node.id === nodeId
          ? {
              ...node,
              config: {
                ...node.config,
                config: {
                  ...(node.config.config ?? {}),
                  autoRecompute: enabled,
                },
              },
              version: ensureNodeVersion(node),
            }
          : node
      ),
    }));

    return textResult(graph);
  }
);

server.registerTool(
  'node_add_input',
  {
    description: 'Add an input port to a node.',
    inputSchema: {
      graphId: z.string(),
      nodeId: z.string(),
      inputName: z.string(),
      backendUrl: z.string().optional(),
    },
  },
  async ({ graphId, nodeId, inputName, backendUrl }) => {
    assertValidPortName(inputName, 'input');
    const resolvedBackendUrl = resolveBackendUrl(backendUrl);

    const graph = await updateGraph(resolvedBackendUrl, graphId, (current) => {
      const node = getNode(current, nodeId);
      if (node.metadata.inputs.some((input) => input.name === inputName)) {
        throw new Error(`Input port ${inputName} already exists on node ${nodeId}`);
      }

      return {
        ...current,
        nodes: current.nodes.map((candidate) =>
          candidate.id === nodeId
            ? {
                ...candidate,
                metadata: {
                  ...candidate.metadata,
                  inputs: [
                    ...candidate.metadata.inputs,
                    {
                      name: inputName,
                      schema: { type: 'object' },
                    },
                  ],
                },
                version: ensureNodeVersion(candidate),
              }
            : candidate
        ),
      };
    });

    return textResult(graph);
  }
);

server.registerTool(
  'node_delete_input',
  {
    description: 'Delete an input port and remove connections targeting it.',
    inputSchema: {
      graphId: z.string(),
      nodeId: z.string(),
      inputName: z.string(),
      backendUrl: z.string().optional(),
    },
  },
  async ({ graphId, nodeId, inputName, backendUrl }) => {
    const resolvedBackendUrl = resolveBackendUrl(backendUrl);

    const graph = await updateGraph(resolvedBackendUrl, graphId, (current) => {
      const node = getNode(current, nodeId);
      if (!node.metadata.inputs.some((input) => input.name === inputName)) {
        throw new Error(`Input port ${inputName} was not found on node ${nodeId}`);
      }

      return {
        ...current,
        nodes: current.nodes.map((candidate) =>
          candidate.id === nodeId
            ? {
                ...candidate,
                metadata: {
                  ...candidate.metadata,
                  inputs: candidate.metadata.inputs.filter((input) => input.name !== inputName),
                },
                version: ensureNodeVersion(candidate),
              }
            : candidate
        ),
        connections: current.connections.filter(
          (connection) =>
            !(connection.targetNodeId === nodeId && connection.targetPort === inputName)
        ),
      };
    });

    return textResult(graph);
  }
);

server.registerTool(
  'node_move_input',
  {
    description: 'Reorder an input port by moving it up/down in the inputs list.',
    inputSchema: {
      graphId: z.string(),
      nodeId: z.string(),
      inputName: z.string(),
      direction: z.enum(['up', 'down']),
      backendUrl: z.string().optional(),
    },
  },
  async ({ graphId, nodeId, inputName, direction, backendUrl }) => {
    const resolvedBackendUrl = resolveBackendUrl(backendUrl);

    const graph = await updateGraph(resolvedBackendUrl, graphId, (current) => {
      const node = getNode(current, nodeId);
      const inputs = [...node.metadata.inputs];
      const index = inputs.findIndex((input) => input.name === inputName);
      if (index === -1) {
        throw new Error(`Input port ${inputName} was not found on node ${nodeId}`);
      }

      const targetIndex = direction === 'up' ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= inputs.length) {
        return current;
      }

      [inputs[index], inputs[targetIndex]] = [inputs[targetIndex], inputs[index]];

      return {
        ...current,
        nodes: current.nodes.map((candidate) =>
          candidate.id === nodeId
            ? {
                ...candidate,
                metadata: {
                  ...candidate.metadata,
                  inputs,
                },
                version: ensureNodeVersion(candidate),
              }
            : candidate
        ),
      };
    });

    return textResult(graph);
  }
);

server.registerTool(
  'node_rename_input',
  {
    description: 'Rename an input port and retarget existing inbound connections.',
    inputSchema: {
      graphId: z.string(),
      nodeId: z.string(),
      oldName: z.string(),
      newName: z.string(),
      backendUrl: z.string().optional(),
    },
  },
  async ({ graphId, nodeId, oldName, newName, backendUrl }) => {
    assertValidPortName(newName, 'input');
    const resolvedBackendUrl = resolveBackendUrl(backendUrl);

    const graph = await updateGraph(resolvedBackendUrl, graphId, (current) => {
      const node = getNode(current, nodeId);
      if (!node.metadata.inputs.some((input) => input.name === oldName)) {
        throw new Error(`Input port ${oldName} was not found on node ${nodeId}`);
      }
      if (node.metadata.inputs.some((input) => input.name === newName)) {
        throw new Error(`Input port ${newName} already exists on node ${nodeId}`);
      }

      return {
        ...current,
        nodes: current.nodes.map((candidate) =>
          candidate.id === nodeId
            ? {
                ...candidate,
                metadata: {
                  ...candidate.metadata,
                  inputs: candidate.metadata.inputs.map((input) =>
                    input.name === oldName
                      ? {
                          ...input,
                          name: newName,
                        }
                      : input
                  ),
                },
                version: ensureNodeVersion(candidate),
              }
            : candidate
        ),
        connections: current.connections.map((connection) =>
          connection.targetNodeId === nodeId && connection.targetPort === oldName
            ? {
                ...connection,
                targetPort: newName,
              }
            : connection
        ),
      };
    });

    return textResult(graph);
  }
);

server.registerTool(
  'node_delete',
  {
    description: 'Delete a node and all connected edges.',
    inputSchema: {
      graphId: z.string(),
      nodeId: z.string(),
      backendUrl: z.string().optional(),
    },
  },
  async ({ graphId, nodeId, backendUrl }) => {
    const resolvedBackendUrl = resolveBackendUrl(backendUrl);
    const graph = await updateGraph(resolvedBackendUrl, graphId, (current) => ({
      ...current,
      nodes: current.nodes.filter((node) => node.id !== nodeId),
      connections: current.connections.filter(
        (connection) =>
          connection.sourceNodeId !== nodeId && connection.targetNodeId !== nodeId
      ),
    }));

    return textResult(graph);
  }
);

server.registerTool(
  'connections_list',
  {
    description: 'List graph connections with optional node/target-port filtering.',
    inputSchema: {
      graphId: z.string(),
      nodeId: z.string().optional(),
      targetPort: z.string().optional(),
      backendUrl: z.string().optional(),
    },
  },
  async ({ graphId, nodeId, targetPort, backendUrl }) => {
    const resolvedBackendUrl = resolveBackendUrl(backendUrl);
    const graph = await getGraph(resolvedBackendUrl, graphId);
    const connections = filterConnections(graph.connections, { nodeId, targetPort });

    return textResult({
      graphId: graph.id,
      filters: {
        ...(nodeId?.trim() ? { nodeId: nodeId.trim() } : {}),
        ...(targetPort?.trim() ? { targetPort: targetPort.trim() } : {}),
      },
      count: connections.length,
      connections,
    });
  }
);

server.registerTool(
  'connection_add',
  {
    description: 'Create a connection between two ports.',
    inputSchema: {
      graphId: z.string(),
      sourceNodeId: z.string(),
      sourcePort: z.string(),
      targetNodeId: z.string(),
      targetPort: z.string(),
      connectionId: z.string().optional(),
      noRecompute: z.boolean().optional(),
      backendUrl: z.string().optional(),
    },
  },
  async ({
    graphId,
    sourceNodeId,
    sourcePort,
    targetNodeId,
    targetPort,
    connectionId,
    noRecompute,
    backendUrl,
  }) => {
    const resolvedBackendUrl = resolveBackendUrl(backendUrl);

    const graph = await updateGraphConnections(
      resolvedBackendUrl,
      graphId,
      (current) => {
        assertConnectionPortsExist(current, sourceNodeId, sourcePort, targetNodeId, targetPort);

        const duplicate = current.connections.some(
          (connection) =>
            connection.sourceNodeId === sourceNodeId &&
            connection.sourcePort === sourcePort &&
            connection.targetNodeId === targetNodeId &&
            connection.targetPort === targetPort
        );
        if (duplicate) {
          return current.connections;
        }

        return [
          ...current.connections,
          {
            id: connectionId ?? randomUUID(),
            sourceNodeId,
            sourcePort,
            targetNodeId,
            targetPort,
          },
        ];
      },
      {
        noRecompute,
      }
    );

    return textResult(graph);
  }
);

server.registerTool(
  'connection_set',
  {
    description:
      'Atomically set the source for a target input port, replacing any existing inbound connection(s).',
    inputSchema: {
      graphId: z.string(),
      sourceNodeId: z.string(),
      sourcePort: z.string(),
      targetNodeId: z.string(),
      targetPort: z.string(),
      connectionId: z.string().optional(),
      noRecompute: z.boolean().optional(),
      backendUrl: z.string().optional(),
    },
  },
  async ({
    graphId,
    sourceNodeId,
    sourcePort,
    targetNodeId,
    targetPort,
    connectionId,
    noRecompute,
    backendUrl,
  }) => {
    const resolvedBackendUrl = resolveBackendUrl(backendUrl);
    const { graph, result: operationResult } = await updateGraphConnectionsWithResult(
      resolvedBackendUrl,
      graphId,
      (current) => {
        const result = applyConnectionSet(current, {
          sourceNodeId,
          sourcePort,
          targetNodeId,
          targetPort,
          connectionId,
        });
        return {
          connections: result.connections,
          result,
        };
      },
      {
        noRecompute,
      }
    );

    return textResult({
      graphId,
      connection: operationResult.connection,
      replacedConnectionIds: operationResult.replacedConnectionIds,
      changed: operationResult.changed,
      graph,
    });
  }
);

server.registerTool(
  'connection_replace',
  {
    description:
      'Alias of connection_set: atomically set the source for a target input port and replace existing inbound edge(s).',
    inputSchema: {
      graphId: z.string(),
      sourceNodeId: z.string(),
      sourcePort: z.string(),
      targetNodeId: z.string(),
      targetPort: z.string(),
      connectionId: z.string().optional(),
      noRecompute: z.boolean().optional(),
      backendUrl: z.string().optional(),
    },
  },
  async ({
    graphId,
    sourceNodeId,
    sourcePort,
    targetNodeId,
    targetPort,
    connectionId,
    noRecompute,
    backendUrl,
  }) => {
    const resolvedBackendUrl = resolveBackendUrl(backendUrl);
    const { graph, result: operationResult } = await updateGraphConnectionsWithResult(
      resolvedBackendUrl,
      graphId,
      (current) => {
        const result = applyConnectionSet(current, {
          sourceNodeId,
          sourcePort,
          targetNodeId,
          targetPort,
          connectionId,
        });
        return {
          connections: result.connections,
          result,
        };
      },
      {
        noRecompute,
      }
    );

    return textResult({
      graphId,
      connection: operationResult.connection,
      replacedConnectionIds: operationResult.replacedConnectionIds,
      changed: operationResult.changed,
      graph,
    });
  }
);

server.registerTool(
  'connection_delete',
  {
    description: 'Delete a connection by id.',
    inputSchema: {
      graphId: z.string(),
      connectionId: z.string(),
      noRecompute: z.boolean().optional(),
      backendUrl: z.string().optional(),
    },
  },
  async ({ graphId, connectionId, noRecompute, backendUrl }) => {
    const resolvedBackendUrl = resolveBackendUrl(backendUrl);
    const graph = await updateGraphConnections(
      resolvedBackendUrl,
      graphId,
      (current) => current.connections.filter((connection) => connection.id !== connectionId),
      {
        noRecompute,
      }
    );

    return textResult(graph);
  }
);

server.registerTool(
  'graph_compute',
  {
    description: 'Compute full graph or a selected node.',
    inputSchema: {
      graphId: z.string(),
      nodeId: z.string().optional(),
      backendUrl: z.string().optional(),
    },
  },
  async ({ graphId, nodeId, backendUrl }) => {
    const resolvedBackendUrl = resolveBackendUrl(backendUrl);
    const result = await requestJson<unknown>(
      resolvedBackendUrl,
      `/api/graphs/${encodeURIComponent(graphId)}/compute`,
      {
        method: 'POST',
        body: JSON.stringify(nodeId ? { nodeId } : {}),
      }
    );

    return textResult(result);
  }
);

server.registerTool(
  'graphics_get',
  {
    description:
      'Fetch a graphics artifact by id as binary image data, with optional backend mip-level selection by maxPixels.',
    inputSchema: {
      graphicsId: z.string(),
      maxPixels: z.number().int().positive().optional(),
      includeImage: z.boolean().optional(),
      backendUrl: z.string().optional(),
    },
  },
  async ({ graphicsId, maxPixels, includeImage, backendUrl }) => {
    const resolvedBackendUrl = resolveBackendUrl(backendUrl);
    const params = new URLSearchParams();
    if (typeof maxPixels === 'number' && Number.isFinite(maxPixels) && maxPixels > 0) {
      params.set('maxPixels', String(Math.floor(maxPixels)));
    }
    const query = params.toString();

    const { buffer, headers } = await requestBinary(
      resolvedBackendUrl,
      `/api/graphics/${encodeURIComponent(graphicsId)}/image${query ? `?${query}` : ''}`
    );

    const mimeType = headers.get('content-type') || 'application/octet-stream';
    const selectedLevel = {
      level: Number(headers.get('x-k8v-graphics-level') ?? '0'),
      width: Number(headers.get('x-k8v-graphics-width') ?? '0'),
      height: Number(headers.get('x-k8v-graphics-height') ?? '0'),
      pixelCount: Number(headers.get('x-k8v-graphics-pixels') ?? '0'),
    };

    const content: Array<{
      type: 'text' | 'image';
      text?: string;
      mimeType?: string;
      data?: string;
    }> = [
      {
        type: 'text',
        text: JSON.stringify(
          {
            graphicsId,
            mimeType,
            bytes: buffer.byteLength,
            selectedLevel,
          },
          null,
          2
        ),
      },
    ];

    if (includeImage !== false && mimeType.startsWith('image/')) {
      content.push({
        type: 'image',
        mimeType,
        data: buffer.toString('base64'),
      });
    }

    return { content };
  }
);

server.registerTool(
  'graph_screenshot_region',
  {
    description:
      'Render the frontend canvas-only view in Playwright and capture a fixed-size bitmap for a world-coordinate rectangle.',
    inputSchema: {
      graphId: z.string().optional(),
      graph: z.unknown().optional(),
      backendUrl: z.string().optional(),
      frontendUrl: z.string().optional(),
      regionX: z.number(),
      regionY: z.number(),
      regionWidth: z.number().positive(),
      regionHeight: z.number().positive(),
      bitmapWidth: z.number().int().positive(),
      bitmapHeight: z.number().int().positive(),
      outputPath: z.string().optional(),
      includeBase64: z.boolean().optional(),
    },
  },
  async ({
    graphId,
    graph,
    backendUrl,
    frontendUrl,
    regionX,
    regionY,
    regionWidth,
    regionHeight,
    bitmapWidth,
    bitmapHeight,
    outputPath,
    includeBase64,
  }) => {
    const resolvedBackendUrl = resolveBackendUrl(backendUrl);
    const resolvedFrontendUrl = resolveFrontendUrl(frontendUrl);
    const graphData = graph
      ? normalizeGraph(graph as Graph)
      : graphId
        ? await getGraph(resolvedBackendUrl, graphId)
        : normalizeGraph(await requestJson<Graph>(resolvedBackendUrl, '/api/graphs/latest'));

    const result = await renderGraphRegionScreenshotFromFrontend({
      frontendUrl: resolvedFrontendUrl,
      backendUrl: resolvedBackendUrl,
      graphId: graphData.id,
      graphOverride: graph ? graphData : undefined,
      region: {
        x: regionX,
        y: regionY,
        width: regionWidth,
        height: regionHeight,
      },
      bitmap: {
        width: bitmapWidth,
        height: bitmapHeight,
      },
      outputPath,
      includeBase64,
    });

    const content: Array<{
      type: 'text' | 'image';
      text?: string;
      mimeType?: string;
      data?: string;
    }> = [
      {
        type: 'text',
        text: JSON.stringify(
          {
            graphId: graphData.id,
            region: {
              x: regionX,
              y: regionY,
              width: regionWidth,
              height: regionHeight,
            },
            bitmap: {
              width: bitmapWidth,
              height: bitmapHeight,
            },
            frontendUrl: resolvedFrontendUrl,
            outputPath: result.outputPath,
            bytes: result.bytes,
          },
          null,
          2
        ),
      },
    ];

    if (result.base64) {
      content.push({
        type: 'image',
        mimeType: 'image/png',
        data: result.base64,
      });
    }

    return { content };
  }
);

export async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

const directRunCandidate = process.argv[1];
const isDirectRun = directRunCandidate
  ? pathToFileURL(directRunCandidate).href === import.meta.url
  : false;

if (isDirectRun) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exit(1);
  });
}
