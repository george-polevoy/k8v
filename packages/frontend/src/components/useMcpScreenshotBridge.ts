import { useEffect, type MutableRefObject } from 'react';
import type { Application } from 'pixi.js';
import type { Graph } from '../types';
import type {
  ScreenshotBitmap,
  ScreenshotRegion,
} from './useCanvasViewport';

export interface McpScreenshotBridge {
  isCanvasReady: () => boolean;
  isGraphReady: () => boolean;
  setViewportRegion: (region: ScreenshotRegion, bitmap: ScreenshotBitmap) => boolean;
}

declare global {
  interface Window {
    __k8vMcpScreenshotBridge?: McpScreenshotBridge;
  }
}

interface UseMcpScreenshotBridgeParams {
  enabled: boolean;
  appRef: MutableRefObject<Application | null>;
  graphRef: MutableRefObject<Graph | null>;
  setViewportRegionForScreenshot: (region: ScreenshotRegion, bitmap: ScreenshotBitmap) => boolean;
}

export function useMcpScreenshotBridge(params: UseMcpScreenshotBridgeParams): void {
  const {
    enabled,
    appRef,
    graphRef,
    setViewportRegionForScreenshot,
  } = params;

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') {
      return;
    }

    const bridge: McpScreenshotBridge = {
      isCanvasReady: () => Boolean(appRef.current),
      isGraphReady: () => Boolean(graphRef.current),
      setViewportRegion: (region, bitmap) => setViewportRegionForScreenshot(region, bitmap),
    };
    window.__k8vMcpScreenshotBridge = bridge;

    return () => {
      if (window.__k8vMcpScreenshotBridge === bridge) {
        delete window.__k8vMcpScreenshotBridge;
      }
    };
  }, [appRef, enabled, graphRef, setViewportRegionForScreenshot]);
}
