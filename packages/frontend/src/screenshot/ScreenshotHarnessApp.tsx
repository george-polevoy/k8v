import { useEffect, useMemo, useState } from 'react';
import Canvas from '../components/Canvas';
import type { CanvasRenderBridge } from '../components/useCanvasRenderBridge';
import { useGraphStore } from '../store/graphStore';
import type {
  Graph,
  GraphRuntimeState,
} from '../types';
import type {
  ScreenshotBitmap,
  ScreenshotRegion,
} from '../components/useCanvasViewport';

export interface ScreenshotHarnessBootstrap {
  graph: Graph;
  runtimeState?: GraphRuntimeState | null;
  backendUrl?: string;
  selectedCameraId?: string | null;
}

interface ScreenshotHarnessController {
  isCanvasReady: () => boolean;
  isGraphReady: () => boolean;
  setViewportRegion: (region: ScreenshotRegion, bitmap: ScreenshotBitmap) => boolean;
}

declare global {
  interface Window {
    __k8vScreenshotHarnessBootstrap?: ScreenshotHarnessBootstrap;
    __k8vScreenshotHarness?: ScreenshotHarnessController;
  }
}

function sanitizeBaseUrl(url?: string): string | undefined {
  if (!url) {
    return undefined;
  }
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

function ScreenshotHarnessError({ message }: { message: string }) {
  return (
    <div
      style={{
        alignItems: 'center',
        background: '#f8fafc',
        color: '#0f172a',
        display: 'flex',
        fontFamily: 'Arial, sans-serif',
        height: '100vh',
        justifyContent: 'center',
        padding: 24,
        width: '100vw',
      }}
    >
      <div
        style={{
          background: '#ffffff',
          border: '1px solid #dc2626',
          borderRadius: 12,
          boxShadow: '0 12px 32px rgba(15, 23, 42, 0.12)',
          maxWidth: 520,
          padding: 24,
          width: '100%',
        }}
      >
        <h1 style={{ color: '#991b1b', fontSize: 24, margin: '0 0 12px' }}>
          Screenshot Harness Error
        </h1>
        <p style={{ lineHeight: 1.6, margin: 0 }}>
          {message}
        </p>
      </div>
    </div>
  );
}

export default function ScreenshotHarnessApp() {
  const loadGraphSnapshotForRender = useGraphStore((state) => state.loadGraphSnapshotForRender);
  const [renderBridge, setRenderBridge] = useState<CanvasRenderBridge | null>(null);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [graphicsBaseUrl, setGraphicsBaseUrl] = useState<string | undefined>(undefined);

  useEffect(() => {
    const bootstrap = window.__k8vScreenshotHarnessBootstrap;
    if (!bootstrap?.graph) {
      setBootstrapError('Missing screenshot bootstrap payload.');
      return;
    }

    setGraphicsBaseUrl(sanitizeBaseUrl(bootstrap.backendUrl));
    loadGraphSnapshotForRender({
      graph: bootstrap.graph,
      runtimeState: bootstrap.runtimeState ?? null,
      selectedCameraId: bootstrap.selectedCameraId ?? null,
    });
    setBootstrapError(null);
  }, [loadGraphSnapshotForRender]);

  const controller = useMemo<ScreenshotHarnessController>(() => ({
    isCanvasReady: () => renderBridge?.isCanvasReady() ?? false,
    isGraphReady: () => renderBridge?.isGraphReady() ?? false,
    setViewportRegion: (region, bitmap) => renderBridge?.setViewportRegion(region, bitmap) ?? false,
  }), [renderBridge]);

  useEffect(() => {
    window.__k8vScreenshotHarness = controller;
    return () => {
      if (window.__k8vScreenshotHarness === controller) {
        delete window.__k8vScreenshotHarness;
      }
    };
  }, [controller]);

  if (bootstrapError) {
    return <ScreenshotHarnessError message={bootstrapError} />;
  }

  return (
    <div
      style={{
        height: '100vh',
        overflow: 'hidden',
        width: '100vw',
      }}
    >
      <Canvas
        graphicsBaseUrl={graphicsBaseUrl}
        onRenderBridgeChange={setRenderBridge}
        persistViewportState={false}
      />
    </div>
  );
}
