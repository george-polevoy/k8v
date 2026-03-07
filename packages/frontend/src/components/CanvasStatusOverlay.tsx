interface CanvasStatusOverlayProps {
  graphExists: boolean;
  isLoading: boolean;
  error: string | null;
  createGraph: (name: string) => void;
}

export function CanvasStatusOverlay({
  graphExists,
  isLoading,
  error,
  createGraph,
}: CanvasStatusOverlayProps) {
  if (isLoading && !graphExists) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', flexDirection: 'column', gap: '16px' }}>
        <div>Loading...</div>
        {error && <div style={{ color: 'red', fontSize: '12px' }}>Error: {error}</div>}
      </div>
    );
  }

  if (graphExists) {
    return null;
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', flexDirection: 'column', gap: '16px' }}>
      <div>No graph loaded</div>
      {error && <div style={{ color: 'red', fontSize: '12px' }}>Error: {error}</div>}
      <button
        onClick={() => {
          createGraph('Untitled Graph');
        }}
        style={{
          padding: '8px 16px',
          background: '#2196F3',
          color: 'white',
          border: 'none',
          borderRadius: '4px',
          cursor: 'pointer',
        }}
      >
        Create New Graph
      </button>
    </div>
  );
}
