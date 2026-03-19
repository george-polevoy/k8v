import { useEffect, type MutableRefObject } from 'react';
import type { Application } from 'pixi.js';
import type { Graph } from '../types';
import type {
  ScreenshotBitmap,
  ScreenshotRegion,
} from './useCanvasViewport';

export interface CanvasRenderBridge {
  isCanvasReady: () => boolean;
  isGraphReady: () => boolean;
  setViewportRegion: (region: ScreenshotRegion, bitmap: ScreenshotBitmap) => boolean;
}

interface UseCanvasRenderBridgeParams {
  enabled: boolean;
  appRef: MutableRefObject<Application | null>;
  graphRef: MutableRefObject<Graph | null>;
  setViewportRegionForScreenshot: (region: ScreenshotRegion, bitmap: ScreenshotBitmap) => boolean;
  onBridgeChange?: (bridge: CanvasRenderBridge | null) => void;
}

export function useCanvasRenderBridge(params: UseCanvasRenderBridgeParams): void {
  const {
    enabled,
    appRef,
    graphRef,
    setViewportRegionForScreenshot,
    onBridgeChange,
  } = params;

  useEffect(() => {
    if (!enabled) {
      onBridgeChange?.(null);
      return;
    }

    const bridge: CanvasRenderBridge = {
      isCanvasReady: () => Boolean(appRef.current),
      isGraphReady: () => Boolean(graphRef.current),
      setViewportRegion: (region, bitmap) => setViewportRegionForScreenshot(region, bitmap),
    };
    onBridgeChange?.(bridge);

    return () => {
      onBridgeChange?.(null);
    };
  }, [appRef, enabled, graphRef, onBridgeChange, setViewportRegionForScreenshot]);
}
