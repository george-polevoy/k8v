import { sectionCardStyle } from './panelSectionStyles';

interface NumericInputDraft {
  value: string;
  step: string;
  min: string;
  max: string;
  propagateWhileDragging: boolean;
  dragDebounceSeconds: string;
}

interface NodePanelNumericSectionProps {
  numericDraft: NumericInputDraft;
  onNumericDraftChange: (
    field: 'value' | 'step' | 'min' | 'max' | 'dragDebounceSeconds',
    value: string
  ) => void;
  onCommitNumericInputConfig: (
    field?: 'value' | 'step' | 'min' | 'max' | 'dragDebounceSeconds',
    value?: string
  ) => void;
  onResetNumericInputDrafts: () => void;
  onSetPropagateWhileDragging: (enabled: boolean) => void;
}

function NodePanelNumericSection({
  numericDraft,
  onNumericDraftChange,
  onCommitNumericInputConfig,
  onResetNumericInputDrafts,
  onSetPropagateWhileDragging,
}: NodePanelNumericSectionProps) {
  return (
    <div style={sectionCardStyle}>
      <div style={{ fontWeight: 'bold', fontSize: '12px', marginBottom: '10px' }}>
        Numeric Input Settings
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '8px',
        }}
      >
        {[
          { label: 'Value', testId: 'numeric-input-value', value: numericDraft.value, field: 'value' as const },
          { label: 'Step', testId: 'numeric-input-step', value: numericDraft.step, field: 'step' as const },
          { label: 'Min', testId: 'numeric-input-min', value: numericDraft.min, field: 'min' as const },
          { label: 'Max', testId: 'numeric-input-max', value: numericDraft.max, field: 'max' as const },
          {
            label: 'Debounce (seconds)',
            testId: 'numeric-input-drag-debounce-seconds',
            value: numericDraft.dragDebounceSeconds,
            field: 'dragDebounceSeconds' as const,
            step: '0.01',
            min: '0',
          },
        ].map((field) => (
          <label
            key={field.testId}
            style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '11px', color: '#475569' }}
          >
            {field.label}
            <input
              data-testid={field.testId}
              type="number"
              value={field.value}
              min={field.min}
              step={field.step}
              onChange={(event) => onNumericDraftChange(field.field, event.target.value)}
              onBlur={(event) => onCommitNumericInputConfig(field.field, event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.currentTarget.blur();
                }
                if (event.key === 'Escape') {
                  onResetNumericInputDrafts();
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
          </label>
        ))}
      </div>
      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          marginTop: '12px',
          fontSize: '12px',
          color: '#334155',
        }}
      >
        <input
          data-testid="numeric-input-propagate-while-dragging-toggle"
          type="checkbox"
          checked={numericDraft.propagateWhileDragging}
          onChange={(event) => onSetPropagateWhileDragging(event.target.checked)}
        />
        Propagate changes while dragging slider
      </label>
    </div>
  );
}

export default NodePanelNumericSection;
