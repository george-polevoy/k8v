import { useEffect } from 'react';
import Canvas from './components/Canvas';
import Toolbar from './components/Toolbar';
import RightSidebar from './components/RightSidebar';
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
    <div style={{ display: 'flex', height: '100vh', width: '100vw' }}>
      <Toolbar />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <Canvas />
      </div>
      <RightSidebar />
    </div>
  );
}

export default App;
