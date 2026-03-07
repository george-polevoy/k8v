import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  applyProjectionToNodes,
  cloneProjectionNodeCardSizes,
  cloneProjectionNodePositions,
  type Connection,
  type Graph,
  type GraphNode,
  type GraphProjection,
  normalizeCanvasBackground,
  normalizeDrawingColor,
  normalizeGraphProjectionState,
  type PortDefinition,
  type PythonEnvironment,
} from './graphModel.js';

const PORT_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function getNode(graph: Graph, nodeId: string): GraphNode {
  const node = graph.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) {
    throw new Error(`Node ${nodeId} not found in graph ${graph.id}`);
  }
  return node;
}

export function assertValidPortName(name: string, kind: 'input' | 'output'): void {
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

export function assertConnectionPortsExist(
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

export function applyConnectionSet(current: Graph, input: ConnectionSetInput): ConnectionSetResult {
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

export function inferInputPortNamesFromCode(code: string): string[] {
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

export function inferOutputPortNamesFromCode(code: string): string[] {
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

export function updateInlineCodeNodeCode(
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

export function ensureNodeVersion(node: GraphNode): string {
  return `${Date.now()}-${node.id}`;
}

export function getNextProjectionName(existingProjections: GraphProjection[]): string {
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

export function createNumericInputNode(options: NumericInputNodeOptions): GraphNode {
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

export type BulkEditOperation = z.infer<typeof BULK_EDIT_OPERATION_SCHEMA>;

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
