import { NodeType } from './index.js';
import type {
  Connection,
  GraphNode,
  PortDefinition,
} from './index.js';

export const PORT_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
export const DEFAULT_ANNOTATION_TEXT = '';
export const DEFAULT_ANNOTATION_BACKGROUND_COLOR = '#fef3c7';
export const DEFAULT_ANNOTATION_BORDER_COLOR = '#334155';
export const DEFAULT_ANNOTATION_FONT_COLOR = '#1f2937';
export const DEFAULT_ANNOTATION_FONT_SIZE = 14;
export const MIN_ANNOTATION_FONT_SIZE = 8;
export const MAX_ANNOTATION_FONT_SIZE = 72;

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

interface PortMatch {
  name: string;
  index: number;
}

interface GeneratedNodeOptions {
  nodeId?: string;
  name?: string;
  position: { x: number; y: number };
}

interface InlineCodeNodeOptions extends GeneratedNodeOptions {
  code?: string;
  runtime?: string;
  pythonEnv?: string;
  inputNames?: string[];
  outputNames?: string[];
  autoRecompute?: boolean;
}

interface AnnotationNodeOptions extends GeneratedNodeOptions {
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

interface NumericInputNodeOptions extends GeneratedNodeOptions {
  value?: number;
  min?: number;
  max?: number;
  step?: number;
  autoRecompute?: boolean;
}

export interface NumericInputConfig {
  value: number;
  min: number;
  max: number;
  step: number;
}

function createGeneratedId(prefix: string): string {
  const cryptoLike = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  return cryptoLike?.randomUUID?.() ?? `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function assertValidPortName(name: string, kind: 'input' | 'output'): void {
  if (!PORT_NAME_PATTERN.test(name)) {
    throw new Error(
      `${kind} port name "${name}" is invalid. Use letters/numbers/underscore and start with letter/underscore.`
    );
  }
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

export function inferInputPortNamesFromCode(code: string): string[] {
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

export function inferOutputPortNamesFromCode(code: string): string[] {
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

export function ensureNodeVersion(node: Pick<GraphNode, 'id'>): string {
  return `${Date.now()}-${node.id}`;
}

function createObjectPortDefinition(name: string): PortDefinition {
  return {
    name,
    schema: { type: 'object' },
  };
}

function createNumberPortDefinition(name: string): PortDefinition {
  return {
    name,
    schema: { type: 'number' },
  };
}

export function createInlineCodeNode(options: InlineCodeNodeOptions): GraphNode {
  const inputNames = options.inputNames && options.inputNames.length > 0
    ? options.inputNames
    : ['input'];
  const outputNames = options.outputNames && options.outputNames.length > 0
    ? options.outputNames
    : ['output'];
  const nodeId = options.nodeId?.trim() || createGeneratedId('node');

  return {
    id: nodeId,
    type: NodeType.INLINE_CODE,
    position: options.position,
    metadata: {
      name: options.name ?? 'Inline Code',
      inputs: inputNames.map(createObjectPortDefinition),
      outputs: outputNames.map(createObjectPortDefinition),
    },
    config: {
      type: NodeType.INLINE_CODE,
      code: options.code ?? 'outputs.output = inputs.input;',
      runtime: options.runtime ?? 'javascript_vm',
      ...(options.pythonEnv ? { pythonEnv: options.pythonEnv } : {}),
      config: {
        autoRecompute: options.autoRecompute ?? false,
      },
    },
    version: ensureNodeVersion({ id: nodeId }),
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

  return orderedNames.map((name) => existingByName.get(name) ?? createObjectPortDefinition(name));
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
    ? explicitOutputNames
      ? explicitOutputNames.map((name) => existingByName.get(name) ?? createObjectPortDefinition(name))
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

function normalizeAnnotationColor(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;
}

export function normalizeAnnotationFontSize(
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

export function createAnnotationNode(options: AnnotationNodeOptions): GraphNode {
  const nodeId = options.nodeId?.trim() || createGeneratedId('node');

  return {
    id: nodeId,
    type: NodeType.ANNOTATION,
    position: options.position,
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
    version: ensureNodeVersion({ id: nodeId }),
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

function toFiniteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function countStepDecimals(step: number): number {
  const text = String(step).toLowerCase();
  if (text.includes('e-')) {
    const exponent = Number.parseInt(text.split('e-')[1] || '0', 10);
    return Number.isFinite(exponent) ? exponent : 0;
  }

  const decimalIndex = text.indexOf('.');
  if (decimalIndex === -1) {
    return 0;
  }

  return text.length - decimalIndex - 1;
}

export function snapNumericInputValue(value: number, min: number, max: number, step: number): number {
  if (max <= min) {
    return min;
  }

  const clamped = Math.min(Math.max(value, min), max);
  const steps = Math.round((clamped - min) / step);
  const snapped = min + (steps * step);
  const decimals = countStepDecimals(step);
  const rounded = Number(snapped.toFixed(decimals));
  return Math.min(Math.max(rounded, min), max);
}

export function normalizeNumericInputConfig(config?: Record<string, unknown>): NumericInputConfig {
  const min = toFiniteNumber(config?.min, 0);
  const maxCandidate = toFiniteNumber(config?.max, 100);
  const max = maxCandidate >= min ? maxCandidate : min;
  const stepCandidate = toFiniteNumber(config?.step, 1);
  const step = stepCandidate > 0 ? stepCandidate : 1;
  const valueCandidate = toFiniteNumber(config?.value, min);
  const value = snapNumericInputValue(valueCandidate, min, max, step);
  return { value, min, max, step };
}

export function formatNumericInputValue(value: number, step: number): string {
  const decimals = Math.min(countStepDecimals(step), 8);
  if (decimals <= 0) {
    return String(Math.round(value));
  }
  const fixed = value.toFixed(decimals);
  return fixed.replace(/\.?0+$/, '');
}

export function createNumericInputNode(options: NumericInputNodeOptions): GraphNode {
  const nodeId = options.nodeId?.trim() || createGeneratedId('node');
  const numericConfig = normalizeNumericInputConfig({
    value: options.value,
    min: options.min,
    max: options.max,
    step: options.step,
  });

  return {
    id: nodeId,
    type: NodeType.NUMERIC_INPUT,
    position: options.position,
    metadata: {
      name: options.name ?? 'Numeric Input',
      inputs: [],
      outputs: [createNumberPortDefinition('value')],
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
    version: ensureNodeVersion({ id: nodeId }),
  };
}
