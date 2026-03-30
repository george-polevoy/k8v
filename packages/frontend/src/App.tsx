import { useEffect } from 'react';
import Canvas from './components/Canvas';
import RightSidebar from './components/RightSidebar';
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
        height: '100vh',
        width: '100vw',
        overflow: 'hidden',
        display: 'flex',
      }}
    >
      <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
        <Canvas />
      </div>
      <RightSidebar />
    </div>
  );
}

export default App;
