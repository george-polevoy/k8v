import { randomUUID } from 'node:crypto';
import { resolveStandardNodeCardSize } from '../../../shared/src/nodeCardGeometry.js';
import { ANNOTATION_CONNECTION_PORT } from './annotationConnections.js';
import { normalizeCanvasBackgroundValue } from './graphNormalization.js';
import type {
  Connection,
  ConnectionAnchor,
  Graph,
  GraphCommand,
  GraphNode,
  GraphProjection,
  PortDefinition,
  PythonEnvironment,
} from '../types/index.js';
import {
  DEFAULT_GRAPH_PROJECTION_ID,
  NodeType,
} from '../types/index.js';

const PORT_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;
const DEFAULT_ANNOTATION_TEXT = '';
const DEFAULT_ANNOTATION_BACKGROUND_COLOR = '#fef3c7';
const DEFAULT_ANNOTATION_BORDER_COLOR = '#334155';
const DEFAULT_ANNOTATION_FONT_COLOR = '#1f2937';
const DEFAULT_ANNOTATION_FONT_SIZE = 14;
const MIN_ANNOTATION_FONT_SIZE = 8;
const MAX_ANNOTATION_FONT_SIZE = 72;

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

function clonePosition(position: { x: number; y: number }): { x: number; y: number } {
  return {
    x: position.x,
    y: position.y,
  };
}

function resolveNodeCardSizeForNode(node: GraphNode): { width: number; height: number } {
  const config = node.config.config as { cardWidth?: unknown; cardHeight?: unknown } | undefined;
  const resolved = resolveStandardNodeCardSize(
    config,
    node.metadata.inputs.length,
    node.metadata.outputs.length,
    node.type === NodeType.NUMERIC_INPUT
  );
  return {
    width: resolved.width,
    height: resolved.height,
  };
}

function buildNodePositionMap(nodes: GraphNode[]): Record<string, { x: number; y: number }> {
  const map: Record<string, { x: number; y: number }> = {};
  for (const node of nodes) {
    map[node.id] = clonePosition(node.position);
  }
  return map;
}

function buildNodeCardSizeMap(nodes: GraphNode[]): Record<string, { width: number; height: number }> {
  const map: Record<string, { width: number; height: number }> = {};
  for (const node of nodes) {
    map[node.id] = resolveNodeCardSizeForNode(node);
  }
  return map;
}

function cloneProjectionNodePositions(
  nodes: GraphNode[],
  sourceProjection?: GraphProjection
): Record<string, { x: number; y: number }> {
  const fallbackPositions = buildNodePositionMap(nodes);
  const cloned: Record<string, { x: number; y: number }> = {};

  for (const [nodeId, fallbackPosition] of Object.entries(fallbackPositions)) {
    const candidate = sourceProjection?.nodePositions?.[nodeId];
    if (candidate && Number.isFinite(candidate.x) && Number.isFinite(candidate.y)) {
      cloned[nodeId] = clonePosition(candidate);
      continue;
    }
    cloned[nodeId] = clonePosition(fallbackPosition);
  }

  return cloned;
}

function cloneProjectionNodeCardSizes(
  nodes: GraphNode[],
  sourceProjection?: GraphProjection
): Record<string, { width: number; height: number }> {
  const fallbackNodeCardSizes = buildNodeCardSizeMap(nodes);
  const cloned: Record<string, { width: number; height: number }> = {};

  for (const [nodeId, fallbackNodeCardSize] of Object.entries(fallbackNodeCardSizes)) {
    const candidate = sourceProjection?.nodeCardSizes?.[nodeId];
    if (
      candidate &&
      Number.isFinite(candidate.width) &&
      candidate.width > 0 &&
      Number.isFinite(candidate.height) &&
      candidate.height > 0
    ) {
      cloned[nodeId] = {
        width: Math.max(1, Math.round(candidate.width)),
        height: Math.max(1, Math.round(candidate.height)),
      };
      continue;
    }
    cloned[nodeId] = {
      width: fallbackNodeCardSize.width,
      height: fallbackNodeCardSize.height,
    };
  }

  return cloned;
}

