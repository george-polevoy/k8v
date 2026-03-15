import type { Dispatch, SetStateAction } from 'react';
import type { GraphNode } from '../../types';
import { sectionCardStyle } from './panelSectionStyles';

interface NodePanelInputsSectionProps {
  selectedNode: GraphNode;
  isNumericInputNode: boolean;
  supportsInputEditing: boolean;
  inputDraftNames: string[];
  inputValidationError: string | null;
  setInputDraftNames: Dispatch<SetStateAction<string[]>>;
  setInputValidationError: Dispatch<SetStateAction<string | null>>;
  onAddInputPort: () => void;
  onCommitInputName: (index: number) => void;
  onMoveInputPort: (index: number, direction: 'up' | 'down') => void;
  onDeleteInputPort: (index: number) => void;
}

function NodePanelInputsSection({
  selectedNode,
  isNumericInputNode,
  supportsInputEditing,
  inputDraftNames,
  inputValidationError,
  setInputDraftNames,
  setInputValidationError,
  onAddInputPort,
  onCommitInputName,
  onMoveInputPort,
  onDeleteInputPort,
}: NodePanelInputsSectionProps) {
  return (
    <div style={sectionCardStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
        <span style={{ fontWeight: 'bold', fontSize: '12px' }}>Inputs</span>
        <button
          data-testid="add-input-button"
          onClick={onAddInputPort}
          disabled={!supportsInputEditing}
          style={{
            padding: '4px 8px',
            background: !supportsInputEditing ? '#f1f5f9' : '#e2e8f0',
            border: '1px solid #cbd5e1',
            borderRadius: '4px',
            cursor: !supportsInputEditing ? 'not-allowed' : 'pointer',
            fontSize: '11px',
          }}
        >
          + Add Input
        </button>
      </div>

      {isNumericInputNode ? (
        <div style={{ fontSize: '12px', color: '#64748b', fontStyle: 'italic' }}>
          Numeric input nodes do not accept inbound ports.
        </div>
      ) : selectedNode.metadata.inputs.length === 0 ? (
        <div style={{ fontSize: '12px', color: '#64748b', fontStyle: 'italic' }}>No inputs defined</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {selectedNode.metadata.inputs.map((input, index) => (
            <div
              data-testid={`input-row-${index}`}
              key={`${input.name}-${index}`}
              style={{ display: 'grid', gridTemplateColumns: '1fr auto auto auto', gap: '6px', alignItems: 'center' }}
            >
              <input
                data-testid={`input-name-${index}`}
                type="text"
                value={inputDraftNames[index] ?? input.name}
                onChange={(event) => {
                  const next = [...inputDraftNames];
                  next[index] = event.target.value;
                  setInputDraftNames(next);
                }}
                onBlur={() => onCommitInputName(index)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.currentTarget.blur();
                  }
                  if (event.key === 'Escape') {
                    setInputDraftNames(selectedNode.metadata.inputs.map((item) => item.name));
                    setInputValidationError(null);
                    event.currentTarget.blur();
                  }
                }}
                style={{
                  width: '100%',
                  padding: '6px',
                  border: '1px solid #ddd',
                  borderRadius: '4px',
                  fontSize: '12px',
                  boxSizing: 'border-box',
                }}
              />
              <button
                data-testid={`input-move-up-${index}`}
                onClick={() => onMoveInputPort(index, 'up')}
                disabled={index === 0}
                title="Move up"
                style={{
                  padding: '4px 6px',
                  border: '1px solid #cbd5e1',
                  background: index === 0 ? '#f1f5f9' : '#fff',
                  cursor: index === 0 ? 'not-allowed' : 'pointer',
                  borderRadius: '4px',
                  fontSize: '11px',
                }}
              >
                ↑
              </button>
              <button
                data-testid={`input-move-down-${index}`}
                onClick={() => onMoveInputPort(index, 'down')}
                disabled={index === selectedNode.metadata.inputs.length - 1}
                title="Move down"
                style={{
                  padding: '4px 6px',
                  border: '1px solid #cbd5e1',
                  background: index === selectedNode.metadata.inputs.length - 1 ? '#f1f5f9' : '#fff',
                  cursor: index === selectedNode.metadata.inputs.length - 1 ? 'not-allowed' : 'pointer',
                  borderRadius: '4px',
                  fontSize: '11px',
                }}
              >
                ↓
              </button>
              <button
                data-testid={`input-delete-${index}`}
                onClick={() => onDeleteInputPort(index)}
                title="Delete input"
                style={{
                  padding: '4px 6px',
                  border: '1px solid #fecaca',
                  background: '#fff1f2',
                  color: '#b91c1c',
                  cursor: 'pointer',
                  borderRadius: '4px',
                  fontSize: '11px',
                }}
              >
                X
              </button>
            </div>
          ))}
        </div>
      )}

      {inputValidationError && (
        <div style={{ marginTop: '8px', color: '#b91c1c', fontSize: '11px' }}>
          {inputValidationError}
        </div>
      )}
    </div>
  );
}

export default NodePanelInputsSection;

