import { useState } from 'react';
import { useGraphStore } from '../store/graphStore';
import NodeCreationDialog from './NodeCreationDialog';

const DRAW_COLORS: Array<{ id: 'white' | 'green' | 'red'; label: string; hex: string }> = [
  { id: 'white', label: 'White', hex: '#ffffff' },
  { id: 'green', label: 'Green', hex: '#22c55e' },
  { id: 'red', label: 'Red', hex: '#ef4444' },
];

const DRAW_THICKNESSES: Array<{ id: 1 | 3 | 9; label: string }> = [
  { id: 1, label: 'Hairline' },
  { id: 3, label: '3 px' },
  { id: 9, label: '9 px' },
];

function Toolbar() {
  const computeGraph = useGraphStore((state) => state.computeGraph);
  const addNode = useGraphStore((state) => state.addNode);
  const drawingEnabled = useGraphStore((state) => state.drawingEnabled);
  const drawingColor = useGraphStore((state) => state.drawingColor);
  const drawingThickness = useGraphStore((state) => state.drawingThickness);
  const setDrawingEnabled = useGraphStore((state) => state.setDrawingEnabled);
  const setDrawingColor = useGraphStore((state) => state.setDrawingColor);
  const setDrawingThickness = useGraphStore((state) => state.setDrawingThickness);
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
        <button
          onClick={() => setDrawingEnabled(!drawingEnabled)}
          style={{
            padding: '8px',
            background: drawingEnabled ? '#0f766e' : '#475569',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
          }}
          title="Toggle Pencil Draw"
        >
          ✎
        </button>
        <div
          style={{
            marginTop: '4px',
            padding: '6px 4px',
            border: '1px solid #d1d5db',
            borderRadius: '6px',
            background: '#ffffff',
            opacity: drawingEnabled ? 1 : 0.65,
          }}
        >
          <div style={{ fontSize: '9px', color: '#475569', marginBottom: '4px', textAlign: 'center' }}>
            Color
          </div>
          <div style={{ display: 'flex', justifyContent: 'center', gap: '4px', marginBottom: '6px' }}>
            {DRAW_COLORS.map((color) => (
              <button
                key={color.id}
                onClick={() => setDrawingColor(color.id)}
                disabled={!drawingEnabled}
                title={`Pencil color: ${color.label}`}
                style={{
                  width: '14px',
                  height: '14px',
                  borderRadius: '50%',
                  border: drawingColor === color.id ? '2px solid #0f172a' : '1px solid #64748b',
                  background: color.hex,
                  cursor: drawingEnabled ? 'pointer' : 'not-allowed',
                  padding: 0,
                }}
              />
            ))}
          </div>
          <div style={{ fontSize: '9px', color: '#475569', marginBottom: '4px', textAlign: 'center' }}>
            Width
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {DRAW_THICKNESSES.map((entry) => (
              <button
                key={entry.id}
                onClick={() => setDrawingThickness(entry.id)}
                disabled={!drawingEnabled}
                title={`Pencil thickness: ${entry.label}`}
                style={{
                  fontSize: '9px',
                  padding: '3px 2px',
                  borderRadius: '4px',
                  border: drawingThickness === entry.id ? '1px solid #0ea5e9' : '1px solid #cbd5e1',
                  background: drawingThickness === entry.id ? '#e0f2fe' : '#f8fafc',
                  color: '#0f172a',
                  cursor: drawingEnabled ? 'pointer' : 'not-allowed',
                }}
              >
                {entry.label}
              </button>
            ))}
          </div>
        </div>
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
