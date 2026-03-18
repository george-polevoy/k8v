import { useState } from 'react';
import { createPortal } from 'react-dom';
import { GraphNode, NodeType } from '../types';
import { useGraphStore } from '../store/graphStore';
import ColorSelectionDialog from './ColorSelectionDialog';
import NodePanelAnnotationSection from './panels/NodePanelAnnotationSection';
import {
  createAnnotationNode,
  createInlineCodeNode,
  createNumericInputNode,
} from '../utils/nodeFactory';
import {
  type AnnotationColorTarget,
  DEFAULT_ANNOTATION_TEXT,
  getAnnotationColorDialogDefaultColor,
  getAnnotationColorDialogInitialColor,
  normalizeAnnotationDraft,
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

const DEFAULT_ANNOTATION_CONFIG = normalizeAnnotationDraft(undefined);

function NodeCreationDialog({ onClose, onAdd, position }: NodeCreationDialogProps) {
  const graph = useGraphStore((state) => state.graph);
  const [nodeType, setNodeType] = useState<NodeType>(NodeType.INLINE_CODE);
  const [name, setName] = useState('');
  const [code, setCode] = useState('outputs.output = inputs.input;');
  const [runtime, setRuntime] = useState('javascript_vm');
  const [pythonEnv, setPythonEnv] = useState('');
  const [annotationText, setAnnotationText] = useState(DEFAULT_ANNOTATION_TEXT);
  const [annotationBackgroundColor, setAnnotationBackgroundColor] = useState(
    () => DEFAULT_ANNOTATION_CONFIG.backgroundColor
  );
  const [annotationBorderColor, setAnnotationBorderColor] = useState(
    () => DEFAULT_ANNOTATION_CONFIG.borderColor
  );
  const [annotationFontColor, setAnnotationFontColor] = useState(
    () => DEFAULT_ANNOTATION_CONFIG.fontColor
  );
  const [annotationFontSize, setAnnotationFontSize] = useState(
    () => String(DEFAULT_ANNOTATION_CONFIG.fontSize)
  );
  const [annotationColorDialogTarget, setAnnotationColorDialogTarget] = useState<AnnotationColorTarget | null>(null);
  const pythonEnvs = graph?.pythonEnvs ?? [];

  const commitAnnotationSettings = (overrides?: {
    text?: string;
    backgroundColor?: string;
    borderColor?: string;
    fontColor?: string;
    fontSize?: number | string;
  }) => {
    const next = normalizeAnnotationDraft(
      {
        text: overrides?.text ?? annotationText,
        backgroundColor: overrides?.backgroundColor ?? annotationBackgroundColor,
        borderColor: overrides?.borderColor ?? annotationBorderColor,
        fontColor: overrides?.fontColor ?? annotationFontColor,
        fontSize: overrides?.fontSize ?? annotationFontSize,
      },
      {
        text: annotationText,
        backgroundColor: annotationBackgroundColor,
        borderColor: annotationBorderColor,
        fontColor: annotationFontColor,
        fontSize: normalizeAnnotationFontSize(annotationFontSize),
      }
    );
    setAnnotationText(next.text);
    setAnnotationBackgroundColor(next.backgroundColor);
    setAnnotationBorderColor(next.borderColor);
    setAnnotationFontColor(next.fontColor);
    setAnnotationFontSize(String(next.fontSize));
  };

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
  const annotationColorDialogDefaultColor =
    getAnnotationColorDialogDefaultColor(annotationColorDialogTarget);
  const annotationColorDialogInitialColor = getAnnotationColorDialogInitialColor(
    annotationColorDialogTarget,
    {
      backgroundColor: annotationBackgroundColor,
      borderColor: annotationBorderColor,
      fontColor: annotationFontColor,
    }
  );
  const applyAnnotationColor = (nextColor: string) => {
    if (annotationColorDialogTarget === null) {
      return;
    }
    if (annotationColorDialogTarget === 'background') {
      commitAnnotationSettings({ backgroundColor: nextColor });
    } else if (annotationColorDialogTarget === 'border') {
      commitAnnotationSettings({ borderColor: nextColor });
    } else {
      commitAnnotationSettings({ fontColor: nextColor });
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
          <NodePanelAnnotationSection
            framed={false}
            annotationTextDraft={annotationText}
            annotationBackgroundColorDraft={annotationBackgroundColor}
            annotationBorderColorDraft={annotationBorderColor}
            annotationFontColorDraft={annotationFontColor}
            annotationFontSizeDraft={annotationFontSize}
            onAnnotationTextChange={setAnnotationText}
            onCommitAnnotationSettings={commitAnnotationSettings}
            onResetAnnotationDrafts={() => {
              commitAnnotationSettings();
            }}
            onAnnotationFontSizeChange={setAnnotationFontSize}
            onOpenAnnotationColorDialog={setAnnotationColorDialogTarget}
          />
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
