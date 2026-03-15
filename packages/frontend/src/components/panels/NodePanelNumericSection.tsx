import { sectionCardStyle } from './panelSectionStyles';

interface NodePanelNumericSectionProps {
  numericValueDraft: string;
  numericStepDraft: string;
  numericMinDraft: string;
  numericMaxDraft: string;
  onNumericValueChange: (value: string) => void;
  onNumericStepChange: (value: string) => void;
  onNumericMinChange: (value: string) => void;
  onNumericMaxChange: (value: string) => void;
  onCommitNumericInputConfig: () => void;
  onResetNumericInputDrafts: () => void;
}

function NodePanelNumericSection({
  numericValueDraft,
  numericStepDraft,
  numericMinDraft,
  numericMaxDraft,
  onNumericValueChange,
  onNumericStepChange,
  onNumericMinChange,
  onNumericMaxChange,
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
          { label: 'Value', testId: 'numeric-input-value', value: numericValueDraft, onChange: onNumericValueChange },
          { label: 'Step', testId: 'numeric-input-step', value: numericStepDraft, onChange: onNumericStepChange },
          { label: 'Min', testId: 'numeric-input-min', value: numericMinDraft, onChange: onNumericMinChange },
          { label: 'Max', testId: 'numeric-input-max', value: numericMaxDraft, onChange: onNumericMaxChange },
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
              onChange={(event) => field.onChange(event.target.value)}
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

