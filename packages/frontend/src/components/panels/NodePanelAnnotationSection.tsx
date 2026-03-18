import {
  type AnnotationColorTarget,
  type AnnotationDraft,
  MAX_ANNOTATION_FONT_SIZE,
  MIN_ANNOTATION_FONT_SIZE,
} from '../../utils/annotation';
import ColorFieldButton from '../ColorFieldButton';
import { sectionCardStyle } from './panelSectionStyles';

interface NodePanelAnnotationSectionProps {
  framed?: boolean;
  mode?: 'single' | 'multi';
  hasMixedFontColor?: boolean;
  hasMixedFontSize?: boolean;
  annotationDraft: AnnotationDraft;
  onAnnotationDraftChange: (field: keyof AnnotationDraft, value: string) => void;
  onCommitAnnotationSettings: (overrides?: {
    text?: string;
    backgroundColor?: string;
    borderColor?: string;
    fontColor?: string;
    fontSize?: number | string;
  }) => void;
  onResetAnnotationDrafts: () => void;
  onOpenAnnotationColorDialog: (target: AnnotationColorTarget) => void;
}

function NodePanelAnnotationSection({
  framed = true,
  mode = 'single',
  hasMixedFontColor = false,
  hasMixedFontSize = false,
  annotationDraft,
  onAnnotationDraftChange,
  onCommitAnnotationSettings,
  onResetAnnotationDrafts,
  onOpenAnnotationColorDialog,
}: NodePanelAnnotationSectionProps) {
  const isMultiSelectionMode = mode === 'multi';
  const colorOptions = isMultiSelectionMode
    ? [
        {
          label: hasMixedFontColor ? 'Text (mixed)' : 'Text',
          target: 'font' as const,
          color: annotationDraft.fontColor,
          testId: 'annotation-font-color-input',
        },
      ]
    : [
        {
          label: 'Background',
          target: 'background' as const,
          color: annotationDraft.backgroundColor,
          testId: 'annotation-background-color-input',
        },
        {
          label: 'Border',
          target: 'border' as const,
          color: annotationDraft.borderColor,
          testId: 'annotation-border-color-input',
        },
        {
          label: 'Text',
          target: 'font' as const,
          color: annotationDraft.fontColor,
          testId: 'annotation-font-color-input',
        },
      ];

  const content = (
    <>
      <div style={{ fontWeight: 'bold', fontSize: '12px', marginBottom: '10px' }}>
        {isMultiSelectionMode ? 'Annotation Text' : 'Annotation Content'}
      </div>
      {isMultiSelectionMode && (
        <div style={{ marginBottom: '10px', fontSize: '11px', color: '#64748b', lineHeight: 1.4 }}>
          Applies to all selected annotation cards.
        </div>
      )}
      {!isMultiSelectionMode && (
        <textarea
          data-testid="annotation-markdown-input"
          value={annotationDraft.text}
          onChange={(event) => onAnnotationDraftChange('text', event.target.value)}
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
      )}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '8px' }}>
        {colorOptions.map((option) => (
          <ColorFieldButton
            key={option.testId}
            testId={option.testId}
            label={option.label}
            color={option.color}
            onClick={() => onOpenAnnotationColorDialog(option.target)}
          />
        ))}
      </div>
      <label
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '4px',
          fontSize: '11px',
          color: '#475569',
          marginTop: isMultiSelectionMode ? 0 : '10px',
        }}
      >
        {isMultiSelectionMode && hasMixedFontSize ? 'Font size (mixed)' : 'Font size (px)'}
        <input
          data-testid="annotation-font-size-input"
          type="number"
          min={MIN_ANNOTATION_FONT_SIZE}
          max={MAX_ANNOTATION_FONT_SIZE}
          step={1}
          value={annotationDraft.fontSize}
          onChange={(event) => onAnnotationDraftChange('fontSize', event.target.value)}
          onBlur={(event) => {
            const nextFontSize = event.currentTarget.value.trim();
            if (isMultiSelectionMode && !nextFontSize) {
              onResetAnnotationDrafts();
              return;
            }
            onCommitAnnotationSettings({ fontSize: nextFontSize });
          }}
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
      {isMultiSelectionMode ? (
        hasMixedFontSize && (
          <div style={{ marginTop: '8px', fontSize: '10px', color: '#64748b', lineHeight: 1.4 }}>
            Selection currently has mixed font sizes. Enter a value to apply one size across all selected annotation cards.
          </div>
        )
      ) : (
        <div style={{ marginTop: '10px', fontSize: '11px', color: '#64748b', lineHeight: 1.4 }}>
          Markdown and LaTeX are supported. Use inline math like <code>$a^2 + b^2 = c^2$</code> or block math with <code>$$...$$</code>.
        </div>
      )}
    </>
  );

  if (!framed) {
    return content;
  }

  return <div style={sectionCardStyle}>{content}</div>;
}

export default NodePanelAnnotationSection;
