import React from 'react';
import { useGraphStore } from '../store/graphStore';
import { GraphNode, NodeType } from '../types';
import { v4 as uuidv4 } from 'uuid';

function NodePanel() {
  const { selectedNodeId, graph, updateNode, addNode } = useGraphStore();
  const selectedNode = graph?.nodes.find((n) => n.id === selectedNodeId);

  const handleAddInlineCodeNode = () => {
    if (!graph) return;

    const newNode: GraphNode = {
      id: uuidv4(),
      type: NodeType.INLINE_CODE,
      position: { x: Math.random() * 400, y: Math.random() * 400 },
      metadata: {
        name: 'Inline Code',
        inputs: [{ name: 'input', schema: { type: 'object' } }],
        outputs: [{ name: 'output', schema: { type: 'object' } }],
      },
      config: {
        type: NodeType.INLINE_CODE,
        code: 'outputs.result = inputs.input;',
      },
      version: Date.now().toString(),
    };

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
                value={selectedNode.config.code || ''}
                onChange={(e) =>
                  updateNode(selectedNode.id, {
                    config: { ...selectedNode.config, code: e.target.value },
                  })
                }
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
