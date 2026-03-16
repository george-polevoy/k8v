import { useState, useEffect, useRef, useMemo } from 'react';
import { useGraphStore } from '../store/graphStore';
import { GraphicsArtifact } from '../types';
import { buildGraphicsImageUrl, resolveStableGraphicsRequestMaxPixels } from '../utils/graphics';

interface OutputPanelProps {
  embedded?: boolean;
}

function OutputPanel({ embedded = false }: OutputPanelProps) {
  const selectedNodeId = useGraphStore((state) => state.selectedNodeId);
  const selectedNodeName = useGraphStore((state) => {
    if (!state.selectedNodeId) return null;
    return state.graph?.nodes.find((n) => n.id === state.selectedNodeId)?.metadata.name || null;
  });
  const selectedNodeExecutionState = useGraphStore((state) => {
    if (!state.selectedNodeId) {
      return null;
    }
    return state.nodeExecutionStates[state.selectedNodeId] ?? null;
  });
  const selectedNodeResult = useGraphStore((state) => {
    if (!state.selectedNodeId) {
      return null;
    }
    return state.nodeResults[state.selectedNodeId] ?? null;
  });
  const [graphicsMaxPixels, setGraphicsMaxPixels] = useState(1_000_000);
  const [textExpanded, setTextExpanded] = useState(true);
  const [graphicsExpanded, setGraphicsExpanded] = useState(true);
  const isNodeRefreshing = Boolean(selectedNodeExecutionState?.isPending || selectedNodeExecutionState?.isComputing);
  const textOutput = selectedNodeResult?.textOutput ?? '';
  const graphicsOutput = (selectedNodeResult?.graphics ?? null) as GraphicsArtifact | null;
  const hasAnyOutput = Boolean(textOutput) || Boolean(graphicsOutput);
  const isLoading = Boolean(selectedNodeId) && !selectedNodeResult && isNodeRefreshing;
  const graphicsViewportRef = useRef<HTMLDivElement | null>(null);
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
    if (!graphicsViewportRef.current || typeof ResizeObserver === 'undefined') {
      return;
    }

    const element = graphicsViewportRef.current;
    const updateBudget = () => {
      const bounds = element.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const budget = Math.max(1, Math.floor(bounds.width * bounds.height * dpr * dpr));
      setGraphicsMaxPixels(budget);
    };

    updateBudget();
    const observer = new ResizeObserver(() => updateBudget());
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const graphicsImageSrc = useMemo(() => {
    if (!graphicsOutput) {
      return null;
    }
    const stableMaxPixels = resolveStableGraphicsRequestMaxPixels(graphicsOutput, graphicsMaxPixels);
    return buildGraphicsImageUrl(graphicsOutput, stableMaxPixels);
  }, [graphicsOutput, graphicsMaxPixels]);

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
            {isNodeRefreshing ? 'Refreshing... ' : ''}
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
                {isNodeRefreshing ? 'Refreshing output...' : 'No text output'}
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
            ref={graphicsViewportRef}
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
            ) : graphicsImageSrc ? (
              <img
                src={graphicsImageSrc}
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
