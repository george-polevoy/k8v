import type { GraphDrawing } from '../../types';
import { sectionCardStyle } from './panelSectionStyles';

interface NodePanelDrawingSectionProps {
  selectedDrawing: GraphDrawing;
  drawingNameValue: string;
  onDrawingNameChange: (value: string) => void;
  onCommitDrawingName: () => void;
  onResetDrawingName: () => void;
  onDeleteDrawing: () => void;
}

function NodePanelDrawingSection({
  selectedDrawing,
  drawingNameValue,
  onDrawingNameChange,
  onCommitDrawingName,
  onResetDrawingName,
  onDeleteDrawing,
}: NodePanelDrawingSectionProps) {
  return (
    <div>
      <h4 style={{ marginBottom: '12px' }}>{selectedDrawing.name}</h4>

      <div style={{ marginBottom: '12px' }}>
        <label style={{ display: 'block', marginBottom: '6px', fontWeight: 'bold' }}>
          Drawing Name:
        </label>
        <input
          data-testid="drawing-name-input"
          type="text"
          value={drawingNameValue}
          onChange={(event) => onDrawingNameChange(event.target.value)}
          onBlur={onCommitDrawingName}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.currentTarget.blur();
            }
            if (event.key === 'Escape') {
              onResetDrawingName();
              event.currentTarget.blur();
            }
          }}
          style={{
            width: '100%',
            padding: '8px',
            border: '1px solid #ddd',
            borderRadius: '4px',
            boxSizing: 'border-box',
          }}
        />
      </div>

      <div
        style={{
          ...sectionCardStyle,
          fontSize: '12px',
          color: '#334155',
        }}
      >
        <div>Paths: {selectedDrawing.paths.length}</div>
        <div>Position: ({Math.round(selectedDrawing.position.x)}, {Math.round(selectedDrawing.position.y)})</div>
      </div>

      <button
        data-testid="delete-selected-drawing-button"
        onClick={onDeleteDrawing}
        style={{
          width: '100%',
          padding: '10px',
          background: '#dc2626',
          color: 'white',
          border: 'none',
          borderRadius: '4px',
          cursor: 'pointer',
          marginBottom: '8px',
          fontSize: '12px',
        }}
      >
        Delete Selected Drawing
      </button>
    </div>
  );
}

export default NodePanelDrawingSection;