function applyProjectionToNodes(nodes: GraphNode[], projection: GraphProjection): GraphNode[] {
  return nodes.map((node) => {
    const projectedPosition = projection.nodePositions[node.id] ?? node.position;
    const projectedNodeCardSize = projection.nodeCardSizes[node.id] ?? resolveNodeCardSizeForNode(node);
    const nextConfig = {
      ...(node.config.config ?? {}),
      cardWidth: projectedNodeCardSize.width,
      cardHeight: projectedNodeCardSize.height,
    };

    if (
      node.position.x === projectedPosition.x &&
      node.position.y === projectedPosition.y &&
      node.config.config?.cardWidth === nextConfig.cardWidth &&
      node.config.config?.cardHeight === nextConfig.cardHeight
    ) {
      return node;
    }

    return {
      ...node,
      position: clonePosition(projectedPosition),
      config: {
        ...node.config,
        config: nextConfig,
      },
    };
  });
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

function normalizeDrawingColor(value: unknown, fallback = '#ffffff'): string {
  const fallbackColor = HEX_COLOR_PATTERN.test(String(fallback))
    ? String(fallback).toLowerCase()
    : '#ffffff';
  if (typeof value !== 'string') {
    return fallbackColor;
  }

  const trimmed = value.trim().toLowerCase();
  if (trimmed === 'white') return '#ffffff';
  if (trimmed === 'green') return '#22c55e';
  if (trimmed === 'red') return '#ef4444';
  if (!HEX_COLOR_PATTERN.test(trimmed)) {
    return fallbackColor;
  }
  return trimmed;
}

function assertValidPortName(name: string, kind: 'input' | 'output'): void {
  if (!PORT_NAME_PATTERN.test(name)) {
    throw new Error(
      `${kind} port name "${name}" is invalid. Use letters/numbers/underscore and start with letter/underscore.`
    );
  }
}

interface PortMatch {
  name: string;
  index: number;
}

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

  const dotMatches = collectPortMatches(code, /\binputs\.([A-Za-z_][A-Za-z0-9_]*)\b/g).filter(
    (entry) => !DICT_HELPER_METHODS.has(entry.name)
  );
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

  const dotMatches = collectPortMatches(code, /\boutputs\.([A-Za-z_][A-Za-z0-9_]*)\b/g).filter(
    (entry) => !DICT_HELPER_METHODS.has(entry.name)
  );
  const bracketMatches = collectPortMatches(
    code,
    /\boutputs\s*\[\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]\s*\]/g
  );

  return uniquePortNamesByAppearance([...dotMatches, ...bracketMatches]);
}

function ensureNodeVersion(node: GraphNode): string {
  return `${Date.now()}-${node.id}`;
}

function normalizeAnnotationColor(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;
}

function normalizeAnnotationFontSize(
  value: unknown,
  fallback = DEFAULT_ANNOTATION_FONT_SIZE
): number {
  const fallbackSize = Math.min(
    MAX_ANNOTATION_FONT_SIZE,
    Math.max(
      MIN_ANNOTATION_FONT_SIZE,
      Number.isFinite(fallback) ? fallback : DEFAULT_ANNOTATION_FONT_SIZE
    )
  );
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number.parseFloat(value)
        : Number.NaN;
  if (!Number.isFinite(parsed)) {
    return fallbackSize;
  }
  return Math.min(MAX_ANNOTATION_FONT_SIZE, Math.max(MIN_ANNOTATION_FONT_SIZE, Math.round(parsed)));
}

function createAnnotationNode(options: {
  nodeId?: string;
  name?: string;
  x: number;
  y: number;
  text?: string;
  backgroundColor?: string;
  borderColor?: string;
  fontColor?: string;
  fontSize?: number;
}): GraphNode {
  const nodeId = options.nodeId?.trim() || randomUUID();
  const nowVersion = `${Date.now()}-${nodeId}`;

  return {
    id: nodeId,
    type: NodeType.ANNOTATION,
    position: { x: options.x, y: options.y },
    metadata: {
      name: options.name ?? 'Annotation',
      inputs: [],
      outputs: [],
    },
    config: {
      type: NodeType.ANNOTATION,
      config: {
        text: options.text ?? DEFAULT_ANNOTATION_TEXT,
        backgroundColor: normalizeAnnotationColor(
          options.backgroundColor,
          DEFAULT_ANNOTATION_BACKGROUND_COLOR
        ),
        borderColor: normalizeAnnotationColor(
          options.borderColor,
          DEFAULT_ANNOTATION_BORDER_COLOR
        ),
        fontColor: normalizeAnnotationColor(options.fontColor, DEFAULT_ANNOTATION_FONT_COLOR),
        fontSize: normalizeAnnotationFontSize(options.fontSize),
        cardWidth: 320,
        cardHeight: 200,
      },
    },
    version: nowVersion,
  };
}

