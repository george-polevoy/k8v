import { useState, useEffect, useRef } from 'react';
import { useGraphStore } from '../store/graphStore';
import axios from 'axios';

interface OutputPanelProps {
  embedded?: boolean;
}

function OutputPanel({ embedded = false }: OutputPanelProps) {
  const selectedNodeId = useGraphStore((state) => state.selectedNodeId);
  const selectedNodeName = useGraphStore((state) => {
    if (!state.selectedNodeId) return null;
    return state.graph?.nodes.find((n) => n.id === state.selectedNodeId)?.metadata.name || null;
  });
  const resultRefreshKey = useGraphStore((state) => state.resultRefreshKey);
  const [textOutput, setTextOutput] = useState<string>('');
  const [graphicsOutput, setGraphicsOutput] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [textExpanded, setTextExpanded] = useState(true);
  const [graphicsExpanded, setGraphicsExpanded] = useState(true);
  const hasAnyOutput = Boolean(textOutput) || Boolean(graphicsOutput);
  const hasAnyOutputRef = useRef(false);
  const panelContainerStyle = embedded
    ? {
        display: 'flex',
        flexDirection: 'column' as const,
        minHeight: 0,
        height: '100%',
        overflowY: 'auto' as const,
      }
    : {
        width: '400px',
        background: '#f9f9f9',
        borderLeft: '1px solid #ddd',
        padding: '16px',
        display: 'flex',
        flexDirection: 'column' as const,
        height: '100vh',
        overflowY: 'auto' as const,
      };

  useEffect(() => {
    hasAnyOutputRef.current = hasAnyOutput;
  }, [hasAnyOutput]);

  useEffect(() => {
    let cancelled = false;

    const fetchResult = async () => {
      if (!selectedNodeId) {
        setTextOutput('');
        setGraphicsOutput(null);
        setIsRefreshing(false);
        return;
      }

      setIsLoading(true);
      try {
        const response = await axios.get(`/api/nodes/${selectedNodeId}/result`);
        if (cancelled) return;
        if (response.data) {
          setTextOutput(response.data.textOutput || '');
          setGraphicsOutput(response.data.graphicsOutput || null);
        } else {
          setTextOutput('');
          setGraphicsOutput(null);
        }
      } catch (error: any) {
        if (cancelled) return;
        if (error.response?.status === 404) {
          // No result yet
          setTextOutput('No output yet. Run the graph to see results.');
          setGraphicsOutput(null);
        } else {
          setTextOutput(`Error loading result: ${error.message}`);
          setGraphicsOutput(null);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    fetchResult();
    return () => {
      cancelled = true;
    };
  }, [selectedNodeId]);

  // Refresh after compute while keeping currently displayed output in place.
  useEffect(() => {
    if (selectedNodeId) {
      let cancelled = false;

      const fetchResult = async () => {
        setIsRefreshing(true);
        try {
          const response = await axios.get(`/api/nodes/${selectedNodeId}/result`);
          if (cancelled) return;
          if (response.data) {
            setTextOutput(response.data.textOutput || '');
            setGraphicsOutput(response.data.graphicsOutput || null);
          }
        } catch (error: any) {
          if (cancelled) return;
          // During refresh retries, keep previous output mounted on transient misses.
          if (error.response?.status !== 404 && !hasAnyOutputRef.current) {
            setTextOutput(`Error loading result: ${error.message}`);
            setGraphicsOutput(null);
          }
        } finally {
          if (!cancelled) {
            setIsRefreshing(false);
          }
        }
      };
      // Delay to allow backend to save result, with retries
      const timeout1 = setTimeout(fetchResult, 500);
      const timeout2 = setTimeout(fetchResult, 1500);
      const timeout3 = setTimeout(fetchResult, 3000);
      return () => {
        cancelled = true;
        clearTimeout(timeout1);
        clearTimeout(timeout2);
        clearTimeout(timeout3);
      };
    }
  }, [resultRefreshKey, selectedNodeId]);

  if (!selectedNodeId) {
    return (
      <div
        data-testid="output-panel"
        style={panelContainerStyle}
      >
        {!embedded && <h3 style={{ marginBottom: '16px' }}>Output</h3>}
        <p style={{ color: '#666', fontSize: '14px' }}>Select a node to view its output</p>
      </div>
    );
  }

  return (
    <div
      data-testid="output-panel"
      style={panelContainerStyle}
    >
      <h3 style={{ marginBottom: embedded ? '12px' : '16px' }}>
        Output: {selectedNodeName || 'Unknown Node'}
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
          <span>
            {isRefreshing ? 'Refreshing... ' : ''}
            {textExpanded ? '▼' : '▶'}
          </span>
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
            {isLoading && !hasAnyOutput ? (
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
            {isLoading && !hasAnyOutput ? (
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
