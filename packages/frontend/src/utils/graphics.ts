import { GraphicsArtifact } from '../types';

const MIN_PIXELS = 1;
const MIP_SELECTION_QUALITY_MULTIPLIER = 2;

function clampPositiveInt(value: number): number {
  if (!Number.isFinite(value)) {
    return MIN_PIXELS;
  }
  return Math.max(MIN_PIXELS, Math.floor(value));
}

export function isRenderableGraphicsArtifact(graphics: GraphicsArtifact | null | undefined): boolean {
  return Boolean(graphics && typeof graphics.mimeType === 'string' && graphics.mimeType.startsWith('image/'));
}

export function buildGraphicsImageUrl(graphics: GraphicsArtifact, maxPixels?: number): string {
  const params = new URLSearchParams();
  if (typeof maxPixels === 'number' && Number.isFinite(maxPixels) && maxPixels > 0) {
    params.set('maxPixels', String(clampPositiveInt(maxPixels)));
  }

  const query = params.toString();
  return `/api/graphics/${encodeURIComponent(graphics.id)}/image${query ? `?${query}` : ''}`;
}

function getSortedLevels(graphics: GraphicsArtifact) {
  return [...graphics.levels].sort((left, right) => left.level - right.level);
}

export function selectGraphicsMipLevel(
  graphics: GraphicsArtifact,
  maxPixels?: number
) {
  const levels = getSortedLevels(graphics);
  if (levels.length === 0) {
    return null;
  }

  if (typeof maxPixels !== 'number' || !Number.isFinite(maxPixels) || maxPixels <= 0) {
    return levels[0];
  }

  const budget = clampPositiveInt(maxPixels * MIP_SELECTION_QUALITY_MULTIPLIER);
  for (const level of levels) {
    if (level.pixelCount <= budget) {
      return level;
    }
  }

  return levels[levels.length - 1];
}

export function resolveStableGraphicsRequestMaxPixels(
  graphics: GraphicsArtifact,
  maxPixels?: number
): number {
  const selected = selectGraphicsMipLevel(graphics, maxPixels);
  if (!selected) {
    return MIN_PIXELS;
  }
  return clampPositiveInt(selected.pixelCount);
}

export function estimateProjectedPixelBudget(
  graphics: GraphicsArtifact,
  projectedWidth: number,
  devicePixelRatio: number
): number {
  const baseLevel = graphics.levels[0];
  if (!baseLevel || !Number.isFinite(projectedWidth) || projectedWidth <= 0) {
    return MIN_PIXELS;
  }

  const safeDpr = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  const aspectRatio = baseLevel.height / Math.max(baseLevel.width, 1);
  const projectedHeight = Math.max(1, projectedWidth * aspectRatio);
  const pixelCount = projectedWidth * projectedHeight * safeDpr * safeDpr;
  return clampPositiveInt(pixelCount);
}
