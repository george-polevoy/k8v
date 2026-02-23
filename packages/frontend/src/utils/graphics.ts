import { GraphicsArtifact } from '../types';

const MIN_PIXELS = 1;

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
