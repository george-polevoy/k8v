import { useState } from 'react';
import { createPortal } from 'react-dom';
import { GraphNode, NodeType } from '../types';
import { useGraphStore } from '../store/graphStore';
import ColorSelectionDialog from './ColorSelectionDialog';
import {
  createAnnotationNode,
  createInlineCodeNode,
  createNumericInputNode,
} from '../utils/nodeFactory';
import {
  DEFAULT_ANNOTATION_BACKGROUND_COLOR,
  DEFAULT_ANNOTATION_BORDER_COLOR,
  DEFAULT_ANNOTATION_FONT_COLOR,
  DEFAULT_ANNOTATION_FONT_SIZE,
  DEFAULT_ANNOTATION_TEXT,
  MAX_ANNOTATION_FONT_SIZE,
  MIN_ANNOTATION_FONT_SIZE,
  normalizeAnnotationFontSize,
} from '../utils/annotation';
import {
  inferInlineInputPortNames,
  inferInlineOutputPortNames,
} from '../utils/inlinePortInference';

interface NodeCreationDialogProps {
  onClose: () => void;
  onAdd: (node: GraphNode) => void;
  position: { x: number; y: number };
}

type AnnotationColorTarget = 'background' | 'border' | 'font';

function NodeCreationDialog({ onClose, onAdd, position }: NodeCreationDialogProps) {
  const graph = useGraphStore((state) => state.graph);
  const [nodeType, setNodeType] = useState<NodeType>(NodeType.INLINE_CODE);
  const [name, setName] = useState('');
  const [code, setCode] = useState('outputs.output = inputs.input;');
  const [runtime, setRuntime] = useState('javascript_vm');
  const [pythonEnv, setPythonEnv] = useState('');
  const [annotationText, setAnnotationText] = useState(DEFAULT_ANNOTATION_TEXT);
  const [annotationBackgroundColor, setAnnotationBackgroundColor] = useState(DEFAULT_ANNOTATION_BACKGROUND_COLOR);
  const [annotationBorderColor, setAnnotationBorderColor] = useState(DEFAULT_ANNOTATION_BORDER_COLOR);
  const [annotationFontColor, setAnnotationFontColor] = useState(DEFAULT_ANNOTATION_FONT_COLOR);
  const [annotationFontSize, setAnnotationFontSize] = useState(String(DEFAULT_ANNOTATION_FONT_SIZE));
  const [annotationColorDialogTarget, setAnnotationColorDialogTarget] = useState<AnnotationColorTarget | null>(null);
  const pythonEnvs = graph?.pythonEnvs ?? [];

  const handleCreate = () => {
    let newNode: GraphNode;

    switch (nodeType) {
      case NodeType.INLINE_CODE:
        newNode = createInlineCodeNode({
          position,
          name: name || undefined,
          code: code || undefined,
          runtime,
          pythonEnv: runtime === 'python_process' && pythonEnv ? pythonEnv : undefined,
          inputNames: inferInlineInputPortNames(code),
          outputNames: inferInlineOutputPortNames(code),
        });
        break;
      case NodeType.NUMERIC_INPUT:
        newNode = createNumericInputNode({
          position,
          name: name || undefined,
        });
        break;
      case NodeType.ANNOTATION:
        newNode = createAnnotationNode({
          position,
          name: name || undefined,
          annotationText,
          annotationBackgroundColor,
          annotationBorderColor,
          annotationFontColor,
          annotationFontSize: normalizeAnnotationFontSize(annotationFontSize),
        });
        break;
      default:
        newNode = createInlineCodeNode({ position, name: name || undefined });
    }

    onAdd(newNode);
    onClose();
  };

  const annotationColorDialogOpen = annotationColorDialogTarget !== null;
  const annotationColorDialogTitle = annotationColorDialogTarget === 'background'
    ? 'Annotation Background'
    : annotationColorDialogTarget === 'border'
      ? 'Annotation Border'
      : 'Annotation Text';
  const annotationColorDialogDefaultColor = annotationColorDialogTarget === 'background'
    ? DEFAULT_ANNOTATION_BACKGROUND_COLOR
    : annotationColorDialogTarget === 'border'
      ? DEFAULT_ANNOTATION_BORDER_COLOR
      : DEFAULT_ANNOTATION_FONT_COLOR;
  const annotationColorDialogInitialColor = annotationColorDialogTarget === 'background'
    ? annotationBackgroundColor
    : annotationColorDialogTarget === 'border'
      ? annotationBorderColor
      : annotationFontColor;
  const applyAnnotationColor = (nextColor: string) => {
    if (annotationColorDialogTarget === 'background') {
      setAnnotationBackgroundColor(nextColor);
    } else if (annotationColorDialogTarget === 'border') {
      setAnnotationBorderColor(nextColor);
    } else if (annotationColorDialogTarget === 'font') {
      setAnnotationFontColor(nextColor);
    }
    setAnnotationColorDialogTarget(null);
  };

  const dialog = (
    <div
      data-testid="node-creation-dialog"
      style={{
        position: 'fixed',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        background: 'white',
        padding: '24px',
        borderRadius: '8px',
        boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
        zIndex: 1000,
        minWidth: '400px',
      }}
    >
      <h2 style={{ marginBottom: '16px' }}>Create New Node</h2>

      <div style={{ marginBottom: '16px' }}>
        <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>
          Node Type:
        </label>
        <select
          value={nodeType}
          onChange={(e) => setNodeType(e.target.value as NodeType)}
          style={{
            width: '100%',
            padding: '8px',
            border: '1px solid #ddd',
            borderRadius: '4px',
          }}
        >
          <option value={NodeType.INLINE_CODE}>Inline Code</option>
          <option value={NodeType.NUMERIC_INPUT}>Numeric Input</option>
          <option value={NodeType.ANNOTATION}>Annotation</option>
        </select>
      </div>

      <div style={{ marginBottom: '16px' }}>
        <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>
          Name (optional):
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Leave empty for default name"
          style={{
            width: '100%',
            padding: '8px',
            border: '1px solid #ddd',
            borderRadius: '4px',
          }}
        />
      </div>

      {nodeType === NodeType.INLINE_CODE && (
        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>
            Runtime:
          </label>
          <select
            value={runtime}
            onChange={(e) => {
              const nextRuntime = e.target.value;
              setRuntime(nextRuntime);
              if (nextRuntime === 'python_process' && code.trim() === 'outputs.output = inputs.input;') {
                setCode('outputs.output = inputs.input');
              }
              if (nextRuntime === 'javascript_vm' && code.trim() === 'outputs.output = inputs.input') {
                setCode('outputs.output = inputs.input;');
              }
            }}
            style={{
              width: '100%',
              padding: '8px',
              border: '1px solid #ddd',
              borderRadius: '4px',
              marginBottom: '12px',
            }}
          >
            <option value="javascript_vm">JavaScript VM</option>
            <option value="python_process">Python Process</option>
          </select>
          {runtime === 'python_process' && (
            <>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>
                Python Env:
              </label>
              <select
                value={pythonEnv}
                onChange={(e) => setPythonEnv(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px',
                  border: '1px solid #ddd',
                  borderRadius: '4px',
                  marginBottom: '12px',
                }}
              >
                <option value="">Default backend Python</option>
                {pythonEnvs.map((env) => (
                  <option key={env.name} value={env.name}>
                    {env.name}
                  </option>
                ))}
              </select>
            </>
          )}
          <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>
            Code:
          </label>
          <textarea
            value={code}
            onChange={(e) => setCode(e.target.value)}
            style={{
              width: '100%',
              minHeight: '150px',
              fontFamily: 'monospace',
              fontSize: '12px',
              padding: '8px',
              border: '1px solid #ddd',
              borderRadius: '4px',
            }}
          />
        </div>
      )}

      {nodeType === NodeType.ANNOTATION && (
        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>
            Markdown:
          </label>
          <textarea
            value={annotationText}
            onChange={(e) => setAnnotationText(e.target.value)}
            style={{
              width: '100%',
              minHeight: '150px',
              fontFamily: 'monospace',
              fontSize: '12px',
              padding: '8px',
              border: '1px solid #ddd',
              borderRadius: '4px',
              marginBottom: '12px',
            }}
          />
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr',
              gap: '8px',
              marginBottom: '8px',
            }}
          >
            <button
              type="button"
              data-testid="annotation-background-color-input"
              onClick={() => setAnnotationColorDialogTarget('background')}
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
              <span>Background</span>
              <span
                style={{
                  width: '14px',
                  height: '14px',
                  borderRadius: '50%',
                  border: '1px solid #334155',
                  background: annotationBackgroundColor,
                  flexShrink: 0,
                }}
              />
            </button>
            <button
              type="button"
              data-testid="annotation-border-color-input"
              onClick={() => setAnnotationColorDialogTarget('border')}
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
              <span>Border</span>
              <span
                style={{
                  width: '14px',
                  height: '14px',
                  borderRadius: '50%',
                  border: '1px solid #334155',
                  background: annotationBorderColor,
                  flexShrink: 0,
                }}
              />
            </button>
            <button
              type="button"
              data-testid="annotation-font-color-input"
              onClick={() => setAnnotationColorDialogTarget('font')}
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
              <span>Text</span>
              <span
                style={{
                  width: '14px',
                  height: '14px',
                  borderRadius: '50%',
                  border: '1px solid #334155',
                  background: annotationFontColor,
                  flexShrink: 0,
                }}
              />
            </button>
          </div>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '11px', color: '#475569' }}>
            Font size (px)
            <input
              data-testid="annotation-font-size-input"
              type="number"
              min={MIN_ANNOTATION_FONT_SIZE}
              max={MAX_ANNOTATION_FONT_SIZE}
              step={1}
              value={annotationFontSize}
              onChange={(event) => setAnnotationFontSize(event.target.value)}
              onBlur={() => {
                setAnnotationFontSize(String(normalizeAnnotationFontSize(annotationFontSize)));
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
        </div>
      )}

      <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
        <button
          onClick={onClose}
          style={{
            padding: '8px 16px',
            background: '#f5f5f5',
            border: '1px solid #ddd',
            borderRadius: '4px',
            cursor: 'pointer',
          }}
        >
          Cancel
        </button>
        <button
          onClick={handleCreate}
          style={{
            padding: '8px 16px',
            background: '#2196F3',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
          }}
        >
          Create
        </button>
      </div>
      <ColorSelectionDialog
        open={annotationColorDialogOpen}
        title={annotationColorDialogTitle}
        description="Choose annotation color and opacity."
        initialColor={annotationColorDialogInitialColor}
        defaultColor={annotationColorDialogDefaultColor}
        confirmLabel="Use Color"
        allowOpacity
        onCancel={() => setAnnotationColorDialogTarget(null)}
        onConfirm={applyAnnotationColor}
      />
    </div>
  );

  if (typeof document === 'undefined') {
    return dialog;
  }

  return createPortal(dialog, document.body);
}

export default NodeCreationDialog;
