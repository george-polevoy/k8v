import type { Position } from '../types';
import { clamp, snapToPixel } from './canvasHelpers';
import type { WorldBounds } from './canvasNodeRender';

export interface ViewportFitNodeBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  projectedGraphicsHeight: number;
}

export interface ViewportFitDrawingPath {
  points: Position[];
}

export interface ViewportFitDrawingBounds {
  position: Position;
  paths: ViewportFitDrawingPath[];
}

export interface ResolveViewportFitTransformInput {
  bounds: WorldBounds;
  screenWidth: number;
  screenHeight: number;
  margin: number;
  minZoom: number;
  maxZoom: number;
}

export interface ViewportFitTransform {
  scale: number;
  x: number;
  y: number;
}

export function resolveGraphWorldBounds(
  nodes: ViewportFitNodeBounds[],
  drawings: ViewportFitDrawingBounds[]
): WorldBounds | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const node of nodes) {
    minX = Math.min(minX, node.x);
    minY = Math.min(minY, node.y);
    maxX = Math.max(maxX, node.x + node.width);
    maxY = Math.max(maxY, node.y + node.height + node.projectedGraphicsHeight);
  }

  for (const drawing of drawings) {
    const position = drawing.position;
    minX = Math.min(minX, position.x);
    minY = Math.min(minY, position.y);
    maxX = Math.max(maxX, position.x + 160);
    maxY = Math.max(maxY, position.y + 30);

    for (const path of drawing.paths) {
      for (const point of path.points) {
        const worldX = position.x + point.x;
        const worldY = position.y + point.y;
        minX = Math.min(minX, worldX);
        minY = Math.min(minY, worldY);
        maxX = Math.max(maxX, worldX);
        maxY = Math.max(maxY, worldY);
      }
    }
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
    return null;
  }

  return { minX, minY, maxX, maxY };
}

export function resolveViewportFitTransform({
  bounds,
  screenWidth,
  screenHeight,
  margin,
  minZoom,
  maxZoom,
}: ResolveViewportFitTransformInput): ViewportFitTransform {
  const graphWidth = Math.max(bounds.maxX - bounds.minX, 1);
  const graphHeight = Math.max(bounds.maxY - bounds.minY, 1);
  const fitScaleX = (screenWidth - margin * 2) / graphWidth;
  const fitScaleY = (screenHeight - margin * 2) / graphHeight;
  const scale = clamp(Math.min(fitScaleX, fitScaleY, 1), minZoom, maxZoom);
  const x = snapToPixel(screenWidth / 2 - ((bounds.minX + bounds.maxX) / 2) * scale);
  const y = snapToPixel(screenHeight / 2 - ((bounds.minY + bounds.maxY) / 2) * scale);
  return { scale, x, y };
}
