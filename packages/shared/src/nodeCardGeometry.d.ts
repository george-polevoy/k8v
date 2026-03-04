export interface NodeCardConfigLike {
  cardWidth?: unknown;
  cardHeight?: unknown;
}

export const NODE_WIDTH: number;
export const NODE_MIN_WIDTH: number;
export const MIN_NODE_HEIGHT: number;
export const HEADER_HEIGHT: number;
export const NODE_BODY_PADDING: number;
export const PORT_SPACING: number;
export const NUMERIC_INPUT_NODE_MIN_HEIGHT: number;

export function resolveStandardNodeMinHeight(
  inputCount: number,
  outputCount: number,
  isNumericInput?: boolean
): number;

export function resolveStandardNodeCardSize(
  config: NodeCardConfigLike | null | undefined,
  inputCount: number,
  outputCount: number,
  isNumericInput?: boolean
): { width: number; height: number; minHeight: number };

