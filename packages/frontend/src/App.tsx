import { useEffect } from 'react';
import Canvas from './components/Canvas';
import Toolbar from './components/Toolbar';
import RightSidebar from './components/RightSidebar';
import FloatingWindow from './components/FloatingWindow';
import { useGraphStore } from './store/graphStore';

function App() {
  const initializeGraph = useGraphStore((state) => state.initializeGraph);
  const error = useGraphStore((state) => state.error);

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
        <Canvas />
      </div>
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
    </div>
  );
}

export default App;
