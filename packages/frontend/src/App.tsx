import { useEffect } from 'react';
import Canvas from './components/Canvas';
import Toolbar from './components/Toolbar';
import RightSidebar from './components/RightSidebar';
import FloatingWindow from './components/FloatingWindow';
import { useGraphStore } from './store/graphStore';

declare global {
  interface Window {
    __k8vGraphStore?: typeof useGraphStore;
  }
}

const importMetaWithEnv = import.meta as ImportMeta & {
  env?: {
    DEV?: boolean;
  };
};

const shouldExposeGraphStore =
  typeof window !== 'undefined' &&
  (typeof importMetaWithEnv.env?.DEV === 'boolean' ? importMetaWithEnv.env.DEV : true);

if (shouldExposeGraphStore) {
  window.__k8vGraphStore = useGraphStore;
}

function isCanvasOnlyMode(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  return new URLSearchParams(window.location.search).get('canvasOnly') === '1';
}

function App() {
  const initializeGraph = useGraphStore((state) => state.initializeGraph);
  const error = useGraphStore((state) => state.error);
  const canvasOnlyMode = isCanvasOnlyMode();

  useEffect(() => {
    // Load existing graph or create a new one
    initializeGraph().catch((err) => {
      console.error('Failed to initialize graph:', err);
    });
  }, [initializeGraph]);

  // Show error banner if there's an error
  useEffect(() => {
    if (error) {
      console.error('Graph store error:', error);
    }
  }, [error]);

  return (
    <div
      style={{
        position: 'relative',
        height: '100vh',
        width: '100vw',
        overflow: 'hidden',
      }}
    >
      <div style={{ position: 'absolute', inset: 0, zIndex: 1 }}>
        <Canvas enableMcpScreenshotBridge={canvasOnlyMode} />
      </div>
      {!canvasOnlyMode && (
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 30 }}>
          <FloatingWindow
            id="toolbar"
            title="Tools"
            initialPosition={{ x: 12, y: 12 }}
            width={92}
            height={430}
            zIndex={31}
          >
            <Toolbar embedded />
          </FloatingWindow>
          <FloatingWindow
            id="right-sidebar"
            title="Panels"
            initialPosition={{ x: 1020, y: 12 }}
            width={420}
            height={820}
            zIndex={32}
          >
            <RightSidebar />
          </FloatingWindow>
        </div>
      )}
    </div>
  );
}

export default App;