function updateAnnotationNode(
  node: GraphNode,
  updates: {
    text?: string;
    backgroundColor?: string;
    borderColor?: string;
    fontColor?: string;
    fontSize?: number;
  }
): GraphNode {
  const currentConfig = (node.config.config ?? {}) as Record<string, unknown>;
  const nextText =
    updates.text !== undefined
      ? updates.text
      : typeof currentConfig.text === 'string'
        ? currentConfig.text
        : DEFAULT_ANNOTATION_TEXT;
  const nextBackgroundColor =
    updates.backgroundColor !== undefined
      ? normalizeAnnotationColor(updates.backgroundColor, DEFAULT_ANNOTATION_BACKGROUND_COLOR)
      : normalizeAnnotationColor(currentConfig.backgroundColor, DEFAULT_ANNOTATION_BACKGROUND_COLOR);
  const nextBorderColor =
    updates.borderColor !== undefined
      ? normalizeAnnotationColor(updates.borderColor, DEFAULT_ANNOTATION_BORDER_COLOR)
      : normalizeAnnotationColor(currentConfig.borderColor, DEFAULT_ANNOTATION_BORDER_COLOR);
  const nextFontColor =
    updates.fontColor !== undefined
      ? normalizeAnnotationColor(updates.fontColor, DEFAULT_ANNOTATION_FONT_COLOR)
      : normalizeAnnotationColor(currentConfig.fontColor, DEFAULT_ANNOTATION_FONT_COLOR);
  const nextFontSize =
    updates.fontSize !== undefined
      ? normalizeAnnotationFontSize(updates.fontSize)
      : normalizeAnnotationFontSize(currentConfig.fontSize);

  return {
    ...node,
    config: {
      ...node.config,
      config: {
        ...currentConfig,
        text: nextText,
        backgroundColor: nextBackgroundColor,
        borderColor: nextBorderColor,
        fontColor: nextFontColor,
        fontSize: nextFontSize,
      },
    },
    version: ensureNodeVersion(node),
  };
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
  const snapped = min + steps * step;
  const decimals = countStepDecimals(step);
  const rounded = Number(snapped.toFixed(decimals));
  return clamp(rounded, min, max);
}

function normalizeNumericInputConfig(config: {
  value?: unknown;
  min?: unknown;
  max?: unknown;
  step?: unknown;
}): { value: number; min: number; max: number; step: number } {
  const min = toFiniteNumber(config.min, 0);
  const maxCandidate = toFiniteNumber(config.max, 100);
  const max = maxCandidate >= min ? maxCandidate : min;
  const stepCandidate = toFiniteNumber(config.step, 1);
  const step = stepCandidate > 0 ? stepCandidate : 1;
  const valueCandidate = toFiniteNumber(config.value, min);
  const value = snapNumericInputValue(valueCandidate, min, max, step);
  return { value, min, max, step };
}

