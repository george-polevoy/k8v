import type { Container } from 'pixi.js';
import type { AnnotationOverlayTransform } from './canvasTypes';

export interface CanvasDebugCounters {
  fullRenderCount?: number;
  viewportSyncCount?: number;
  viewportDeferredRenderCount?: number;
  projectedTextureRefreshDeferredCount?: number;
  projectedTextureRefreshImmediateCount?: number;
  effectFrameCount?: number;
  viewportX?: number;
  viewportY?: number;
  viewportScale?: number;
}

export function incrementCanvasDebugCounter(counter: keyof CanvasDebugCounters): void {
  if (typeof window === 'undefined') {
    return;
  }

  const debugCounters = (window as Window & {
    __k8vCanvasDebug?: CanvasDebugCounters;
  }).__k8vCanvasDebug;
  if (!debugCounters) {
    return;
  }

  debugCounters[counter] = (debugCounters[counter] ?? 0) + 1;
}

export function syncCanvasDebugViewport(viewport: Container | null): void {
  if (typeof window === 'undefined') {
    return;
  }

  const debugCounters = (window as Window & {
    __k8vCanvasDebug?: CanvasDebugCounters;
  }).__k8vCanvasDebug;
  if (!debugCounters) {
    return;
  }

  debugCounters.viewportX = viewport?.position.x ?? 0;
  debugCounters.viewportY = viewport?.position.y ?? 0;
  debugCounters.viewportScale = viewport?.scale.x ?? 1;
}

export function resolveAnnotationOverlayTransform(viewport: Container | null): AnnotationOverlayTransform {
  if (!viewport) {
    return { x: 0, y: 0, scale: 1 };
  }

  return {
    x: viewport.position.x,
    y: viewport.position.y,
    scale: Math.max(Math.abs(viewport.scale.x || 1), 0.0001),
  };
}

export function buildAnnotationOverlayTransformCss(transform: AnnotationOverlayTransform): string {
  return `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`;
}
