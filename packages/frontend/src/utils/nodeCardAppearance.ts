import type { GraphNode } from '../types';
import { NodeType } from '../types';
import { normalizeAnnotationConfig } from './annotation';
import { normalizeColorString } from './color';

export const DEFAULT_NODE_CARD_BACKGROUND_COLOR = '#f8fafc';
export const DEFAULT_NODE_CARD_BORDER_COLOR = '#334155';

export interface NodeCardAppearance {
  backgroundColor: string;
  borderColor: string;
}

export function normalizeNodeCardAppearanceConfig(
  config?: Record<string, unknown>
): NodeCardAppearance {
  return {
    backgroundColor: normalizeColorString(
      config?.backgroundColor,
      DEFAULT_NODE_CARD_BACKGROUND_COLOR
    ),
    borderColor: normalizeColorString(
      config?.borderColor,
      DEFAULT_NODE_CARD_BORDER_COLOR
    ),
  };
}

export function resolveNodeCardAppearance(node: GraphNode): NodeCardAppearance {
  if (node.type === NodeType.ANNOTATION) {
    const annotationConfig = normalizeAnnotationConfig(
      node.config.config as Record<string, unknown> | undefined
    );
    return {
      backgroundColor: annotationConfig.backgroundColor,
      borderColor: annotationConfig.borderColor,
    };
  }

  return normalizeNodeCardAppearanceConfig(
    node.config.config as Record<string, unknown> | undefined
  );
}
