import { useState } from 'react';
import { GraphNode, NodeType } from '../types';
import { 
  createInlineCodeNode, 
  createLibraryNode, 
  createExternalInputNode, 
  createExternalOutputNode 
} from '../utils/nodeFactory';

interface NodeCreationDialogProps {
  onClose: () => void;
  onAdd: (node: GraphNode) => void;
  position: { x: number; y: number };
}

function NodeCreationDialog({ onClose, onAdd, position }: NodeCreationDialogProps) {
  const [nodeType, setNodeType] = useState<NodeType>(NodeType.INLINE_CODE);
  const [name, setName] = useState('');
  const [code, setCode] = useState('outputs.output = inputs.input;');

  const handleCreate = () => {
    let newNode: GraphNode;

    switch (nodeType) {
      case NodeType.INLINE_CODE:
        newNode = createInlineCodeNode({ 
          position, 
          name: name || undefined,
          code: code || undefined 
        });
        break;
      case NodeType.LIBRARY:
        newNode = createLibraryNode({ 
          position, 
          name: name || undefined,
          libraryId: '' 
        });
        break;
      case NodeType.EXTERNAL_INPUT:
        newNode = createExternalInputNode({ 
          position, 
          name: name || undefined 
        });
        break;
      case NodeType.EXTERNAL_OUTPUT:
        newNode = createExternalOutputNode({ 
          position, 
          name: name || undefined 
        });
        break;
      default:
        newNode = createInlineCodeNode({ position, name: name || undefined });
    }

    onAdd(newNode);
    onClose();
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        background: 'white',
        padding: '24px',
        borderRadius: '8px',
        boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
        zIndex: 1000,
        minWidth: '400px',
      }}
    >
      <h2 style={{ marginBottom: '16px' }}>Create New Node</h2>

      <div style={{ marginBottom: '16px' }}>
        <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>
          Node Type:
        </label>
        <select
          value={nodeType}
          onChange={(e) => setNodeType(e.target.value as NodeType)}
          style={{
            width: '100%',
            padding: '8px',
            border: '1px solid #ddd',
            borderRadius: '4px',
          }}
        >
          <option value={NodeType.INLINE_CODE}>Inline Code</option>
          <option value={NodeType.LIBRARY}>Library Node</option>
          <option value={NodeType.EXTERNAL_INPUT}>External Input</option>
          <option value={NodeType.EXTERNAL_OUTPUT}>External Output</option>
        </select>
      </div>

      <div style={{ marginBottom: '16px' }}>
        <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>
          Name (optional):
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Leave empty for default name"
          style={{
            width: '100%',
            padding: '8px',
            border: '1px solid #ddd',
            borderRadius: '4px',
          }}
        />
      </div>

      {nodeType === NodeType.INLINE_CODE && (
        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>
            Code:
          </label>
          <textarea
            value={code}
            onChange={(e) => setCode(e.target.value)}
            style={{
              width: '100%',
              minHeight: '150px',
              fontFamily: 'monospace',
              fontSize: '12px',
              padding: '8px',
              border: '1px solid #ddd',
              borderRadius: '4px',
            }}
          />
        </div>
      )}

      <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
        <button
          onClick={onClose}
          style={{
            padding: '8px 16px',
            background: '#f5f5f5',
            border: '1px solid #ddd',
            borderRadius: '4px',
            cursor: 'pointer',
          }}
        >
          Cancel
        </button>
        <button
          onClick={handleCreate}
          style={{
            padding: '8px 16px',
            background: '#2196F3',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
          }}
        >
          Create
        </button>
      </div>
    </div>
  );
}

export default NodeCreationDialog;
