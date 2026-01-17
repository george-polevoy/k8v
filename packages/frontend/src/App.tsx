import React, { useEffect } from 'react';
import Canvas from './components/Canvas';
import Toolbar from './components/Toolbar';
import NodePanel from './components/NodePanel';
import { useGraphStore } from './store/graphStore';

function App() {
  const initializeGraph = useGraphStore((state) => state.initializeGraph);

  useEffect(() => {
    // Load existing graph or create a new one
    initializeGraph();
  }, [initializeGraph]);

  return (
    <div style={{ display: 'flex', height: '100vh', width: '100vw' }}>
      <Toolbar />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <Canvas />
      </div>
      <NodePanel />
    </div>
  );
}

export default App;