function createNumericInputNode(options: {
  nodeId?: string;
  name?: string;
  x: number;
  y: number;
  value?: number;
  min?: number;
  max?: number;
  step?: number;
  autoRecompute?: boolean;
}): GraphNode {
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
    type: NodeType.NUMERIC_INPUT,
    position: { x: options.x, y: options.y },
    metadata: {
      name: options.name ?? 'Numeric Input',
      inputs: [],
      outputs: [{ name: 'value', schema: { type: 'number' } }],
    },
    config: {
      type: NodeType.NUMERIC_INPUT,
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

function getNode(graph: Graph, nodeId: string): GraphNode {
  const node = graph.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) {
    throw new Error(`Node ${nodeId} not found in graph ${graph.id}`);
  }
  return node;
}

function isAnnotationNode(node: GraphNode): boolean {
  return node.type === NodeType.ANNOTATION;
}

function isValidSourcePort(node: GraphNode, port: string): boolean {
  return (
    (isAnnotationNode(node) && port === ANNOTATION_CONNECTION_PORT) ||
    node.metadata.outputs.some((output) => output.name === port)
  );
}

function isValidTargetPort(node: GraphNode, port: string): boolean {
  return (
    (isAnnotationNode(node) && port === ANNOTATION_CONNECTION_PORT) ||
    node.metadata.inputs.some((input) => input.name === port)
  );
}

function areConnectionAnchorsEqual(
  left: ConnectionAnchor | undefined,
  right: ConnectionAnchor | undefined
): boolean {
  if (left === right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }
  return left.side === right.side && Math.abs(left.offset - right.offset) < 1e-6;
}

function matchesConnectionDefinition(
  connection: Connection,
  candidate: {
    sourceNodeId: string;
    sourcePort: string;
    sourceAnchor?: ConnectionAnchor;
    targetNodeId: string;
    targetPort: string;
    targetAnchor?: ConnectionAnchor;
  }
): boolean {
  return (
    connection.sourceNodeId === candidate.sourceNodeId &&
    connection.sourcePort === candidate.sourcePort &&
    areConnectionAnchorsEqual(connection.sourceAnchor, candidate.sourceAnchor) &&
    connection.targetNodeId === candidate.targetNodeId &&
    connection.targetPort === candidate.targetPort &&
    areConnectionAnchorsEqual(connection.targetAnchor, candidate.targetAnchor)
  );
}

function matchesTargetSlot(
  connection: Connection,
  targetNode: GraphNode,
  input: {
    targetNodeId: string;
    targetPort: string;
    targetAnchor?: ConnectionAnchor;
  }
): boolean {
  if (connection.targetNodeId !== input.targetNodeId || connection.targetPort !== input.targetPort) {
    return false;
  }

  if (!isAnnotationNode(targetNode)) {
    return true;
  }

  return areConnectionAnchorsEqual(connection.targetAnchor, input.targetAnchor);
}

function assertConnectionPortsExist(
  graph: Graph,
  sourceNodeId: string,
  sourcePort: string,
  targetNodeId: string,
  targetPort: string,
  sourceAnchor?: ConnectionAnchor,
  targetAnchor?: ConnectionAnchor
): void {
  const sourceNode = getNode(graph, sourceNodeId);
  const targetNode = getNode(graph, targetNodeId);
  if (!isValidSourcePort(sourceNode, sourcePort)) {
    throw new Error(`Source port ${sourcePort} not found on node ${sourceNodeId}`);
  }
  if (!isValidTargetPort(targetNode, targetPort)) {
    throw new Error(`Target port ${targetPort} not found on node ${targetNodeId}`);
  }
  if (sourceAnchor && !isAnnotationNode(sourceNode)) {
    throw new Error(`Source anchor is only valid for annotation node ${sourceNodeId}`);
  }
  if (targetAnchor && !isAnnotationNode(targetNode)) {
    throw new Error(`Target anchor is only valid for annotation node ${targetNodeId}`);
  }
}

function applyConnectionSet(
  current: Graph,
  input: {
    sourceNodeId: string;
    sourcePort: string;
    sourceAnchor?: ConnectionAnchor;
    targetNodeId: string;
    targetPort: string;
    targetAnchor?: ConnectionAnchor;
    connectionId?: string;
  }
): { changed: boolean; connections: Connection[] } {
  const targetNode = getNode(current, input.targetNodeId);
  assertConnectionPortsExist(
    current,
    input.sourceNodeId,
    input.sourcePort,
    input.targetNodeId,
    input.targetPort,
    input.sourceAnchor,
    input.targetAnchor
  );

  const inbound = current.connections.filter((connection) => matchesTargetSlot(connection, targetNode, input));
  const matchingInbound = inbound.find((connection) => matchesConnectionDefinition(connection, input));
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
  const unchanged = existingSingleInbound
    ? matchesConnectionDefinition(existingSingleInbound, input) &&
      existingSingleInbound.id === nextConnectionId
    : false;
  if (unchanged) {
    return { changed: false, connections: current.connections };
  }

  const nextConnection: Connection = {
    id: nextConnectionId,
    sourceNodeId: input.sourceNodeId,
    sourcePort: input.sourcePort,
    ...(input.sourceAnchor ? { sourceAnchor: input.sourceAnchor } : {}),
    targetNodeId: input.targetNodeId,
    targetPort: input.targetPort,
    ...(input.targetAnchor ? { targetAnchor: input.targetAnchor } : {}),
  };

  return {
    changed: true,
    connections: [
      ...current.connections.filter((connection) => !matchesTargetSlot(connection, targetNode, input)),
      nextConnection,
    ],
  };
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

  return orderedNames.map((name) => existingByName.get(name) ?? { name, schema: { type: 'object' as const } });
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
  const nextOutputs =
    node.type === NodeType.INLINE_CODE
      ? explicitOutputNames
        ? explicitOutputNames.map(
            (name) => existingByName.get(name) ?? { name, schema: { type: 'object' as const } }
          )
        : reconcileInlineOutputPorts(node, code, connections)
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
      ...(pythonEnv !== undefined ? { pythonEnv } : {}),
    },
    version: ensureNodeVersion(node),
  };
}

