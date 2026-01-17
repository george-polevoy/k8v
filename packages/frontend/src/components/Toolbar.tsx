import React, { useState } from 'react';
import { useGraphStore } from '../store/graphStore';
import NodeCreationDialog from './NodeCreationDialog';

function Toolbar() {
  const { computeGraph, addNode } = useGraphStore();
  const [showDialog, setShowDialog] = useState(false);
  const [dialogPosition, setDialogPosition] = useState({ x: 400, y: 300 });

  const handleAddNode = () => {
    setDialogPosition({ x: 400, y: 300 });
    setShowDialog(true);
  };

  const handleAddNodeWithPosition = (node: any) => {
    addNode(node);
    setShowDialog(false);
  };

  return (
    <>
      <div
        style={{
          width: '60px',
          background: '#f5f5f5',
          borderRight: '1px solid #ddd',
          display: 'flex',
          flexDirection: 'column',
          padding: '8px',
          gap: '8px',
        }}
      >
        <button
          onClick={() => computeGraph()}
          style={{
            padding: '8px',
            background: '#4CAF50',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
          }}
          title="Compute Graph"
        >
          ▶
        </button>
        <button
          onClick={handleAddNode}
          style={{
            padding: '8px',
            background: '#2196F3',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
          }}
          title="Add Node"
        >
          +
        </button>
      </div>
      {showDialog && (
        <NodeCreationDialog
          onClose={() => setShowDialog(false)}
          onAdd={handleAddNodeWithPosition}
          position={dialogPosition}
        />
      )}
    </>
  );
}

export default Toolbar;
