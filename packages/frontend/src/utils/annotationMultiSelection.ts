import type { Graph, GraphNode } from '../types';
import { NodeType } from '../types';
import {
  DEFAULT_ANNOTATION_FONT_COLOR,
  DEFAULT_ANNOTATION_FONT_SIZE,
  normalizeAnnotationConfig,
  normalizeAnnotationFontSize,
} from './annotation';
import { normalizeColorString } from './color';

export interface SharedAnnotationTextStyleSelectionState {
  isApplicable: boolean;
  firstFontColor: string;
  firstFontSize: number;
  hasMixedFontColor: boolean;
  hasMixedFontSize: boolean;
}

export interface SharedAnnotationTextStyleUpdateResult {
  nodes: GraphNode[];
  didChange: boolean;
  nextFontColor?: string;
  nextFontSize?: number;
}

export function resolveSharedAnnotationTextStyleSelectionState(
  selectedNodes: GraphNode[]
): SharedAnnotationTextStyleSelectionState {
  if (
    selectedNodes.length < 2 ||
    !selectedNodes.every((node) => node.config.type === NodeType.ANNOTATION)
  ) {
    return {
      isApplicable: false,
      firstFontColor: DEFAULT_ANNOTATION_FONT_COLOR,
      firstFontSize: DEFAULT_ANNOTATION_FONT_SIZE,
      hasMixedFontColor: false,
      hasMixedFontSize: false,
    };
  }

  const annotationConfigs = selectedNodes.map((node) =>
    normalizeAnnotationConfig(node.config.config as Record<string, unknown> | undefined)
  );

  return {
    isApplicable: true,
    firstFontColor: annotationConfigs[0]?.fontColor ?? DEFAULT_ANNOTATION_FONT_COLOR,
    firstFontSize: annotationConfigs[0]?.fontSize ?? DEFAULT_ANNOTATION_FONT_SIZE,
    hasMixedFontColor: new Set(annotationConfigs.map((config) => config.fontColor)).size > 1,
    hasMixedFontSize: new Set(annotationConfigs.map((config) => config.fontSize)).size > 1,
  };
}

export function buildSharedAnnotationTextStyleNodes(
  graph: Graph,
  selectedNodes: GraphNode[],
  overrides: {
    fontColor?: string;
    fontSize?: number | string;
  }
): SharedAnnotationTextStyleUpdateResult {
  const selectionState = resolveSharedAnnotationTextStyleSelectionState(selectedNodes);
  if (!selectionState.isApplicable) {
    return {
      nodes: graph.nodes,
      didChange: false,
    };
  }

  const nextFontColor = overrides.fontColor !== undefined
    ? normalizeColorString(overrides.fontColor, DEFAULT_ANNOTATION_FONT_COLOR)
    : undefined;

  let nextFontSize: number | undefined;
  if (overrides.fontSize !== undefined) {
    const rawFontSize = typeof overrides.fontSize === 'string'
      ? overrides.fontSize.trim()
      : overrides.fontSize;
    if (rawFontSize === '') {
      return {
        nodes: graph.nodes,
        didChange: false,
        nextFontColor,
      };
    }

    const parsedFontSize = typeof rawFontSize === 'number'
      ? rawFontSize
      : Number.parseFloat(rawFontSize);
    if (!Number.isFinite(parsedFontSize)) {
      return {
        nodes: graph.nodes,
        didChange: false,
        nextFontColor,
      };
    }

    nextFontSize = normalizeAnnotationFontSize(
      parsedFontSize,
      selectionState.firstFontSize
    );
  }

  if (nextFontColor === undefined && nextFontSize === undefined) {
    return {
      nodes: graph.nodes,
      didChange: false,
    };
  }

  const selectedNodeIdSet = new Set(selectedNodes.map((node) => node.id));
  let didChange = false;
  const version = Date.now().toString();
  const nodes = graph.nodes.map((node) => {
    if (!selectedNodeIdSet.has(node.id) || node.config.type !== NodeType.ANNOTATION) {
      return node;
    }

    const current = normalizeAnnotationConfig(
      node.config.config as Record<string, unknown> | undefined
    );
    const resolvedFontColor = nextFontColor ?? current.fontColor;
    const resolvedFontSize = nextFontSize ?? current.fontSize;
    if (
      resolvedFontColor === current.fontColor &&
      resolvedFontSize === current.fontSize
    ) {
      return node;
    }

    didChange = true;
    return {
      ...node,
      config: {
        ...node.config,
        config: {
          ...(node.config.config ?? {}),
          fontColor: resolvedFontColor,
          fontSize: resolvedFontSize,
        },
      },
      version,
    };
  });

  return {
    nodes,
    didChange,
    nextFontColor,
    nextFontSize,
  };
}
