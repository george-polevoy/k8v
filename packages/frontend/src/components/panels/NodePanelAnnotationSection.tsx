import { MAX_ANNOTATION_FONT_SIZE, MIN_ANNOTATION_FONT_SIZE } from '../../utils/annotation';
import { sectionCardStyle } from './panelSectionStyles';

interface NodePanelAnnotationSectionProps {
  annotationTextDraft: string;
  annotationBackgroundColorDraft: string;
  annotationBorderColorDraft: string;
  annotationFontColorDraft: string;
  annotationFontSizeDraft: string;
  onAnnotationTextChange: (value: string) => void;
  onCommitAnnotationSettings: (overrides?: {
    text?: string;
    backgroundColor?: string;
    borderColor?: string;
    fontColor?: string;
    fontSize?: number;
  }) => void;
  onResetAnnotationDrafts: () => void;
  onAnnotationFontSizeChange: (value: string) => void;
  onOpenAnnotationColorDialog: (target: 'background' | 'border' | 'font') => void;
}

function NodePanelAnnotationSection({
  annotationTextDraft,
  annotationBackgroundColorDraft,
  annotationBorderColorDraft,
  annotationFontColorDraft,
  annotationFontSizeDraft,
  onAnnotationTextChange,
  onCommitAnnotationSettings,
  onResetAnnotationDrafts,
  onAnnotationFontSizeChange,
  onOpenAnnotationColorDialog,
}: NodePanelAnnotationSectionProps) {
  return (
    <div style={sectionCardStyle}>
      <div style={{ fontWeight: 'bold', fontSize: '12px', marginBottom: '10px' }}>
        Annotation Content
      </div>
      <textarea
        data-testid="annotation-markdown-input"
        value={annotationTextDraft}
        onChange={(event) => onAnnotationTextChange(event.target.value)}
        onBlur={(event) => onCommitAnnotationSettings({ text: event.target.value })}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            onResetAnnotationDrafts();
            event.currentTarget.blur();
          }
        }}
        style={{
          width: '100%',
          minHeight: '160px',
          fontFamily: 'monospace',
          fontSize: '12px',
          padding: '8px',
          border: '1px solid #ddd',
          borderRadius: '4px',
          boxSizing: 'border-box',
          marginBottom: '10px',
        }}
      />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '8px' }}>
        {[
          { label: 'Background', target: 'background' as const, color: annotationBackgroundColorDraft, testId: 'annotation-background-color-input' },
          { label: 'Border', target: 'border' as const, color: annotationBorderColorDraft, testId: 'annotation-border-color-input' },
          { label: 'Text', target: 'font' as const, color: annotationFontColorDraft, testId: 'annotation-font-color-input' },
        ].map((option) => (
          <button
            key={option.testId}
            data-testid={option.testId}
            type="button"
            onClick={() => onOpenAnnotationColorDialog(option.target)}
            style={{
              width: '100%',
              minHeight: '34px',
              padding: '6px 8px',
              border: '1px solid #d1d5db',
              borderRadius: '4px',
              background: '#ffffff',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '8px',
              color: '#0f172a',
              fontSize: '11px',
            }}
          >
            <span>{option.label}</span>
            <span
              style={{
                width: '14px',
                height: '14px',
                borderRadius: '50%',
                border: '1px solid #334155',
                background: option.color,
                flexShrink: 0,
              }}
            />
          </button>
        ))}
      </div>
      <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '11px', color: '#475569', marginTop: '10px' }}>
        Font size (px)
        <input
          data-testid="annotation-font-size-input"
          type="number"
          min={MIN_ANNOTATION_FONT_SIZE}
          max={MAX_ANNOTATION_FONT_SIZE}
          step={1}
          value={annotationFontSizeDraft}
          onChange={(event) => onAnnotationFontSizeChange(event.target.value)}
          onBlur={() => onCommitAnnotationSettings()}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.currentTarget.blur();
            }
            if (event.key === 'Escape') {
              onResetAnnotationDrafts();
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
      <div style={{ marginTop: '10px', fontSize: '11px', color: '#64748b', lineHeight: 1.4 }}>
        Markdown and LaTeX are supported. Use inline math like <code>$a^2 + b^2 = c^2$</code> or block math with <code>$$...$$</code>.
      </div>
    </div>
  );
}

export default NodePanelAnnotationSection;
