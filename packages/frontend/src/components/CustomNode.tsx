import React from 'react';
import { Handle, Position } from 'reactflow';
import { GraphNode } from '../types';

interface CustomNodeProps {
  data: {
    node: GraphNode;
  };
}

function CustomNode({ data }: CustomNodeProps) {
  const { node } = data;

  return (
    <div
      style={{
        background: '#fff',
        border: '2px solid #333',
        borderRadius: '8px',
        padding: '12px',
        minWidth: '200px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
      }}
    >
      <div style={{ fontWeight: 'bold', marginBottom: '8px', borderBottom: '1px solid #eee', paddingBottom: '4px' }}>
        {node.metadata.name}
      </div>
      <div style={{ fontSize: '12px', color: '#666', marginBottom: '8px' }}>
        {node.metadata.description}
      </div>

      {/* Input handles */}
      <div style={{ marginTop: '8px' }}>
        {node.metadata.inputs.map((input) => (
          <div key={input.name} style={{ marginBottom: '4px', fontSize: '11px' }}>
            <Handle
              type="target"
              position={Position.Left}
              id={input.name}
              style={{ top: 'auto', bottom: 'auto' }}
            />
            <span style={{ marginLeft: '8px' }}>{input.name}</span>
          </div>
        ))}
      </div>

      {/* Output handles */}
      <div style={{ marginTop: '8px' }}>
        {node.metadata.outputs.map((output) => (
          <div key={output.name} style={{ marginBottom: '4px', fontSize: '11px', textAlign: 'right' }}>
            <span style={{ marginRight: '8px' }}>{output.name}</span>
            <Handle
              type="source"
              position={Position.Right}
              id={output.name}
              style={{ top: 'auto', bottom: 'auto' }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

export default CustomNode;
