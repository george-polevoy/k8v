export const NODE_WIDTH = 220;
export const NODE_MIN_WIDTH = 180;
export const MIN_NODE_HEIGHT = 68;
export const HEADER_HEIGHT = 36;
export const NODE_BODY_PADDING = 6;
export const PORT_SPACING = 18;
export const NUMERIC_INPUT_NODE_MIN_HEIGHT = 80;

function clampCount(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.floor(value));
}

function toFiniteNumber(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function resolveStandardNodeMinHeight(inputCount, outputCount, isNumericInput = false) {
  const safeInputCount = clampCount(inputCount);
  const safeOutputCount = clampCount(outputCount);
  const maxPorts = Math.max(safeInputCount, safeOutputCount, 1);
  const baseHeight = Math.max(MIN_NODE_HEIGHT, HEADER_HEIGHT + NODE_BODY_PADDING + (maxPorts * PORT_SPACING));
  if (isNumericInput) {
    return Math.max(baseHeight, NUMERIC_INPUT_NODE_MIN_HEIGHT);
  }
  return baseHeight;
}

export function resolveStandardNodeCardSize(
  config,
  inputCount,
  outputCount,
  isNumericInput = false
) {
  const minHeight = resolveStandardNodeMinHeight(inputCount, outputCount, isNumericInput);
  const rawWidth = toFiniteNumber(config?.cardWidth, NODE_WIDTH);
  const rawHeight = toFiniteNumber(config?.cardHeight, minHeight);

  return {
    width: Math.max(NODE_MIN_WIDTH, Math.round(rawWidth)),
    height: Math.max(minHeight, Math.round(rawHeight)),
    minHeight,
  };
}

