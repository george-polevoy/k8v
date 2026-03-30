import { useState } from 'react';
import type { GraphNode } from '../types';
import { useGraphStore } from '../store/graphStore';
import ColorFieldButton from './ColorFieldButton';
import ColorSelectionDialog from './ColorSelectionDialog';
import NodeCreationDialog from './NodeCreationDialog';

const DRAW_THICKNESSES: Array<{ id: 1 | 3 | 9; label: string }> = [
  { id: 1, label: 'Hairline' },
  { id: 3, label: '3 px' },
  { id: 9, label: '9 px' },
];

const sectionCardStyle = {
  border: '1px solid #dbe4ef',
  borderRadius: '10px',
  background: '#ffffff',
  padding: '14px',
  boxShadow: '0 1px 2px rgba(15, 23, 42, 0.04)',
};

interface ToolbarProps {
  embedded?: boolean;
}

interface ToolActionButtonProps {
  title: string;
  label: string;
  description: string;
  accentColor: string;
  onClick: () => void;
}

function ToolActionButton({
  title,
  label,
  description,
  accentColor,
  onClick,
}: ToolActionButtonProps) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      style={{
        width: '100%',
        padding: '12px',
        borderRadius: '10px',
        border: '1px solid #dbe4ef',
        background: '#f8fafc',
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
        textAlign: 'left',
      }}
    >
      <span style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a' }}>
        {label}
      </span>
      <span style={{ fontSize: '11px', lineHeight: 1.45, color: '#475569' }}>
        {description}
      </span>
      <span
        aria-hidden="true"
        style={{
          width: '28px',
          height: '3px',
          borderRadius: '999px',
          background: accentColor,
          marginTop: '4px',
        }}
      />
    </button>
  );
}

function Toolbar({ embedded = false }: ToolbarProps) {
  const computeGraph = useGraphStore((state) => state.computeGraph);
  const addNode = useGraphStore((state) => state.addNode);
  const requestCreateDrawing = useGraphStore((state) => state.requestCreateDrawing);
  const selectedDrawingId = useGraphStore((state) => state.selectedDrawingId);
  const drawingEnabled = useGraphStore((state) => state.drawingEnabled);
  const drawingColor = useGraphStore((state) => state.drawingColor);
  const drawingThickness = useGraphStore((state) => state.drawingThickness);
  const setDrawingEnabled = useGraphStore((state) => state.setDrawingEnabled);
  const setDrawingColor = useGraphStore((state) => state.setDrawingColor);
  const setDrawingThickness = useGraphStore((state) => state.setDrawingThickness);
  const [showDialog, setShowDialog] = useState(false);
  const [showDrawingColorDialog, setShowDrawingColorDialog] = useState(false);
  const [dialogPosition, setDialogPosition] = useState({ x: 400, y: 300 });

  const handleAddNode = () => {
    setDialogPosition({ x: 400, y: 300 });
    setShowDialog(true);
  };

  const handleAddNodeWithPosition = (node: GraphNode) => {
    addNode(node);
    setShowDialog(false);
  };

  return (
    <>
      <div
        data-testid="tools-panel"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '14px',
          minHeight: 0,
          ...(embedded ? {} : { padding: '16px' }),
        }}
      >
        <div style={sectionCardStyle}>
          <div style={{ fontSize: '15px', fontWeight: 700, color: '#0f172a', marginBottom: '4px' }}>
            Canvas Tools
          </div>
          <div style={{ fontSize: '12px', color: '#475569', lineHeight: 1.45, marginBottom: '12px' }}>
            Compute the graph, add nodes, and manage drawing mode from one docked panel.
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
              gap: '10px',
            }}
          >
            <ToolActionButton
              title="Compute Graph"
              label="Compute Graph"
              description="Run the current graph with the latest inputs."
              accentColor="#16a34a"
              onClick={() => computeGraph()}
            />
            <ToolActionButton
              title="Add Node"
              label="Add Node"
              description="Open the node creation dialog."
              accentColor="#2563eb"
              onClick={handleAddNode}
            />
            <ToolActionButton
              title="Create Drawing Object"
              label="Create Drawing"
              description="Add a new named drawing container to the canvas."
              accentColor="#0ea5e9"
              onClick={() => requestCreateDrawing()}
            />
            <ToolActionButton
              title="Toggle Pencil Draw"
              label={drawingEnabled ? 'Disable Pencil' : 'Enable Pencil'}
              description="Toggle freehand drawing mode on the canvas."
              accentColor={drawingEnabled ? '#0f766e' : '#475569'}
              onClick={() => setDrawingEnabled(!drawingEnabled)}
            />
          </div>
        </div>

        <div style={sectionCardStyle}>
          <div style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a', marginBottom: '4px' }}>
            Pencil Settings
          </div>
          <div style={{ fontSize: '11px', color: '#475569', lineHeight: 1.45, marginBottom: '12px' }}>
            Drawing mode must be enabled before color and stroke-width changes can be applied.
          </div>
          {!selectedDrawingId && (
            <div
              style={{
                border: '1px solid #fecaca',
                background: '#fef2f2',
                borderRadius: '8px',
                color: '#991b1b',
                fontSize: '11px',
                lineHeight: 1.35,
                marginBottom: '12px',
                overflowWrap: 'anywhere',
                padding: '9px 10px',
                whiteSpace: 'normal',
              }}
            >
              Create/select drawing
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: '11px', color: '#475569', marginBottom: '4px' }}>Color</div>
              <div style={{ fontSize: '11px', color: '#64748b', lineHeight: 1.35 }}>
                Choose the freehand drawing color.
              </div>
            </div>
            <ColorFieldButton
              label="Pick"
              color={drawingColor}
              onClick={() => {
                if (!drawingEnabled) {
                  return;
                }
                setShowDrawingColorDialog(true);
              }}
              disabled={!drawingEnabled}
              title="Choose pencil color"
              minHeight="32px"
              fontSize="11px"
            />
          </div>

          <div style={{ fontSize: '11px', color: '#475569', marginBottom: '6px' }}>Width</div>
          <div style={{ display: 'flex', gap: '8px' }}>
            {DRAW_THICKNESSES.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => setDrawingThickness(entry.id)}
                disabled={!drawingEnabled}
                title={`Pencil thickness: ${entry.label}`}
                style={{
                  flex: 1,
                  fontSize: '11px',
                  padding: '8px 10px',
                  borderRadius: '8px',
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
      <ColorSelectionDialog
        open={showDrawingColorDialog}
        title="Pencil Color"
        description="Choose the freehand drawing color."
        initialColor={drawingColor}
        defaultColor="#ffffff"
        confirmLabel="Use Color"
        onCancel={() => setShowDrawingColorDialog(false)}
        onConfirm={(color) => {
          setDrawingColor(color);
          setShowDrawingColorDialog(false);
        }}
      />
    </>
  );
}

export default Toolbar;
