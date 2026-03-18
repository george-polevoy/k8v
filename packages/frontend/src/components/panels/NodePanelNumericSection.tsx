import { sectionCardStyle } from './panelSectionStyles';

interface NumericInputDraft {
  value: string;
  step: string;
  min: string;
  max: string;
}

interface NodePanelNumericSectionProps {
  numericDraft: NumericInputDraft;
  onNumericDraftChange: (field: keyof NumericInputDraft, value: string) => void;
  onCommitNumericInputConfig: () => void;
  onResetNumericInputDrafts: () => void;
}

function NodePanelNumericSection({
  numericDraft,
  onNumericDraftChange,
  onCommitNumericInputConfig,
  onResetNumericInputDrafts,
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
              onChange={(event) => onNumericDraftChange(field.field, event.target.value)}
              onBlur={onCommitNumericInputConfig}
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
    </div>
  );
}

export default NodePanelNumericSection;
