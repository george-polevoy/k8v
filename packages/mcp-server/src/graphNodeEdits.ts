import { randomUUID } from 'node:crypto';
import {
  NodeType,
  type Connection,
  type GraphNode,
  type PortDefinition,
} from './graphModel.js';

const PORT_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const DEFAULT_ANNOTATION_TEXT = '';
const DEFAULT_ANNOTATION_BACKGROUND_COLOR = '#fef3c7';
const DEFAULT_ANNOTATION_BORDER_COLOR = '#334155';
const DEFAULT_ANNOTATION_FONT_COLOR = '#1f2937';
const DEFAULT_ANNOTATION_FONT_SIZE = 14;
const MIN_ANNOTATION_FONT_SIZE = 8;
const MAX_ANNOTATION_FONT_SIZE = 72;

export function assertValidPortName(name: string, kind: 'input' | 'output'): void {
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
      schema: { type: 'object' as const },
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
  const nextOutputs = node.type === NodeType.INLINE_CODE
    ? (explicitOutputNames
      ? explicitOutputNames.map(
        (name) => existingByName.get(name) ?? { name, schema: { type: 'object' as const } }
      )
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

interface AnnotationNodeOptions {
  nodeId?: string;
  name?: string;
  x: number;
  y: number;
  text?: string;
  backgroundColor?: string;
  borderColor?: string;
  fontColor?: string;
  fontSize?: number;
}

interface AnnotationConfigUpdates {
  text?: string;
  backgroundColor?: string;
  borderColor?: string;
  fontColor?: string;
  fontSize?: number;
}

function normalizeAnnotationColor(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;
}

function normalizeAnnotationFontSize(value: unknown, fallback = DEFAULT_ANNOTATION_FONT_SIZE): number {
  const fallbackSize = Math.min(
    MAX_ANNOTATION_FONT_SIZE,
    Math.max(MIN_ANNOTATION_FONT_SIZE, Number.isFinite(fallback) ? fallback : DEFAULT_ANNOTATION_FONT_SIZE)
  );
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string'
      ? Number.parseFloat(value)
      : Number.NaN;
  if (!Number.isFinite(parsed)) {
    return fallbackSize;
  }
  return Math.min(MAX_ANNOTATION_FONT_SIZE, Math.max(MIN_ANNOTATION_FONT_SIZE, Math.round(parsed)));
}

export function createAnnotationNode(options: AnnotationNodeOptions): GraphNode {
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
        fontColor: normalizeAnnotationColor(
          options.fontColor,
          DEFAULT_ANNOTATION_FONT_COLOR
        ),
        fontSize: normalizeAnnotationFontSize(options.fontSize),
        cardWidth: 320,
        cardHeight: 200,
      },
    },
    version: nowVersion,
  };
}

export function updateAnnotationNode(
  node: GraphNode,
  updates: AnnotationConfigUpdates
): GraphNode {
  const currentConfig = (node.config.config ?? {}) as Record<string, unknown>;
  const nextText = updates.text !== undefined
    ? updates.text
    : (typeof currentConfig.text === 'string' ? currentConfig.text : DEFAULT_ANNOTATION_TEXT);
  const nextBackgroundColor = updates.backgroundColor !== undefined
    ? normalizeAnnotationColor(updates.backgroundColor, DEFAULT_ANNOTATION_BACKGROUND_COLOR)
    : normalizeAnnotationColor(currentConfig.backgroundColor, DEFAULT_ANNOTATION_BACKGROUND_COLOR);
  const nextBorderColor = updates.borderColor !== undefined
    ? normalizeAnnotationColor(updates.borderColor, DEFAULT_ANNOTATION_BORDER_COLOR)
    : normalizeAnnotationColor(currentConfig.borderColor, DEFAULT_ANNOTATION_BORDER_COLOR);
  const nextFontColor = updates.fontColor !== undefined
    ? normalizeAnnotationColor(updates.fontColor, DEFAULT_ANNOTATION_FONT_COLOR)
    : normalizeAnnotationColor(currentConfig.fontColor, DEFAULT_ANNOTATION_FONT_COLOR);
  const nextFontSize = updates.fontSize !== undefined
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
