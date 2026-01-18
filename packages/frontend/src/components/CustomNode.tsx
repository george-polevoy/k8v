import { useState, useEffect } from 'react';
import { Handle, Position } from 'reactflow';
import { GraphNode, NodeType } from '../types';
import { useGraphStore } from '../store/graphStore';
import axios from 'axios';

interface CustomNodeProps {
  data: {
    node: GraphNode;
  };
}

function CustomNode({ data }: CustomNodeProps) {
  const { node } = data;
  const isInlineCode = node.type === NodeType.INLINE_CODE;
  const { graph } = useGraphStore();

  // State for inline result display
  const [textOutput, setTextOutput] = useState<string | null>(null);
  const [outputs, setOutputs] = useState<Record<string, any> | null>(null);
  const [isLoadingResult, setIsLoadingResult] = useState(false);

  // Fetch computation result when graph updates
  useEffect(() => {
    const fetchResult = async () => {
      setIsLoadingResult(true);
      try {
        const response = await axios.get(`/api/nodes/${node.id}/result`);
        if (response.data) {
          setTextOutput(response.data.textOutput || null);
          setOutputs(response.data.outputs || null);
        } else {
          setTextOutput(null);
          setOutputs(null);
        }
      } catch (error: any) {
        // No result yet or error - silently ignore
        setTextOutput(null);
        setOutputs(null);
      } finally {
        setIsLoadingResult(false);
      }
    };

    // Fetch initially and when graph updates
    fetchResult();
  }, [node.id, graph?.updatedAt]);

  const handleDeleteInput = (inputName: string) => {
    if (!isInlineCode || !graph) return;

    const updatedInputs = node.metadata.inputs.filter(input => input.name !== inputName);

    // Also remove any connections to this input
    const updatedConnections = graph.connections.filter(
      conn => !(conn.targetNodeId === node.id && conn.targetPort === inputName)
    );

    const updatedGraph = {
      ...graph,
      nodes: graph.nodes.map(n =>
        n.id === node.id
          ? { ...n, metadata: { ...n.metadata, inputs: updatedInputs }, version: Date.now().toString() }
          : n
      ),
      connections: updatedConnections,
      updatedAt: Date.now(),
    };

    useGraphStore.getState().updateGraph(updatedGraph);
  };

  const handleMoveInput = (index: number, direction: 'up' | 'down') => {
    if (!isInlineCode) return;

    const inputs = [...node.metadata.inputs];
    const newIndex = direction === 'up' ? index - 1 : index + 1;

    if (newIndex < 0 || newIndex >= inputs.length) return;

    // Swap items
    [inputs[index], inputs[newIndex]] = [inputs[newIndex], inputs[index]];

    useGraphStore.getState().updateNode(node.id, {
      metadata: { ...node.metadata, inputs },
    });
  };

  // Format text output for display (truncate if too long)
  const formatTextOutput = (text: string | null): string => {
    if (!text) return '';
    const lines = text.split('\n');
    const maxLines = 3;
    const maxCharsPerLine = 30;
    
    const truncatedLines = lines.slice(0, maxLines).map(line => 
      line.length > maxCharsPerLine ? line.substring(0, maxCharsPerLine) + '...' : line
    );
    
    if (lines.length > maxLines) {
      return truncatedLines.join('\n') + '\n...';
    }
    return truncatedLines.join('\n');
  };

  // Format output value for display
  const formatOutputValue = (value: any): string => {
    if (value === undefined || value === null) return 'null';
    if (typeof value === 'string') {
      return value.length > 25 ? value.substring(0, 25) + '...' : value;
    }
    if (typeof value === 'object') {
      const str = JSON.stringify(value);
      return str.length > 30 ? str.substring(0, 30) + '...' : str;
    }
    return String(value);
  };

  // Check if we have any result to display
  const hasResult = outputs !== null || textOutput !== null;

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
        {node.metadata.inputs.map((input, index) => (
          <div
            key={input.name}
            style={{
              marginBottom: '4px',
              fontSize: '11px',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            <Handle
              type="target"
              position={Position.Left}
              id={input.name}
              style={{ top: 'auto', bottom: 'auto' }}
            />
            <span style={{ marginLeft: '8px', flex: 1 }}>{input.name}</span>

            {/* Show controls only for inline code nodes */}
            {isInlineCode && (
              <div style={{ display: 'flex', gap: '2px' }}>
                <button
                  onClick={() => handleMoveInput(index, 'up')}
                  disabled={index === 0}
                  style={{
                    padding: '2px 4px',
                    fontSize: '10px',
                    border: '1px solid #ddd',
                    background: index === 0 ? '#f5f5f5' : '#fff',
                    cursor: index === 0 ? 'not-allowed' : 'pointer',
                    borderRadius: '2px',
                  }}
                  title="Move up"
                >
                  ↑
                </button>
                <button
                  onClick={() => handleMoveInput(index, 'down')}
                  disabled={index === node.metadata.inputs.length - 1}
                  style={{
                    padding: '2px 4px',
                    fontSize: '10px',
                    border: '1px solid #ddd',
                    background: index === node.metadata.inputs.length - 1 ? '#f5f5f5' : '#fff',
                    cursor: index === node.metadata.inputs.length - 1 ? 'not-allowed' : 'pointer',
                    borderRadius: '2px',
                  }}
                  title="Move down"
                >
                  ↓
                </button>
                <button
                  onClick={() => handleDeleteInput(input.name)}
                  style={{
                    padding: '2px 4px',
                    fontSize: '10px',
                    border: '1px solid #ddd',
                    background: '#fff',
                    color: '#d32f2f',
                    cursor: 'pointer',
                    borderRadius: '2px',
                  }}
                  title="Delete input"
                >
                  ×
                </button>
              </div>
            )}
          </div>
        ))}

        {/* Add input target for inline code nodes */}
        {isInlineCode && (
          <div style={{ marginBottom: '4px', fontSize: '11px', color: '#2196F3', fontStyle: 'italic' }}>
            <Handle
              type="target"
              position={Position.Left}
              id="__add_input__"
              style={{
                top: 'auto',
                bottom: 'auto',
                background: '#2196F3',
                border: '2px dashed #2196F3',
              }}
            />
            <span style={{ marginLeft: '8px' }}>+ add input</span>
          </div>
        )}
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

      {/* Inline Result Display */}
      {(hasResult || isLoadingResult) && (
        <div
          style={{
            marginTop: '8px',
            padding: '6px',
            background: '#1e1e1e',
            borderRadius: '4px',
            fontSize: '10px',
            fontFamily: 'monospace',
            color: '#d4d4d4',
            maxHeight: '80px',
            overflow: 'hidden',
          }}
        >
          {isLoadingResult ? (
            <span style={{ color: '#888', fontStyle: 'italic' }}>Loading...</span>
          ) : (
            <>
              {/* Output port values */}
              {outputs && Object.keys(outputs).length > 0 && (
                <div style={{ marginBottom: textOutput ? '4px' : '0' }}>
                  {Object.entries(outputs).map(([key, value]) => (
                    <div key={key} style={{ display: 'flex', gap: '4px' }}>
                      <span style={{ color: '#9cdcfe' }}>{key}:</span>
                      <span style={{ color: '#ce9178' }}>{formatOutputValue(value)}</span>
                    </div>
                  ))}
                </div>
              )}
              {/* Text output (stdout/stderr) */}
              {textOutput && (
                <div
                  style={{
                    borderTop: outputs && Object.keys(outputs).length > 0 ? '1px solid #444' : 'none',
                    paddingTop: outputs && Object.keys(outputs).length > 0 ? '4px' : '0',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    color: '#dcdcaa',
                  }}
                >
                  {formatTextOutput(textOutput)}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default CustomNode;
