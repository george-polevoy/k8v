import { Application, Container, Texture } from 'pixi.js';
import type { ConnectionAnchorSide, Position } from '../types';
import { clamp } from '../utils/canvasHelpers';
import type { ConnectionGeometry } from '../utils/canvasEffects';
import type { WorldBounds } from '../utils/canvasNodeRender';
import type { ResizeHandleDirection } from './canvasTypes';

export interface ResizeHandleBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ResizeHandlePlacement {
  x: number;
  y: number;
  handle: ResizeHandleDirection;
}

export function resolveResizeCursor(handle: ResizeHandleDirection): string {
  if (handle === 'n' || handle === 's') {
    return 'ns-resize';
  }
  if (handle === 'e' || handle === 'w') {
    return 'ew-resize';
  }
  if (handle === 'ne' || handle === 'sw') {
    return 'nesw-resize';
  }
  return 'nwse-resize';
}

export function resolveResizeHandlePlacements(
  bounds: ResizeHandleBounds,
  handleSize: number
): ResizeHandlePlacement[] {
  const handleOffset = handleSize * 0.5;
  return [
    { x: bounds.x - handleOffset, y: bounds.y - handleOffset, handle: 'nw' },
    { x: bounds.x + (bounds.width * 0.5) - handleOffset, y: bounds.y - handleOffset, handle: 'n' },
    { x: bounds.x + bounds.width - handleOffset, y: bounds.y - handleOffset, handle: 'ne' },
    { x: bounds.x + bounds.width - handleOffset, y: bounds.y + (bounds.height * 0.5) - handleOffset, handle: 'e' },
    { x: bounds.x + bounds.width - handleOffset, y: bounds.y + bounds.height - handleOffset, handle: 'se' },
    { x: bounds.x + (bounds.width * 0.5) - handleOffset, y: bounds.y + bounds.height - handleOffset, handle: 's' },
    { x: bounds.x - handleOffset, y: bounds.y + bounds.height - handleOffset, handle: 'sw' },
    { x: bounds.x - handleOffset, y: bounds.y + (bounds.height * 0.5) - handleOffset, handle: 'w' },
  ];
}

export function getTextureDimensions(texture: Texture): { width: number; height: number; valid: boolean } {
  const width = texture.orig.width || texture.width || 0;
  const height = texture.orig.height || texture.height || 0;
  const valid = texture.baseTexture.valid && width > 0 && height > 0;
  return { width, height, valid };
}

export function getViewportWorldBounds(app: Application, viewport: Container): WorldBounds {
  const scaleX = Math.max(Math.abs(viewport.scale.x || 1), 0.0001);
  const scaleY = Math.max(Math.abs(viewport.scale.y || 1), 0.0001);
  const minX = -viewport.position.x / scaleX;
  const minY = -viewport.position.y / scaleY;
  return {
    minX,
    minY,
    maxX: minX + app.screen.width / scaleX,
    maxY: minY + app.screen.height / scaleY,
  };
}

export function getBezierGeometry(
  id: string,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  startSide: ConnectionAnchorSide = 'right',
  endSide: ConnectionAnchorSide = 'left'
): ConnectionGeometry {
  const controlOffset = Math.max(Math.hypot(endX - startX, endY - startY) * 0.35, 60);
  const startControl = resolveBezierControlPoint(startX, startY, startSide, controlOffset);
  const endControl = resolveBezierControlPoint(endX, endY, endSide, controlOffset);
  return {
    id,
    startX,
    startY,
    c1X: startControl.x,
    c1Y: startControl.y,
    c2X: endControl.x,
    c2Y: endControl.y,
    endX,
    endY,
  };
}

function resolveBezierControlPoint(
  x: number,
  y: number,
  side: ConnectionAnchorSide,
  offset: number
): Position {
  switch (side) {
    case 'top':
      return { x, y: y - offset };
    case 'bottom':
      return { x, y: y + offset };
    case 'left':
      return { x: x - offset, y };
    case 'right':
    default:
      return { x: x + offset, y };
  }
}

function pointOnBezier(geometry: ConnectionGeometry, t: number): { x: number; y: number } {
  const oneMinus = 1 - t;
  const oneMinus2 = oneMinus * oneMinus;
  const oneMinus3 = oneMinus2 * oneMinus;
  const t2 = t * t;
  const t3 = t2 * t;

  return {
    x:
      oneMinus3 * geometry.startX +
      3 * oneMinus2 * t * geometry.c1X +
      3 * oneMinus * t2 * geometry.c2X +
      t3 * geometry.endX,
    y:
      oneMinus3 * geometry.startY +
      3 * oneMinus2 * t * geometry.c1Y +
      3 * oneMinus * t2 * geometry.c2Y +
      t3 * geometry.endY,
  };
}

function distanceSquaredToSegment(
  pointX: number,
  pointY: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSquared = (dx * dx) + (dy * dy);
  if (lengthSquared === 0) {
    const ox = pointX - x1;
    const oy = pointY - y1;
    return (ox * ox) + (oy * oy);
  }

  const t = clamp(((pointX - x1) * dx + (pointY - y1) * dy) / lengthSquared, 0, 1);
  const projX = x1 + t * dx;
  const projY = y1 + t * dy;
  const ox = pointX - projX;
  const oy = pointY - projY;
  return (ox * ox) + (oy * oy);
}

export function distanceSquaredToBezier(
  pointX: number,
  pointY: number,
  geometry: ConnectionGeometry
): number {
  const samples = 28;
  let best = Number.POSITIVE_INFINITY;
  let previous = pointOnBezier(geometry, 0);

  for (let index = 1; index <= samples; index += 1) {
    const current = pointOnBezier(geometry, index / samples);
    const distanceSquared = distanceSquaredToSegment(
      pointX,
      pointY,
      previous.x,
      previous.y,
      current.x,
      current.y
    );
    if (distanceSquared < best) {
      best = distanceSquared;
    }
    previous = current;
  }

  return best;
}
