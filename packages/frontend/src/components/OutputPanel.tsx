import React, { useState, useEffect } from 'react';
import { useGraphStore } from '../store/graphStore';
import axios from 'axios';

function OutputPanel() {
  const { selectedNodeId, graph } = useGraphStore();
  const [textOutput, setTextOutput] = useState<string>('');
  const [graphicsOutput, setGraphicsOutput] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [textExpanded, setTextExpanded] = useState(true);
  const [graphicsExpanded, setGraphicsExpanded] = useState(true);

  useEffect(() => {
    const fetchResult = async () => {
      if (!selectedNodeId) {
        setTextOutput('');
        setGraphicsOutput(null);
        return;
      }

      setIsLoading(true);
      try {
        const response = await axios.get(`/api/nodes/${selectedNodeId}/result`);
        if (response.data) {
          setTextOutput(response.data.textOutput || '');
          setGraphicsOutput(response.data.graphicsOutput || null);
        } else {
          setTextOutput('');
          setGraphicsOutput(null);
        }
      } catch (error: any) {
        if (error.response?.status === 404) {
          // No result yet
          setTextOutput('No output yet. Run the graph to see results.');
          setGraphicsOutput(null);
        } else {
          setTextOutput(`Error loading result: ${error.message}`);
          setGraphicsOutput(null);
        }
      } finally {
        setIsLoading(false);
      }
    };

    fetchResult();
  }, [selectedNodeId]);

  // Also refresh when graph is computed
  useEffect(() => {
    if (selectedNodeId) {
      const fetchResult = async () => {
        try {
          const response = await axios.get(`/api/nodes/${selectedNodeId}/result`);
          if (response.data) {
            setTextOutput(response.data.textOutput || '');
            setGraphicsOutput(response.data.graphicsOutput || null);
          }
        } catch (error) {
          // Ignore errors, might not have result yet
        }
      };
      // Small delay to allow backend to save result
      const timeout = setTimeout(fetchResult, 500);
      return () => clearTimeout(timeout);
    }
  }, [graph?.updatedAt, selectedNodeId]);

  if (!selectedNodeId) {
    return (
      <div
        style={{
          width: '400px',
          background: '#f9f9f9',
          borderLeft: '1px solid #ddd',
          padding: '16px',
          display: 'flex',
          flexDirection: 'column',
          height: '100vh',
        }}
      >
        <h3 style={{ marginBottom: '16px' }}>Output</h3>
        <p style={{ color: '#666', fontSize: '14px' }}>Select a node to view its output</p>
      </div>
    );
  }

  const selectedNode = graph?.nodes.find((n) => n.id === selectedNodeId);

  return (
    <div
      style={{
        width: '400px',
        background: '#f9f9f9',
        borderLeft: '1px solid #ddd',
        padding: '16px',
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        overflowY: 'auto',
      }}
    >
      <h3 style={{ marginBottom: '16px' }}>
        Output: {selectedNode?.metadata.name || 'Unknown Node'}
      </h3>

      {/* Text Output Section */}
      <div
        style={{
          marginBottom: '16px',
          border: '1px solid #ddd',
          borderRadius: '4px',
          background: 'white',
        }}
      >
        <div
          style={{
            padding: '12px',
            background: '#f5f5f5',
            borderBottom: '1px solid #ddd',
            cursor: 'pointer',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
          onClick={() => setTextExpanded(!textExpanded)}
        >
          <strong>Text Output</strong>
          <span>{textExpanded ? '▼' : '▶'}</span>
        </div>
        {textExpanded && (
          <div
            style={{
              padding: '12px',
              maxHeight: '300px',
              overflowY: 'auto',
              fontFamily: 'monospace',
              fontSize: '12px',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              background: '#1e1e1e',
              color: '#d4d4d4',
            }}
          >
            {isLoading ? (
              <div style={{ color: '#888' }}>Loading...</div>
            ) : textOutput ? (
              textOutput
            ) : (
              <div style={{ color: '#888', fontStyle: 'italic' }}>
                No text output
              </div>
            )}
          </div>
        )}
      </div>

      {/* Graphics Output Section */}
      <div
        style={{
          border: '1px solid #ddd',
          borderRadius: '4px',
          background: 'white',
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
        }}
      >
        <div
          style={{
            padding: '12px',
            background: '#f5f5f5',
            borderBottom: '1px solid #ddd',
            cursor: 'pointer',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
          onClick={() => setGraphicsExpanded(!graphicsExpanded)}
        >
          <strong>Graphics Output</strong>
          <span>{graphicsExpanded ? '▼' : '▶'}</span>
        </div>
        {graphicsExpanded && (
          <div
            style={{
              padding: '12px',
              flex: 1,
              overflow: 'auto',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: '#fafafa',
              minHeight: '200px',
            }}
          >
            {isLoading ? (
              <div style={{ color: '#888' }}>Loading...</div>
            ) : graphicsOutput ? (
              <img
                src={graphicsOutput}
                alt="Node output"
                style={{
                  maxWidth: '100%',
                  maxHeight: '100%',
                  objectFit: 'contain',
                }}
                onError={(e) => {
                  // If image fails to load, try to display as text
                  const target = e.target as HTMLImageElement;
                  target.style.display = 'none';
                  const parent = target.parentElement;
                  if (parent) {
                    const errorDiv = document.createElement('div');
                    errorDiv.textContent = 'Failed to load image';
                    errorDiv.style.color = '#888';
                    parent.appendChild(errorDiv);
                  }
                }}
              />
            ) : (
              <div style={{ color: '#888', fontStyle: 'italic' }}>
                No graphics output
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default OutputPanel;
