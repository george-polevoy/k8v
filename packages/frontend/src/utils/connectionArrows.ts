export interface ConnectionArrowHeadDimensions {
  length: number;
  width: number;
}

export interface ConnectionArrowHeadLayout {
  foreground: ConnectionArrowHeadDimensions;
  background: ConnectionArrowHeadDimensions;
}

interface ResolveConnectionArrowHeadLayoutParams {
  foregroundLineWidth: number;
  backgroundLineWidth: number;
  viewportScale: number;
}

export function resolveConnectionArrowHeadLayout(
  params: ResolveConnectionArrowHeadLayoutParams
): ConnectionArrowHeadLayout {
  const safeViewportScale = Math.max(params.viewportScale, 0.0001);
  const foregroundLineWidth = Math.max(params.foregroundLineWidth, 0);
  const backgroundLineWidth = Math.max(params.backgroundLineWidth, foregroundLineWidth);

  const foregroundLength = Math.max(foregroundLineWidth * 5, 9 / safeViewportScale);
  const foregroundWidth = Math.max(foregroundLineWidth * 3.5, 7 / safeViewportScale);
  const outlineThickness = Math.max((backgroundLineWidth - foregroundLineWidth) * 0.5, 0);

  return {
    foreground: {
      length: foregroundLength,
      width: foregroundWidth,
    },
    background: {
      length: foregroundLength + outlineThickness,
      width: foregroundWidth + (outlineThickness * 2),
    },
  };
}
