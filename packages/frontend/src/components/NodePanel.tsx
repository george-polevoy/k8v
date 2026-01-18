import { useState, useEffect, useCallback, useRef } from 'react';
import { useGraphStore } from '../store/graphStore';
import { NodeType } from '../types';
import { createInlineCodeNode } from '../utils/nodeFactory';

function NodePanel() {
  const { selectedNodeId, graph, updateNode, addNode } = useGraphStore();
  const selectedNode = graph?.nodes.find((n) => n.id === selectedNodeId);

  // Local state for code editing to prevent cursor jumping
  const [codeValue, setCodeValue] = useState('');
  const updateTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Sync local state with selected node
  useEffect(() => {   
    if (selectedNode?.config.code !== undefined) {
      setCodeValue(selectedNode.config.code);
    }
  }, [selectedNode?.id, selectedNode?.config.code]);

  // Debounced update function
  const debouncedUpdate = useCallback((nodeId: string, config: any, newValue: string) => {
    if (updateTimerRef.current) {
      clearTimeout(updateTimerRef.current);
    }

    updateTimerRef.current = setTimeout(() => {
      updateNode(nodeId, { config: { ...config, code: newValue } });
    }, 300); // 300ms debounce delay
  }, [updateNode]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (updateTimerRef.current) {
        clearTimeout(updateTimerRef.current);
      }
    };
  }, []);

  const handleAddInlineCodeNode = () => {
    if (!graph) return;

    // Calculate non-overlapping position for new node
    const gridSize = 50;
    const nodeWidth = 200;
    const nodeHeight = 150;
    let newPosition = { x: 100, y: 100 };

    // Find a non-overlapping position
    let attempts = 0;
    const maxAttempts = 100;

    while (attempts < maxAttempts) {
      const overlapping = graph.nodes.some(node => {
        const xOverlap = Math.abs(node.position.x - newPosition.x) < nodeWidth;
        const yOverlap = Math.abs(node.position.y - newPosition.y) < nodeHeight;
        return xOverlap && yOverlap;
      });

      if (!overlapping) {
        break;
      }

      // Try next position in a spiral pattern
      const angle = (attempts * 137.5) * (Math.PI / 180); // Golden angle for good distribution
      const radius = gridSize + (attempts * 20);
      newPosition = {
        x: 300 + Math.cos(angle) * radius,
        y: 300 + Math.sin(angle) * radius,
      };

      attempts++;
    }

    const newNode = createInlineCodeNode({ position: newPosition });
    addNode(newNode);
  };

  return (
    <div
      style={{
        width: '300px',
        background: '#f9f9f9',
        borderLeft: '1px solid #ddd',
        padding: '16px',
        overflowY: 'auto',
      }}
    >
      <h3 style={{ marginBottom: '16px' }}>Node Panel</h3>

      {selectedNode ? (
        <div>
          <h4>{selectedNode.metadata.name}</h4>
          <p style={{ fontSize: '12px', color: '#666', marginBottom: '16px' }}>
            {selectedNode.metadata.description}
          </p>

          {selectedNode.config.type === NodeType.INLINE_CODE && (
            <div>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>
                Code:
              </label>
              <textarea
                value={codeValue}
                onChange={(e) => {
                  const newValue = e.target.value;
                  setCodeValue(newValue);
                  debouncedUpdate(selectedNode.id, selectedNode.config, newValue);
                }}
                style={{
                  width: '100%',
                  minHeight: '200px',
                  fontFamily: 'monospace',
                  fontSize: '12px',
                  padding: '8px',
                  border: '1px solid #ddd',
                  borderRadius: '4px',
                }}
              />
            </div>
          )}
        </div>
      ) : (
        <div>
          <p style={{ color: '#666', marginBottom: '16px' }}>Select a node to edit</p>
          <button
            onClick={handleAddInlineCodeNode}
            style={{
              width: '100%',
              padding: '12px',
              background: '#2196F3',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              marginBottom: '8px',
            }}
          >
            Add Inline Code Node
          </button>
        </div>
      )}
    </div>
  );
}

export default NodePanel;