export function applyGraphCommandMutation(graph: Graph, command: GraphCommand): Graph {
  switch (command.kind) {
    case 'graph_projection_add': {
      const projections = graph.projections ?? [];
      const sourceId = command.sourceProjectionId?.trim() || graph.activeProjectionId || DEFAULT_GRAPH_PROJECTION_ID;
      const sourceProjection = projections.find((projection) => projection.id === sourceId);
      if (!sourceProjection) {
        throw new Error(`Projection "${sourceId}" was not found in graph ${graph.id}`);
      }

      const nextProjectionId = command.projectionId?.trim() || randomUUID();
      if (projections.some((projection) => projection.id === nextProjectionId)) {
        throw new Error(`Projection "${nextProjectionId}" already exists in graph ${graph.id}`);
      }

      const newProjection: GraphProjection = {
        id: nextProjectionId,
        name: command.name?.trim() || getNextProjectionName(projections),
        nodePositions: cloneProjectionNodePositions(graph.nodes, sourceProjection),
        nodeCardSizes: cloneProjectionNodeCardSizes(graph.nodes, sourceProjection),
        canvasBackground: normalizeCanvasBackgroundValue(
          sourceProjection.canvasBackground ?? graph.canvasBackground
        ),
      };

      const nextActiveProjectionId = command.activate === false
        ? graph.activeProjectionId ?? DEFAULT_GRAPH_PROJECTION_ID
        : newProjection.id;
      const activeProjection = nextActiveProjectionId === newProjection.id
        ? newProjection
        : projections.find((projection) => projection.id === nextActiveProjectionId) ?? newProjection;

      return {
        ...graph,
        projections: [...projections, newProjection],
        activeProjectionId: nextActiveProjectionId,
        nodes: applyProjectionToNodes(graph.nodes, activeProjection),
        canvasBackground: normalizeCanvasBackgroundValue(
          activeProjection.canvasBackground ?? graph.canvasBackground
        ),
      };
    }

    case 'graph_projection_select': {
      const projection = (graph.projections ?? []).find(
        (candidate) => candidate.id === command.projectionId
      );
      if (!projection) {
        throw new Error(`Projection "${command.projectionId}" was not found in graph ${graph.id}`);
      }

      return {
        ...graph,
        activeProjectionId: projection.id,
        nodes: applyProjectionToNodes(graph.nodes, projection),
        canvasBackground: normalizeCanvasBackgroundValue(
          projection.canvasBackground ?? graph.canvasBackground
        ),
      };
    }

    case 'graph_python_env_add': {
      const existingEnvs = graph.pythonEnvs ?? [];
      if (existingEnvs.some((env) => env.name === command.name)) {
        throw new Error(`Python environment "${command.name}" already exists in graph ${graph.id}`);
      }

      return {
        ...graph,
        pythonEnvs: [
          ...existingEnvs,
          {
            name: command.name,
            pythonPath: command.pythonPath,
            cwd: command.cwd,
          },
        ],
      };
    }

    case 'graph_python_env_edit': {
      const existingEnvs = graph.pythonEnvs ?? [];
      const envIndex = existingEnvs.findIndex((env) => env.name === command.envName);
      if (envIndex === -1) {
        throw new Error(`Python environment "${command.envName}" was not found in graph ${graph.id}`);
      }

      const existingEnv = existingEnvs[envIndex];
      const nextEnvName = command.name ?? existingEnv.name;
      const nextEnv: PythonEnvironment = {
        name: nextEnvName,
        pythonPath: command.pythonPath ?? existingEnv.pythonPath,
        cwd: command.cwd ?? existingEnv.cwd,
      };
      const duplicateName = existingEnvs.some(
        (env, index) => index !== envIndex && env.name === nextEnv.name
      );
      if (duplicateName) {
        throw new Error(`Python environment "${nextEnv.name}" already exists in graph ${graph.id}`);
      }

      return {
        ...graph,
        pythonEnvs: existingEnvs.map((env, index) => (index === envIndex ? nextEnv : env)),
        nodes:
          nextEnvName === command.envName
            ? graph.nodes
            : graph.nodes.map((node) =>
                node.config.pythonEnv === command.envName
                  ? {
                      ...node,
                      config: {
                        ...node.config,
                        pythonEnv: nextEnvName,
                      },
                      version: ensureNodeVersion(node),
                    }
                  : node
              ),
      };
    }

    case 'graph_python_env_delete': {
      const existingEnvs = graph.pythonEnvs ?? [];
      if (!existingEnvs.some((env) => env.name === command.envName)) {
        throw new Error(`Python environment "${command.envName}" was not found in graph ${graph.id}`);
      }

      return {
        ...graph,
        pythonEnvs: existingEnvs.filter((env) => env.name !== command.envName),
        nodes: graph.nodes.map((node) =>
          node.config.pythonEnv === command.envName
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
    }

    case 'node_add_inline': {
      const nodeId = command.nodeId?.trim() || randomUUID();
      if (graph.nodes.some((node) => node.id === nodeId)) {
        throw new Error(`Node ${nodeId} already exists in graph ${graph.id}`);
      }

      const inlineCode = command.code ?? 'outputs.output = inputs.input;';
      const inferredInputNames = inferInputPortNamesFromCode(inlineCode);
      const inferredOutputNames = inferOutputPortNamesFromCode(inlineCode);
      const resolvedInputNames = command.inputNames?.length
        ? command.inputNames
        : inferredInputNames.length > 0
          ? inferredInputNames
          : ['input'];
      const resolvedOutputNames = command.outputNames?.length
        ? command.outputNames
        : inferredOutputNames.length > 0
          ? inferredOutputNames
          : ['output'];

      const inputs = resolvedInputNames.map((portName) => {
        assertValidPortName(portName, 'input');
        return {
          name: portName,
          schema: { type: 'object' as const },
        };
      });
      const outputs = resolvedOutputNames.map((portName) => {
        assertValidPortName(portName, 'output');
        return {
          name: portName,
          schema: { type: 'object' as const },
        };
      });

      const node: GraphNode = {
        id: nodeId,
        type: NodeType.INLINE_CODE,
        position: { x: command.x, y: command.y },
        metadata: {
          name: command.name ?? 'Inline Code',
          inputs,
          outputs,
        },
        config: {
          type: NodeType.INLINE_CODE,
          runtime: command.runtime ?? 'javascript_vm',
          ...(command.pythonEnv ? { pythonEnv: command.pythonEnv } : {}),
          code: inlineCode,
          config: {
            autoRecompute: command.autoRecompute ?? false,
          },
        },
        version: `${Date.now()}-${nodeId}`,
      };

      return {
        ...graph,
        nodes: [...graph.nodes, node],
      };
    }

    case 'node_add_numeric_input': {
      const node = createNumericInputNode({
        nodeId: command.nodeId,
        name: command.name,
        x: command.x,
        y: command.y,
        value: command.value,
        min: command.min,
        max: command.max,
        step: command.step,
        autoRecompute: command.autoRecompute,
      });
      if (graph.nodes.some((candidate) => candidate.id === node.id)) {
        throw new Error(`Node ${node.id} already exists in graph ${graph.id}`);
      }
      return {
        ...graph,
        nodes: [...graph.nodes, node],
      };
    }

    case 'node_add_annotation': {
      const node = createAnnotationNode({
        nodeId: command.nodeId,
        name: command.name,
        x: command.x,
        y: command.y,
        text: command.text,
        backgroundColor: command.backgroundColor,
        borderColor: command.borderColor,
        fontColor: command.fontColor,
        fontSize: command.fontSize,
      });
      if (graph.nodes.some((candidate) => candidate.id === node.id)) {
        throw new Error(`Node ${node.id} already exists in graph ${graph.id}`);
      }
      return {
        ...graph,
        nodes: [...graph.nodes, node],
      };
    }

    case 'node_move':
      getNode(graph, command.nodeId);
      return {
        ...graph,
        nodes: graph.nodes.map((node) =>
          node.id === command.nodeId
            ? {
                ...node,
                position: { x: command.x, y: command.y },
              }
            : node
        ),
      };

    case 'node_set_name':
      return {
        ...graph,
        nodes: graph.nodes.map((node) =>
          node.id === command.nodeId
            ? {
                ...node,
                metadata: {
                  ...node.metadata,
                  name: command.name,
                },
                version: ensureNodeVersion(node),
              }
            : node
        ),
      };

    case 'node_set_code':
      return {
        ...graph,
        nodes: graph.nodes.map((node) => {
          if (node.id !== command.nodeId) {
            return node;
          }
          if (node.type !== NodeType.INLINE_CODE) {
            throw new Error(`Node ${command.nodeId} is not an inline code node`);
          }
          return updateInlineCodeNodeCode(
            node,
            command.code,
            graph.connections,
            command.outputNames,
            command.runtime,
            command.pythonEnv
          );
        }),
      };

    case 'node_set_annotation':
      return {
        ...graph,
        nodes: graph.nodes.map((node) => {
          if (node.id !== command.nodeId) {
            return node;
          }
          if (node.type !== NodeType.ANNOTATION) {
            throw new Error(`Node ${command.nodeId} is not an annotation node`);
          }
          return updateAnnotationNode(node, {
            text: command.text,
            backgroundColor: command.backgroundColor,
            borderColor: command.borderColor,
            fontColor: command.fontColor,
            fontSize: command.fontSize,
          });
        }),
      };

    case 'node_set_auto_recompute':
      return {
        ...graph,
        nodes: graph.nodes.map((node) =>
          node.id === command.nodeId
            ? {
                ...node,
                config: {
                  ...node.config,
                  config: {
                    ...(node.config.config ?? {}),
                    autoRecompute: command.enabled,
                  },
                },
                version: ensureNodeVersion(node),
              }
            : node
        ),
      };

    case 'node_add_input': {
      assertValidPortName(command.inputName, 'input');
      const node = getNode(graph, command.nodeId);
      if (node.metadata.inputs.some((input) => input.name === command.inputName)) {
        throw new Error(`Input port ${command.inputName} already exists on node ${command.nodeId}`);
      }
      return {
        ...graph,
        nodes: graph.nodes.map((candidate) =>
          candidate.id === command.nodeId
            ? {
                ...candidate,
                metadata: {
                  ...candidate.metadata,
                  inputs: [
                    ...candidate.metadata.inputs,
                    {
                      name: command.inputName,
                      schema: { type: 'object' },
                    },
                  ],
                },
                version: ensureNodeVersion(candidate),
              }
            : candidate
        ),
      };
    }

    case 'node_delete_input': {
      const node = getNode(graph, command.nodeId);
      if (!node.metadata.inputs.some((input) => input.name === command.inputName)) {
        throw new Error(`Input port ${command.inputName} was not found on node ${command.nodeId}`);
      }
      return {
        ...graph,
        nodes: graph.nodes.map((candidate) =>
          candidate.id === command.nodeId
            ? {
                ...candidate,
                metadata: {
                  ...candidate.metadata,
                  inputs: candidate.metadata.inputs.filter(
                    (input) => input.name !== command.inputName
                  ),
                },
                version: ensureNodeVersion(candidate),
              }
            : candidate
        ),
        connections: graph.connections.filter(
          (connection) =>
            !(connection.targetNodeId === command.nodeId && connection.targetPort === command.inputName)
        ),
      };
    }

    case 'node_move_input': {
      const node = getNode(graph, command.nodeId);
      const inputs = [...node.metadata.inputs];
      const index = inputs.findIndex((input) => input.name === command.inputName);
      if (index === -1) {
        throw new Error(`Input port ${command.inputName} was not found on node ${command.nodeId}`);
      }

      const targetIndex = command.direction === 'up' ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= inputs.length) {
        return graph;
      }

      [inputs[index], inputs[targetIndex]] = [inputs[targetIndex], inputs[index]];
      return {
        ...graph,
        nodes: graph.nodes.map((candidate) =>
          candidate.id === command.nodeId
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
    }

    case 'node_rename_input': {
      assertValidPortName(command.newName, 'input');
      const node = getNode(graph, command.nodeId);
      if (!node.metadata.inputs.some((input) => input.name === command.oldName)) {
        throw new Error(`Input port ${command.oldName} was not found on node ${command.nodeId}`);
      }
      if (node.metadata.inputs.some((input) => input.name === command.newName)) {
        throw new Error(`Input port ${command.newName} already exists on node ${command.nodeId}`);
      }
      return {
        ...graph,
        nodes: graph.nodes.map((candidate) =>
          candidate.id === command.nodeId
            ? {
                ...candidate,
                metadata: {
                  ...candidate.metadata,
                  inputs: candidate.metadata.inputs.map((input) =>
                    input.name === command.oldName
                      ? {
                          ...input,
                          name: command.newName,
                        }
                      : input
                  ),
                },
                version: ensureNodeVersion(candidate),
              }
            : candidate
        ),
        connections: graph.connections.map((connection) =>
          connection.targetNodeId === command.nodeId && connection.targetPort === command.oldName
            ? {
                ...connection,
                targetPort: command.newName,
              }
            : connection
        ),
      };
    }

    case 'node_delete':
      return {
        ...graph,
        nodes: graph.nodes.filter((node) => node.id !== command.nodeId),
        connections: graph.connections.filter(
          (connection) =>
            connection.sourceNodeId !== command.nodeId && connection.targetNodeId !== command.nodeId
        ),
      };

    case 'connection_add': {
      assertConnectionPortsExist(
        graph,
        command.sourceNodeId,
        command.sourcePort,
        command.targetNodeId,
        command.targetPort,
        command.sourceAnchor,
        command.targetAnchor
      );
      const duplicate = graph.connections.some((connection) =>
        matchesConnectionDefinition(connection, {
          sourceNodeId: command.sourceNodeId,
          sourcePort: command.sourcePort,
          sourceAnchor: command.sourceAnchor,
          targetNodeId: command.targetNodeId,
          targetPort: command.targetPort,
          targetAnchor: command.targetAnchor,
        })
      );
      if (duplicate) {
        return graph;
      }
      return {
        ...graph,
        connections: [
          ...graph.connections,
          {
            id: command.connectionId ?? randomUUID(),
            sourceNodeId: command.sourceNodeId,
            sourcePort: command.sourcePort,
            ...(command.sourceAnchor ? { sourceAnchor: command.sourceAnchor } : {}),
            targetNodeId: command.targetNodeId,
            targetPort: command.targetPort,
            ...(command.targetAnchor ? { targetAnchor: command.targetAnchor } : {}),
          },
        ],
      };
    }

    case 'connection_set':
    case 'connection_replace': {
      const result = applyConnectionSet(graph, {
        sourceNodeId: command.sourceNodeId,
        sourcePort: command.sourcePort,
        sourceAnchor: command.sourceAnchor,
        targetNodeId: command.targetNodeId,
        targetPort: command.targetPort,
        targetAnchor: command.targetAnchor,
        connectionId: command.connectionId,
      });
      if (!result.changed) {
        return graph;
      }
      return {
        ...graph,
        connections: result.connections,
      };
    }

    case 'connection_delete':
      return {
        ...graph,
        connections: graph.connections.filter((connection) => connection.id !== command.connectionId),
      };

    case 'drawing_create': {
      const drawingId = command.drawingId?.trim() || randomUUID();
      if ((graph.drawings ?? []).some((drawing) => drawing.id === drawingId)) {
        throw new Error(`Drawing ${drawingId} already exists in graph ${graph.id}`);
      }
      return {
        ...graph,
        drawings: [
          ...(graph.drawings ?? []),
          {
            id: drawingId,
            name: command.name ?? `Drawing ${((graph.drawings ?? []).length + 1)}`,
            position: {
              x: command.x ?? 0,
              y: command.y ?? 0,
            },
            paths: [],
          },
        ],
      };
    }

    case 'drawing_add_path': {
      const drawing = (graph.drawings ?? []).find((candidate) => candidate.id === command.drawingId);
      if (!drawing) {
        throw new Error(`Drawing ${command.drawingId} not found in graph ${graph.id}`);
      }
      const localPoints =
        (command.coordinateSpace ?? 'world') === 'local'
          ? command.points
          : command.points.map((point) => ({
              x: point.x - drawing.position.x,
              y: point.y - drawing.position.y,
            }));
      const pathId = command.pathId ?? randomUUID();
      return {
        ...graph,
        drawings: (graph.drawings ?? []).map((candidate) =>
          candidate.id === command.drawingId
            ? {
                ...candidate,
                paths: [
                  ...candidate.paths,
                  {
                    id: pathId,
                    color: normalizeDrawingColor(command.color, '#ffffff'),
                    thickness: command.thickness ?? 3,
                    points: localPoints,
                  },
                ],
              }
            : candidate
        ),
      };
    }

    case 'drawing_move':
      return {
        ...graph,
        drawings: (graph.drawings ?? []).map((drawing) =>
          drawing.id === command.drawingId
            ? {
                ...drawing,
                position: { x: command.x, y: command.y },
              }
            : drawing
        ),
      };

    case 'drawing_set_name':
      return {
        ...graph,
        drawings: (graph.drawings ?? []).map((drawing) =>
          drawing.id === command.drawingId
            ? {
                ...drawing,
                name: command.name,
              }
            : drawing
        ),
      };

    case 'drawing_delete':
      return {
        ...graph,
        drawings: (graph.drawings ?? []).filter((drawing) => drawing.id !== command.drawingId),
      };

    default:
      throw new Error(`Unsupported graph mutation command: ${JSON.stringify(command)}`);
  }
}
