import { useState, useEffect, useCallback, useRef } from 'react';
import { useGraphStore } from '../store/graphStore';
import { GraphNode, NodeType, PortDefinition } from '../types';
import { createInlineCodeNode } from '../utils/nodeFactory';
import { inferInlineOutputPortNames } from '../utils/inlinePortInference';
import { normalizeColorString } from '../utils/color';
import {
  DEFAULT_NODE_CARD_BACKGROUND_COLOR,
  DEFAULT_NODE_CARD_BORDER_COLOR,
  resolveNodeCardAppearance,
} from '../utils/nodeCardAppearance';
import { normalizeNumericInputConfig } from '../utils/numericInput';
import ColorSelectionDialog from './ColorSelectionDialog';
import GraphManagementControls from './GraphManagementControls';
import PythonEnvironmentSection from './PythonEnvironmentSection';
import { useGraphManagementState } from './useGraphManagementState';
import {
  DEFAULT_ANNOTATION_BACKGROUND_COLOR,
  DEFAULT_ANNOTATION_BORDER_COLOR,
  DEFAULT_ANNOTATION_FONT_COLOR,
  DEFAULT_ANNOTATION_FONT_SIZE,
  DEFAULT_ANNOTATION_TEXT,
  MAX_ANNOTATION_FONT_SIZE,
  MIN_ANNOTATION_FONT_SIZE,
  normalizeAnnotationConfig,
  normalizeAnnotationFontSize,
} from '../utils/annotation';

const PORT_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

type CardColorTarget = 'background' | 'border';

function getNextInputName(inputs: PortDefinition[]): string {
  const existing = new Set(inputs.map((input) => input.name));
  let index = 1;
  let candidate = 'input';
  while (existing.has(candidate)) {
    index += 1;
    candidate = `input${index}`;
  }
  return candidate;
}

function reconcileInlineOutputPorts(
  node: GraphNode,
  code: string,
  graphConnections: Array<{
    sourceNodeId: string;
    sourcePort: string;
  }>
): PortDefinition[] {
  const inferredNames = inferInlineOutputPortNames(code);
  if (inferredNames.length === 0) {
    return node.metadata.outputs;
  }

  const existingByName = new Map(node.metadata.outputs.map((port) => [port.name, port]));
  const connectedOutputNames = new Set(
    graphConnections
      .filter((connection) => connection.sourceNodeId === node.id)
      .map((connection) => connection.sourcePort)
  );

  const orderedNames: string[] = [];
  const seen = new Set<string>();
  const pushUnique = (name: string) => {
    if (seen.has(name)) {
      return;
    }
    seen.add(name);
    orderedNames.push(name);
  };

  for (const name of inferredNames) {
    pushUnique(name);
  }
  for (const port of node.metadata.outputs) {
    if (connectedOutputNames.has(port.name)) {
      pushUnique(port.name);
    }
  }

  return orderedNames.map((name) => {
    const existing = existingByName.get(name);
    if (existing) {
      return existing;
    }
    return {
      name,
      schema: { type: 'object' },
    };
  });
}

function formatDebugMetricValue(value: number | null, maxFractionDigits = 2): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '-';
  }

  if (Number.isInteger(value)) {
    return String(value);
  }

  return value.toFixed(maxFractionDigits);
}

function formatDebugPixelList(values: number[]): string {
  if (!Array.isArray(values) || values.length === 0) {
    return '-';
  }

  const preview = values.slice(0, 8).join(', ');
  return values.length > 8 ? `${preview}, ...` : preview;
}

function formatSelectedNodeSetSummary(nodes: GraphNode[]): string {
  if (nodes.length === 0) {
    return 'No nodes selected';
  }

  const previewNames = nodes.slice(0, 3).map((node) => node.metadata.name).join(', ');
  const suffix = nodes.length > 3 ? ', ...' : '';
  return `${nodes.length} selected (${previewNames}${suffix})`;
}

interface NodePanelProps {
  embedded?: boolean;
  showGraphSection?: boolean;
}

type AnnotationColorTarget = 'background' | 'border' | 'font';

function NodePanel({ embedded = false, showGraphSection = true }: NodePanelProps) {
  const {
    graph,
    graphSummaries,
    updateGraph,
    graphNameValue,
    setGraphNameValue,
    newGraphName,
    setNewGraphName,
    pythonEnvDrafts,
    pythonEnvValidationError,
    isGraphActionInFlight,
    isDeleteGraphConfirming,
    commitGraphName,
    handleSelectGraph,
    handleCreateGraph,
    requestDeleteCurrentGraph,
    cancelDeleteCurrentGraph,
    handleDeleteCurrentGraph,
    updatePythonEnvDraftField,
    addPythonEnvDraft,
    deletePythonEnvDraft,
    commitPythonEnvs,
  } = useGraphManagementState({ enabled: showGraphSection });
  const selectedNodeId = useGraphStore((state) => state.selectedNodeId);
  const selectedNodeIds = useGraphStore((state) => state.selectedNodeIds);
  const selectedDrawingId = useGraphStore((state) => state.selectedDrawingId);
  const updateNode = useGraphStore((state) => state.updateNode);
  const addNode = useGraphStore((state) => state.addNode);
  const updateDrawing = useGraphStore((state) => state.updateDrawing);
  const deleteDrawing = useGraphStore((state) => state.deleteDrawing);
  const computeNode = useGraphStore((state) => state.computeNode);
  const nodeExecutionState = useGraphStore((state) =>
    selectedNodeId ? state.nodeExecutionStates[selectedNodeId] : null
  );
  const selectedNodeGraphicsDebug = useGraphStore((state) => state.selectedNodeGraphicsDebug);

  const selectedNode = graph?.nodes.find((node) => node.id === selectedNodeId) || null;
  const selectedNodeMap = new Map((graph?.nodes ?? []).map((node) => [node.id, node]));
  const selectedNodes = selectedNodeIds.flatMap((nodeId) => {
    const node = selectedNodeMap.get(nodeId);
    return node ? [node] : [];
  });
  const firstSelectedNodeAppearance = selectedNodes[0]
    ? resolveNodeCardAppearance(selectedNodes[0])
    : null;
  const hasFirstSelectedNodeAppearance = firstSelectedNodeAppearance !== null;
  const firstSelectedNodeBackgroundColor = firstSelectedNodeAppearance?.backgroundColor ?? DEFAULT_NODE_CARD_BACKGROUND_COLOR;
  const firstSelectedNodeBorderColor = firstSelectedNodeAppearance?.borderColor ?? DEFAULT_NODE_CARD_BORDER_COLOR;
  const selectedDrawing = graph?.drawings?.find((drawing) => drawing.id === selectedDrawingId) || null;
  const isMultiNodeSelection = selectedNodes.length > 1;
  const selectedNodeSetSummary = formatSelectedNodeSetSummary(selectedNodes);

  const [codeValue, setCodeValue] = useState('');
  const [nodeNameValue, setNodeNameValue] = useState('');
  const [cardBackgroundColorDraft, setCardBackgroundColorDraft] = useState(DEFAULT_NODE_CARD_BACKGROUND_COLOR);
  const [cardBorderColorDraft, setCardBorderColorDraft] = useState(DEFAULT_NODE_CARD_BORDER_COLOR);
  const [cardColorDialogTarget, setCardColorDialogTarget] = useState<CardColorTarget | null>(null);
  const [numericValueDraft, setNumericValueDraft] = useState('0');
  const [numericMinDraft, setNumericMinDraft] = useState('0');
  const [numericMaxDraft, setNumericMaxDraft] = useState('100');
  const [numericStepDraft, setNumericStepDraft] = useState('1');
  const [annotationTextDraft, setAnnotationTextDraft] = useState(DEFAULT_ANNOTATION_TEXT);
  const [annotationBackgroundColorDraft, setAnnotationBackgroundColorDraft] = useState(
    DEFAULT_ANNOTATION_BACKGROUND_COLOR
  );
  const [annotationBorderColorDraft, setAnnotationBorderColorDraft] = useState(
    DEFAULT_ANNOTATION_BORDER_COLOR
  );
  const [annotationFontColorDraft, setAnnotationFontColorDraft] = useState(DEFAULT_ANNOTATION_FONT_COLOR);
  const [annotationFontSizeDraft, setAnnotationFontSizeDraft] = useState(String(DEFAULT_ANNOTATION_FONT_SIZE));
  const [annotationColorDialogTarget, setAnnotationColorDialogTarget] = useState<AnnotationColorTarget | null>(null);
  const [drawingNameValue, setDrawingNameValue] = useState('');
  const [inputDraftNames, setInputDraftNames] = useState<string[]>([]);
  const [inputValidationError, setInputValidationError] = useState<string | null>(null);
  const [isGraphicsDebugExpanded, setIsGraphicsDebugExpanded] = useState(false);
  const hydratedNodeDraftSourceRef = useRef<string>('__init__');
  const selectedNodeAppearanceSourceKey = selectedNodes.map((node) => `${node.id}:${node.version}`).join('|') || 'none';

  useEffect(() => {
    const draftSourceKey = selectedNode
      ? `${selectedNode.id}:${selectedNode.version}`
      : 'none';
    if (hydratedNodeDraftSourceRef.current === draftSourceKey) {
      return;
    }
    hydratedNodeDraftSourceRef.current = draftSourceKey;

    if (selectedNode?.config.code !== undefined) {
      setCodeValue(selectedNode.config.code);
    } else {
      setCodeValue('');
    }

    if (selectedNode?.metadata.name) {
      setNodeNameValue(selectedNode.metadata.name);
    } else {
      setNodeNameValue('');
    }

    if (selectedNode) {
      setInputDraftNames(selectedNode.metadata.inputs.map((input) => input.name));
    } else {
      setInputDraftNames([]);
    }

    if (selectedNode?.config.type === NodeType.NUMERIC_INPUT) {
      const numericConfig = normalizeNumericInputConfig(
        selectedNode.config.config as Record<string, unknown> | undefined
      );
      setNumericValueDraft(String(numericConfig.value));
      setNumericMinDraft(String(numericConfig.min));
      setNumericMaxDraft(String(numericConfig.max));
      setNumericStepDraft(String(numericConfig.step));
    }

    if (selectedNode?.config.type === NodeType.ANNOTATION) {
      const annotationConfig = normalizeAnnotationConfig(
        selectedNode.config.config as Record<string, unknown> | undefined
      );
      setAnnotationTextDraft(annotationConfig.text);
      setAnnotationBackgroundColorDraft(annotationConfig.backgroundColor);
      setAnnotationBorderColorDraft(annotationConfig.borderColor);
      setAnnotationFontColorDraft(annotationConfig.fontColor);
      setAnnotationFontSizeDraft(String(annotationConfig.fontSize));
    }

    setInputValidationError(null);
  }, [selectedNode]);

  useEffect(() => {
    if (!hasFirstSelectedNodeAppearance) {
      setCardBackgroundColorDraft(DEFAULT_NODE_CARD_BACKGROUND_COLOR);
      setCardBorderColorDraft(DEFAULT_NODE_CARD_BORDER_COLOR);
      return;
    }

    setCardBackgroundColorDraft(firstSelectedNodeBackgroundColor);
    setCardBorderColorDraft(firstSelectedNodeBorderColor);
  }, [
    firstSelectedNodeBackgroundColor,
    firstSelectedNodeBorderColor,
    hasFirstSelectedNodeAppearance,
    selectedNodeAppearanceSourceKey,
  ]);

  useEffect(() => {
    if (selectedDrawing) {
      setDrawingNameValue(selectedDrawing.name);
    } else {
      setDrawingNameValue('');
    }
  }, [selectedDrawing]);

  useEffect(() => {
    setIsGraphicsDebugExpanded(false);
  }, [selectedNodeId]);

  const commitInlineCode = useCallback(() => {
    if (!selectedNode || selectedNode.config.type !== NodeType.INLINE_CODE) {
      return;
    }

    const currentCode = selectedNode.config.code ?? '';
    if (codeValue === currentCode) {
      return;
    }

    const nextOutputs = reconcileInlineOutputPorts(selectedNode, codeValue, graph?.connections ?? []);
    const outputNamesChanged =
      nextOutputs.length !== selectedNode.metadata.outputs.length ||
      nextOutputs.some((output, index) => output.name !== selectedNode.metadata.outputs[index]?.name);

    updateNode(selectedNode.id, {
      config: {
        ...selectedNode.config,
        code: codeValue,
      },
      ...(outputNamesChanged
        ? {
            metadata: {
              ...selectedNode.metadata,
              outputs: nextOutputs,
            },
          }
        : {}),
    });
  }, [codeValue, graph?.connections, selectedNode, updateNode]);

  const updateSelectedNodeInputs = useCallback((
    nextInputs: PortDefinition[],
    connectionMapper?: (node: GraphNode, connection: any) => any | null
  ) => {
    if (!graph || !selectedNode) {
      return;
    }

    const nextNodes = graph.nodes.map((node) => {
      if (node.id !== selectedNode.id) {
        return node;
      }
      return {
        ...node,
        metadata: {
          ...node.metadata,
          inputs: nextInputs,
        },
        version: Date.now().toString(),
      };
    });

    let nextConnections = graph.connections;
    if (connectionMapper) {
      nextConnections = graph.connections
        .map((connection) => connectionMapper(selectedNode, connection))
        .filter((connection): connection is NonNullable<typeof connection> => connection !== null);
    }

    void updateGraph({
      ...graph,
      nodes: nextNodes,
      connections: nextConnections,
      updatedAt: Date.now(),
    });
  }, [graph, selectedNode, updateGraph]);

  const commitNodeName = useCallback(() => {
    if (!selectedNode) {
      return;
    }

    const trimmedName = nodeNameValue.trim();
    if (!trimmedName) {
      setNodeNameValue(selectedNode.metadata.name);
      return;
    }

    if (trimmedName !== selectedNode.metadata.name) {
      updateNode(selectedNode.id, {
        metadata: {
          ...selectedNode.metadata,
          name: trimmedName,
        },
      });
    }
  }, [nodeNameValue, selectedNode, updateNode]);

  const commitDrawingName = useCallback(() => {
    if (!selectedDrawing) {
      return;
    }

    const trimmedName = drawingNameValue.trim();
    if (!trimmedName) {
      setDrawingNameValue(selectedDrawing.name);
      return;
    }

    if (trimmedName !== selectedDrawing.name) {
      updateDrawing(selectedDrawing.id, { name: trimmedName });
    }
  }, [drawingNameValue, selectedDrawing, updateDrawing]);

  const setAutoRecompute = useCallback((enabled: boolean) => {
    if (!selectedNode) {
      return;
    }

    updateNode(selectedNode.id, {
      config: {
        ...selectedNode.config,
        config: {
          ...(selectedNode.config.config || {}),
          autoRecompute: enabled,
        },
      },
    });
  }, [selectedNode, updateNode]);

  const commitNumericInputConfig = useCallback(() => {
    if (!selectedNode || selectedNode.config.type !== NodeType.NUMERIC_INPUT) {
      return;
    }

    const current = normalizeNumericInputConfig(
      selectedNode.config.config as Record<string, unknown> | undefined
    );

    const parsedValue = Number.parseFloat(numericValueDraft);
    const parsedMin = Number.parseFloat(numericMinDraft);
    const parsedMax = Number.parseFloat(numericMaxDraft);
    const parsedStep = Number.parseFloat(numericStepDraft);

    const next = normalizeNumericInputConfig({
      value: Number.isFinite(parsedValue) ? parsedValue : current.value,
      min: Number.isFinite(parsedMin) ? parsedMin : current.min,
      max: Number.isFinite(parsedMax) ? parsedMax : current.max,
      step: Number.isFinite(parsedStep) ? parsedStep : current.step,
    });

    setNumericValueDraft(String(next.value));
    setNumericMinDraft(String(next.min));
    setNumericMaxDraft(String(next.max));
    setNumericStepDraft(String(next.step));

    if (
      next.value === current.value &&
      next.min === current.min &&
      next.max === current.max &&
      next.step === current.step
    ) {
      return;
    }

    updateNode(selectedNode.id, {
      config: {
        ...selectedNode.config,
        config: {
          ...(selectedNode.config.config || {}),
          value: next.value,
          min: next.min,
          max: next.max,
          step: next.step,
        },
      },
    });
  }, [
    numericMaxDraft,
    numericMinDraft,
    numericStepDraft,
    numericValueDraft,
    selectedNode,
    updateNode,
  ]);

  const resetNumericInputDrafts = useCallback(() => {
    if (!selectedNode || selectedNode.config.type !== NodeType.NUMERIC_INPUT) {
      return;
    }

    const current = normalizeNumericInputConfig(
      selectedNode.config.config as Record<string, unknown> | undefined
    );
    setNumericValueDraft(String(current.value));
    setNumericMinDraft(String(current.min));
    setNumericMaxDraft(String(current.max));
    setNumericStepDraft(String(current.step));
  }, [selectedNode]);

  const commitAnnotationSettings = useCallback((overrides?: {
    text?: string;
    backgroundColor?: string;
    borderColor?: string;
    fontColor?: string;
    fontSize?: number;
  }) => {
    if (!selectedNode || selectedNode.config.type !== NodeType.ANNOTATION) {
      return;
    }

    const current = normalizeAnnotationConfig(
      selectedNode.config.config as Record<string, unknown> | undefined
    );
    const parsedDraftFontSize = Number.parseFloat(annotationFontSizeDraft);
    const draftFontSize = Number.isFinite(parsedDraftFontSize) ? parsedDraftFontSize : current.fontSize;
    const next = {
      text: overrides?.text ?? annotationTextDraft,
      backgroundColor: normalizeColorString(
        overrides?.backgroundColor ?? annotationBackgroundColorDraft,
        DEFAULT_ANNOTATION_BACKGROUND_COLOR
      ),
      borderColor: normalizeColorString(
        overrides?.borderColor ?? annotationBorderColorDraft,
        DEFAULT_ANNOTATION_BORDER_COLOR
      ),
      fontColor: normalizeColorString(
        overrides?.fontColor ?? annotationFontColorDraft,
        DEFAULT_ANNOTATION_FONT_COLOR
      ),
      fontSize: normalizeAnnotationFontSize(overrides?.fontSize ?? draftFontSize, current.fontSize),
    };

    setAnnotationTextDraft(next.text);
    setAnnotationBackgroundColorDraft(next.backgroundColor);
    setAnnotationBorderColorDraft(next.borderColor);
    setAnnotationFontColorDraft(next.fontColor);
    setAnnotationFontSizeDraft(String(next.fontSize));

    if (
      next.text === current.text &&
      next.backgroundColor === current.backgroundColor &&
      next.borderColor === current.borderColor &&
      next.fontColor === current.fontColor &&
      next.fontSize === current.fontSize
    ) {
      return;
    }

    updateNode(selectedNode.id, {
      config: {
        ...selectedNode.config,
        config: {
          ...(selectedNode.config.config ?? {}),
          text: next.text,
          backgroundColor: next.backgroundColor,
          borderColor: next.borderColor,
          fontColor: next.fontColor,
          fontSize: next.fontSize,
        },
      },
    });
  }, [
    annotationBackgroundColorDraft,
    annotationBorderColorDraft,
    annotationFontColorDraft,
    annotationFontSizeDraft,
    annotationTextDraft,
    selectedNode,
    updateNode,
  ]);

  const addInputPort = useCallback(() => {
    if (!selectedNode) {
      return;
    }

    const nextName = getNextInputName(selectedNode.metadata.inputs);
    const nextInputs = [
      ...selectedNode.metadata.inputs,
      {
        name: nextName,
        schema: { type: 'object' as const },
      },
    ];

    setInputDraftNames(nextInputs.map((input) => input.name));
    setInputValidationError(null);
    updateSelectedNodeInputs(nextInputs);
  }, [selectedNode, updateSelectedNodeInputs]);

  const moveInputPort = useCallback((index: number, direction: 'up' | 'down') => {
    if (!selectedNode) {
      return;
    }

    const nextIndex = direction === 'up' ? index - 1 : index + 1;
    if (nextIndex < 0 || nextIndex >= selectedNode.metadata.inputs.length) {
      return;
    }

    const nextInputs = [...selectedNode.metadata.inputs];
    [nextInputs[index], nextInputs[nextIndex]] = [nextInputs[nextIndex], nextInputs[index]];

    setInputDraftNames(nextInputs.map((input) => input.name));
    setInputValidationError(null);
    updateSelectedNodeInputs(nextInputs);
  }, [selectedNode, updateSelectedNodeInputs]);

  const deleteInputPort = useCallback((index: number) => {
    if (!selectedNode) {
      return;
    }

    const targetInput = selectedNode.metadata.inputs[index];
    if (!targetInput) {
      return;
    }

    const nextInputs = selectedNode.metadata.inputs.filter((_, inputIndex) => inputIndex !== index);

    setInputDraftNames(nextInputs.map((input) => input.name));
    setInputValidationError(null);

    updateSelectedNodeInputs(nextInputs, (node, connection) => {
      if (connection.targetNodeId === node.id && connection.targetPort === targetInput.name) {
        return null;
      }
      return connection;
    });
  }, [selectedNode, updateSelectedNodeInputs]);

  const commitInputName = useCallback((index: number) => {
    if (!selectedNode) {
      return;
    }

    const currentInput = selectedNode.metadata.inputs[index];
    const draftName = inputDraftNames[index] ?? '';
    if (!currentInput) {
      return;
    }

    const normalizedName = draftName.trim();
    if (!normalizedName) {
      setInputValidationError('Input name cannot be empty.');
      setInputDraftNames(selectedNode.metadata.inputs.map((input) => input.name));
      return;
    }

    if (!PORT_NAME_PATTERN.test(normalizedName)) {
      setInputValidationError('Input name must start with a letter/underscore and use only letters, numbers, and underscores.');
      setInputDraftNames(selectedNode.metadata.inputs.map((input) => input.name));
      return;
    }

    const duplicateExists = selectedNode.metadata.inputs.some((input, inputIndex) =>
      inputIndex !== index && input.name === normalizedName
    );

    if (duplicateExists) {
      setInputValidationError(`Input name "${normalizedName}" already exists on this node.`);
      setInputDraftNames(selectedNode.metadata.inputs.map((input) => input.name));
      return;
    }

    if (normalizedName === currentInput.name) {
      setInputValidationError(null);
      return;
    }

    const nextInputs = selectedNode.metadata.inputs.map((input, inputIndex) => {
      if (inputIndex !== index) {
        return input;
      }
      return {
        ...input,
        name: normalizedName,
      };
    });

    setInputDraftNames(nextInputs.map((input) => input.name));
    setInputValidationError(null);

    updateSelectedNodeInputs(nextInputs, (node, connection) => {
      if (connection.targetNodeId === node.id && connection.targetPort === currentInput.name) {
        return {
          ...connection,
          targetPort: normalizedName,
        };
      }
      return connection;
    });
  }, [inputDraftNames, selectedNode, updateSelectedNodeInputs]);

  const handleAddInlineCodeNode = () => {
    if (!graph) return;

    const gridSize = 50;
    const nodeWidth = 200;
    const nodeHeight = 150;
    let newPosition = { x: 100, y: 100 };

    let attempts = 0;
    const maxAttempts = 100;

    while (attempts < maxAttempts) {
      const overlapping = graph.nodes.some((node) => {
        const xOverlap = Math.abs(node.position.x - newPosition.x) < nodeWidth;
        const yOverlap = Math.abs(node.position.y - newPosition.y) < nodeHeight;
        return xOverlap && yOverlap;
      });

      if (!overlapping) {
        break;
      }

      const angle = (attempts * 137.5) * (Math.PI / 180);
      const radius = gridSize + (attempts * 20);
      newPosition = {
        x: 300 + Math.cos(angle) * radius,
        y: 300 + Math.sin(angle) * radius,
      };

      attempts += 1;
    }

    const newNode = createInlineCodeNode({ position: newPosition });
    addNode(newNode);
  };

  const autoRecomputeEnabled = Boolean(selectedNode?.config.config?.autoRecompute);
  const isNumericInputNode = selectedNode?.config.type === NodeType.NUMERIC_INPUT;
  const isAnnotationNode = selectedNode?.config.type === NodeType.ANNOTATION;
  const selectedNodeAppearances = selectedNodes.map((node) => resolveNodeCardAppearance(node));
  const hasMixedCardBackgroundColor = new Set(
    selectedNodeAppearances.map((appearance) => appearance.backgroundColor)
  ).size > 1;
  const hasMixedCardBorderColor = new Set(
    selectedNodeAppearances.map((appearance) => appearance.borderColor)
  ).size > 1;
  const showNodeCardColorSection = selectedNodes.length > 0 && (isMultiNodeSelection || !isAnnotationNode);
  const supportsExecutionControls = Boolean(selectedNode && !isAnnotationNode);
  const supportsInputEditing = Boolean(selectedNode && !isNumericInputNode && !isAnnotationNode);
  const graphPythonEnvs = graph?.pythonEnvs ?? [];
  const selectedPythonEnvExists = Boolean(
    selectedNode?.config.pythonEnv &&
      graphPythonEnvs.some((env) => env.name === selectedNode.config.pythonEnv)
  );
  const statusLightColor = nodeExecutionState?.hasError
    ? '#ef4444'
    : (nodeExecutionState?.isPending || nodeExecutionState?.isComputing)
      ? '#f59e0b'
      : nodeExecutionState?.isStale
        ? '#8b5a2b'
      : autoRecomputeEnabled
        ? '#22c55e'
        : '#94a3b8';
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
    ? annotationBackgroundColorDraft
    : annotationColorDialogTarget === 'border'
      ? annotationBorderColorDraft
      : annotationFontColorDraft;
  const cardColorDialogOpen = cardColorDialogTarget !== null;
  const cardColorDialogTitle = cardColorDialogTarget === 'background'
    ? isMultiNodeSelection
      ? 'Selected Card Background'
      : 'Card Background'
    : isMultiNodeSelection
      ? 'Selected Card Border'
      : 'Card Border';
  const cardColorDialogDefaultColor = cardColorDialogTarget === 'background'
    ? DEFAULT_NODE_CARD_BACKGROUND_COLOR
    : DEFAULT_NODE_CARD_BORDER_COLOR;
  const cardColorDialogInitialColor = cardColorDialogTarget === 'background'
    ? cardBackgroundColorDraft
    : cardBorderColorDraft;

  const applyAnnotationColorFromDialog = (color: string) => {
    if (annotationColorDialogTarget === 'background') {
      setAnnotationBackgroundColorDraft(color);
      commitAnnotationSettings({ backgroundColor: color });
    } else if (annotationColorDialogTarget === 'border') {
      setAnnotationBorderColorDraft(color);
      commitAnnotationSettings({ borderColor: color });
    } else if (annotationColorDialogTarget === 'font') {
      setAnnotationFontColorDraft(color);
      commitAnnotationSettings({ fontColor: color });
    }
    setAnnotationColorDialogTarget(null);
  };

  const commitSelectedNodeCardColors = useCallback((overrides: {
    backgroundColor?: string;
    borderColor?: string;
  }) => {
    if (!graph || selectedNodes.length === 0) {
      return;
    }

    const nextBackgroundColor = overrides.backgroundColor !== undefined
      ? normalizeColorString(overrides.backgroundColor, DEFAULT_NODE_CARD_BACKGROUND_COLOR)
      : undefined;
    const nextBorderColor = overrides.borderColor !== undefined
      ? normalizeColorString(overrides.borderColor, DEFAULT_NODE_CARD_BORDER_COLOR)
      : undefined;

    if (nextBackgroundColor !== undefined) {
      setCardBackgroundColorDraft(nextBackgroundColor);
    }
    if (nextBorderColor !== undefined) {
      setCardBorderColorDraft(nextBorderColor);
    }

    const selectedNodeIdSet = new Set(selectedNodes.map((node) => node.id));
    let didChange = false;
    const version = Date.now().toString();
    const nextNodes = graph.nodes.map((node) => {
      if (!selectedNodeIdSet.has(node.id)) {
        return node;
      }

      const currentAppearance = resolveNodeCardAppearance(node);
      const resolvedBackgroundColor = nextBackgroundColor ?? currentAppearance.backgroundColor;
      const resolvedBorderColor = nextBorderColor ?? currentAppearance.borderColor;
      if (
        resolvedBackgroundColor === currentAppearance.backgroundColor &&
        resolvedBorderColor === currentAppearance.borderColor
      ) {
        return node;
      }

      didChange = true;
      return {
        ...node,
        config: {
          ...node.config,
          config: {
            ...(node.config.config ?? {}),
            backgroundColor: resolvedBackgroundColor,
            borderColor: resolvedBorderColor,
          },
        },
        version,
      };
    });

    if (!didChange) {
      return;
    }

    void updateGraph({
      ...graph,
      nodes: nextNodes,
      updatedAt: Date.now(),
    });
  }, [graph, selectedNodes, updateGraph]);

  const applyNodeCardColorFromDialog = (color: string) => {
    if (cardColorDialogTarget === 'background') {
      commitSelectedNodeCardColors({ backgroundColor: color });
    } else if (cardColorDialogTarget === 'border') {
      commitSelectedNodeCardColors({ borderColor: color });
    }
    setCardColorDialogTarget(null);
  };

  const nodeCardColorSection = showNodeCardColorSection ? (
    <div style={{
      marginBottom: '16px',
      padding: '10px',
      border: '1px solid #e2e8f0',
      borderRadius: '6px',
      background: '#fff',
    }}>
      <div style={{ fontWeight: 'bold', fontSize: '12px', marginBottom: '10px' }}>
        Card Colors
      </div>
      {isMultiNodeSelection && (
        <div style={{ marginBottom: '10px', fontSize: '11px', color: '#64748b', lineHeight: 1.4 }}>
          Applies to all selected node cards.
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '8px' }}>
        <button
          data-testid="node-card-background-color-input"
          type="button"
          onClick={() => setCardColorDialogTarget('background')}
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
          <span>{hasMixedCardBackgroundColor ? 'Background (mixed)' : 'Background'}</span>
          <span
            style={{
              width: '14px',
              height: '14px',
              borderRadius: '50%',
              border: '1px solid #334155',
              background: cardBackgroundColorDraft,
              flexShrink: 0,
            }}
          />
        </button>
        <button
          data-testid="node-card-border-color-input"
          type="button"
          onClick={() => setCardColorDialogTarget('border')}
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
          <span>{hasMixedCardBorderColor ? 'Border (mixed)' : 'Border'}</span>
          <span
            style={{
              width: '14px',
              height: '14px',
              borderRadius: '50%',
              border: '1px solid #334155',
              background: cardBorderColorDraft,
              flexShrink: 0,
            }}
          />
        </button>
      </div>
    </div>
  ) : null;

  return (
    <div
      data-testid="node-panel"
      style={embedded
        ? {}
        : {
            width: '300px',
            background: '#f9f9f9',
            borderLeft: '1px solid #ddd',
            padding: '16px',
            overflowY: 'auto',
          }}
    >
      {!embedded && <h3 style={{ marginBottom: '16px' }}>Node Panel</h3>}
      {showGraphSection && (
        <div
          style={{
            marginBottom: '16px',
            padding: '10px',
            border: '1px solid #dbe4ef',
            borderRadius: '6px',
            background: '#fff',
          }}
        >
          <div style={{ fontSize: '12px', fontWeight: 700, marginBottom: '8px', color: '#334155' }}>
            Graph
          </div>
          <GraphManagementControls
            graphId={graph?.id ?? null}
            graphName={graph?.name ?? ''}
            graphSummaries={graphSummaries}
            graphNameValue={graphNameValue}
            newGraphName={newGraphName}
            isGraphActionInFlight={isGraphActionInFlight}
            isDeleteGraphConfirming={isDeleteGraphConfirming}
            onSelectGraph={handleSelectGraph}
            onGraphNameChange={setGraphNameValue}
            onCommitGraphName={commitGraphName}
            onDeleteRequest={requestDeleteCurrentGraph}
            onDeleteCancel={cancelDeleteCurrentGraph}
            onDeleteConfirm={handleDeleteCurrentGraph}
            onNewGraphNameChange={setNewGraphName}
            onCreateGraph={handleCreateGraph}
          />
          <PythonEnvironmentSection
            pythonEnvDrafts={pythonEnvDrafts}
            validationError={pythonEnvValidationError}
            disableAdd={isGraphActionInFlight}
            disableSave={isGraphActionInFlight || !graph}
            onUpdateField={updatePythonEnvDraftField}
            onAdd={addPythonEnvDraft}
            onDelete={deletePythonEnvDraft}
            onSave={commitPythonEnvs}
          />
          {graph && (
            <div style={{ marginTop: '8px', fontSize: '10px', color: '#64748b' }}>
              Current graph ID: <code>{graph.id}</code>
            </div>
          )}
        </div>
      )}

      {isMultiNodeSelection ? (
        <div>
          <h4
            data-testid="multi-node-selection-summary"
            style={{ marginBottom: '12px', lineHeight: 1.35 }}
          >
            {selectedNodeSetSummary}
          </h4>

          <div
            style={{
              marginBottom: '12px',
              padding: '10px',
              border: '1px solid #e2e8f0',
              borderRadius: '6px',
              background: '#fff',
              fontSize: '12px',
              color: '#334155',
              lineHeight: 1.5,
            }}
          >
            <div>Selection size: {selectedNodes.length}</div>
            <div>Editor actions in this view apply to the full selected set.</div>
          </div>

          {nodeCardColorSection}
        </div>
      ) : selectedNode ? (
        <div>
          <div style={{ marginBottom: '12px' }}>
            <label style={{ display: 'block', marginBottom: '6px', fontWeight: 'bold' }}>Card Name:</label>
            <input
              data-testid="node-name-input"
              type="text"
              value={nodeNameValue}
              onChange={(event) => setNodeNameValue(event.target.value)}
              onBlur={commitNodeName}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.currentTarget.blur();
                }
                if (event.key === 'Escape') {
                  setNodeNameValue(selectedNode.metadata.name);
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

          {nodeCardColorSection}

          {supportsExecutionControls && (
            <div style={{
              marginBottom: '16px',
              padding: '10px',
              border: '1px solid #e2e8f0',
              borderRadius: '6px',
              background: '#fff',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ fontSize: '12px', color: '#334155', fontWeight: 600 }}>Execution Status</span>
                <span style={{
                  width: '10px',
                  height: '10px',
                  borderRadius: '50%',
                  background: statusLightColor,
                  border: '1px solid rgba(0,0,0,0.15)',
                  display: 'inline-block',
                }} />
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px' }}>
                <input
                  data-testid="auto-recompute-toggle"
                  type="checkbox"
                  checked={autoRecomputeEnabled}
                  onChange={(event) => setAutoRecompute(event.target.checked)}
                />
                Auto recompute when upstream changes
              </label>
              {nodeExecutionState?.hasError && nodeExecutionState.errorMessage && (
                <div
                  data-testid="node-execution-error"
                  style={{
                    marginTop: '8px',
                    color: '#b91c1c',
                    fontSize: '11px',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                  }}
                >
                  {nodeExecutionState.errorMessage}
                </div>
              )}
              <button
                data-testid="run-selected-node-button"
                onClick={() => {
                  void computeNode(selectedNode.id);
                }}
                style={{
                  marginTop: '10px',
                  width: '100%',
                  padding: '8px',
                  background: '#0ea5e9',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '12px',
                }}
              >
                Run Selected Node
              </button>
              {selectedNodeGraphicsDebug && selectedNodeGraphicsDebug.nodeId === selectedNode.id && (
                <div
                  data-testid="node-graphics-debug"
                  style={{
                    marginTop: '10px',
                    padding: '8px',
                    borderRadius: '4px',
                    border: '1px solid #dbe4ef',
                    background: '#f8fafc',
                    fontSize: '10px',
                    fontFamily: 'monospace',
                    color: '#334155',
                    lineHeight: 1.35,
                    wordBreak: 'break-word',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: isGraphicsDebugExpanded ? '6px' : '0',
                    }}
                  >
                    <span style={{ fontWeight: 700 }}>Graphics Budget Debug</span>
                    <button
                      data-testid="node-graphics-debug-toggle"
                      onClick={() => {
                        setIsGraphicsDebugExpanded((value) => !value);
                      }}
                      style={{
                        border: '1px solid #cbd5e1',
                        borderRadius: '4px',
                        background: '#f8fafc',
                        padding: '3px 8px',
                        fontSize: '10px',
                        color: '#334155',
                        cursor: 'pointer',
                      }}
                    >
                      {isGraphicsDebugExpanded ? 'Hide details' : 'Show details'}
                    </button>
                  </div>
                  {isGraphicsDebugExpanded && (
                    <>
                      <div>hasGraphicsOutput: {selectedNodeGraphicsDebug.hasGraphicsOutput ? 'true' : 'false'}</div>
                      <div>isRenderableGraphics: {selectedNodeGraphicsDebug.isRenderableGraphics ? 'true' : 'false'}</div>
                      <div>graphicsId: {selectedNodeGraphicsDebug.graphicsId ?? '-'}</div>
                      <div>mimeType: {selectedNodeGraphicsDebug.mimeType ?? '-'}</div>
                      <div>levelCount: {selectedNodeGraphicsDebug.levelCount}</div>
                      <div>levelPixels: {formatDebugPixelList(selectedNodeGraphicsDebug.levelPixels)}</div>
                      <div>viewportScale: {formatDebugMetricValue(selectedNodeGraphicsDebug.viewportScale, 4)}</div>
                      <div>projectionWidth: {formatDebugMetricValue(selectedNodeGraphicsDebug.projectionWidth)}</div>
                      <div>projectedWidthOnScreen: {formatDebugMetricValue(selectedNodeGraphicsDebug.projectedWidthOnScreen, 2)}</div>
                      <div>devicePixelRatio: {formatDebugMetricValue(selectedNodeGraphicsDebug.devicePixelRatio, 2)}</div>
                      <div>estimatedMaxPixels: {formatDebugMetricValue(selectedNodeGraphicsDebug.estimatedMaxPixels)}</div>
                      <div>stableMaxPixels: {formatDebugMetricValue(selectedNodeGraphicsDebug.stableMaxPixels)}</div>
                      <div>selectedLevel: {formatDebugMetricValue(selectedNodeGraphicsDebug.selectedLevel)}</div>
                      <div>selectedLevelPixels: {formatDebugMetricValue(selectedNodeGraphicsDebug.selectedLevelPixels)}</div>
                      <div>shouldLoadByViewport: {selectedNodeGraphicsDebug.shouldLoadProjectedGraphicsByViewport ? 'true' : 'false'}</div>
                      <div>canReloadProjectedGraphics: {selectedNodeGraphicsDebug.canReloadProjectedGraphics ? 'true' : 'false'}</div>
                      <div>shouldLoadProjectedGraphics: {selectedNodeGraphicsDebug.shouldLoadProjectedGraphics ? 'true' : 'false'}</div>
                      <div>requestUrl: {selectedNodeGraphicsDebug.requestUrl ?? '-'}</div>
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {!isAnnotationNode && (
            <div style={{
              marginBottom: '16px',
              padding: '10px',
              border: '1px solid #e2e8f0',
              borderRadius: '6px',
              background: '#fff',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <span style={{ fontWeight: 'bold', fontSize: '12px' }}>Inputs</span>
                <button
                  data-testid="add-input-button"
                  onClick={addInputPort}
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
                        onBlur={() => commitInputName(index)}
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
                        onClick={() => moveInputPort(index, 'up')}
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
                        onClick={() => moveInputPort(index, 'down')}
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
                        onClick={() => deleteInputPort(index)}
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
                        ✕
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
          )}

          {selectedNode.config.type === NodeType.NUMERIC_INPUT && (
            <div style={{
              marginBottom: '16px',
              padding: '10px',
              border: '1px solid #e2e8f0',
              borderRadius: '6px',
              background: '#fff',
            }}>
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
                <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '11px', color: '#475569' }}>
                  Value
                  <input
                    data-testid="numeric-input-value"
                    type="number"
                    value={numericValueDraft}
                    onChange={(event) => setNumericValueDraft(event.target.value)}
                    onBlur={commitNumericInputConfig}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.currentTarget.blur();
                      }
                      if (event.key === 'Escape') {
                        resetNumericInputDrafts();
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
                <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '11px', color: '#475569' }}>
                  Step
                  <input
                    data-testid="numeric-input-step"
                    type="number"
                    value={numericStepDraft}
                    onChange={(event) => setNumericStepDraft(event.target.value)}
                    onBlur={commitNumericInputConfig}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.currentTarget.blur();
                      }
                      if (event.key === 'Escape') {
                        resetNumericInputDrafts();
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
                <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '11px', color: '#475569' }}>
                  Min
                  <input
                    data-testid="numeric-input-min"
                    type="number"
                    value={numericMinDraft}
                    onChange={(event) => setNumericMinDraft(event.target.value)}
                    onBlur={commitNumericInputConfig}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.currentTarget.blur();
                      }
                      if (event.key === 'Escape') {
                        resetNumericInputDrafts();
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
                <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '11px', color: '#475569' }}>
                  Max
                  <input
                    data-testid="numeric-input-max"
                    type="number"
                    value={numericMaxDraft}
                    onChange={(event) => setNumericMaxDraft(event.target.value)}
                    onBlur={commitNumericInputConfig}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.currentTarget.blur();
                      }
                      if (event.key === 'Escape') {
                        resetNumericInputDrafts();
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
              </div>
            </div>
          )}

          {selectedNode.config.type === NodeType.ANNOTATION && (
            <div style={{
              marginBottom: '16px',
              padding: '10px',
              border: '1px solid #e2e8f0',
              borderRadius: '6px',
              background: '#fff',
            }}>
              <div style={{ fontWeight: 'bold', fontSize: '12px', marginBottom: '10px' }}>
                Annotation Content
              </div>
              <textarea
                data-testid="annotation-markdown-input"
                value={annotationTextDraft}
                onChange={(event) => setAnnotationTextDraft(event.target.value)}
                onBlur={(event) => commitAnnotationSettings({ text: event.target.value })}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    const current = normalizeAnnotationConfig(
                      selectedNode.config.config as Record<string, unknown> | undefined
                    );
                    setAnnotationTextDraft(current.text);
                    setAnnotationBackgroundColorDraft(current.backgroundColor);
                    setAnnotationBorderColorDraft(current.borderColor);
                    setAnnotationFontColorDraft(current.fontColor);
                    setAnnotationFontSizeDraft(String(current.fontSize));
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
                <button
                  data-testid="annotation-background-color-input"
                  type="button"
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
                      background: annotationBackgroundColorDraft,
                      flexShrink: 0,
                    }}
                  />
                </button>
                <button
                  data-testid="annotation-border-color-input"
                  type="button"
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
                      background: annotationBorderColorDraft,
                      flexShrink: 0,
                    }}
                  />
                </button>
                <button
                  data-testid="annotation-font-color-input"
                  type="button"
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
                      background: annotationFontColorDraft,
                      flexShrink: 0,
                    }}
                  />
                </button>
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
                  onChange={(event) => setAnnotationFontSizeDraft(event.target.value)}
                  onBlur={() => commitAnnotationSettings()}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.currentTarget.blur();
                    }
                    if (event.key === 'Escape') {
                      const current = normalizeAnnotationConfig(
                        selectedNode.config.config as Record<string, unknown> | undefined
                      );
                      setAnnotationFontSizeDraft(String(current.fontSize));
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
          )}

          {selectedNode.config.type === NodeType.INLINE_CODE && (
            <div>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>
                Runtime:
              </label>
              <select
                value={selectedNode.config.runtime || 'javascript_vm'}
                onChange={(event) => {
                  const nextRuntime = event.target.value;
                  const nextConfig = {
                    ...selectedNode.config,
                    runtime: nextRuntime,
                    pythonEnv:
                      nextRuntime === 'python_process'
                        ? selectedNode.config.pythonEnv
                        : undefined,
                  };

                  updateNode(selectedNode.id, {
                    config: nextConfig,
                  });
                }}
                style={{
                  width: '100%',
                  padding: '8px',
                  marginBottom: '16px',
                  border: '1px solid #ddd',
                  borderRadius: '4px',
                }}
              >
                <option value="javascript_vm">JavaScript VM</option>
                <option value="python_process">Python Process</option>
              </select>
              {selectedNode.config.runtime === 'python_process' && (
                <>
                  <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>
                    Python Env:
                  </label>
                  <select
                    value={selectedNode.config.pythonEnv || ''}
                    onChange={(event) => {
                      const nextEnv = event.target.value;
                      updateNode(selectedNode.id, {
                        config: {
                          ...selectedNode.config,
                          pythonEnv: nextEnv || undefined,
                        },
                      });
                    }}
                    style={{
                      width: '100%',
                      padding: '8px',
                      marginBottom: '10px',
                      border: '1px solid #ddd',
                      borderRadius: '4px',
                    }}
                  >
                    <option value="">Default backend Python</option>
                    {graphPythonEnvs.map((env) => (
                      <option key={env.name} value={env.name}>
                        {env.name}
                      </option>
                    ))}
                  </select>
                  {selectedNode.config.pythonEnv && !selectedPythonEnvExists && (
                    <div style={{ marginBottom: '10px', color: '#b91c1c', fontSize: '11px' }}>
                      Selected env "{selectedNode.config.pythonEnv}" no longer exists on this graph.
                    </div>
                  )}
                </>
              )}
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>
                Code:
              </label>
              <textarea
                value={codeValue}
                onChange={(event) => {
                  setCodeValue(event.target.value);
                }}
                onBlur={() => {
                  commitInlineCode();
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    setCodeValue(selectedNode.config.code ?? '');
                    event.currentTarget.blur();
                  }
                }}
                style={{
                  width: '100%',
                  minHeight: '200px',
                  fontFamily: 'monospace',
                  fontSize: '12px',
                  padding: '8px',
                  border: '1px solid #ddd',
                  borderRadius: '4px',
                  boxSizing: 'border-box',
                }}
              />
            </div>
          )}
        </div>
      ) : selectedDrawing ? (
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
              onChange={(event) => setDrawingNameValue(event.target.value)}
              onBlur={commitDrawingName}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.currentTarget.blur();
                }
                if (event.key === 'Escape') {
                  setDrawingNameValue(selectedDrawing.name);
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
              marginBottom: '12px',
              padding: '10px',
              border: '1px solid #e2e8f0',
              borderRadius: '6px',
              background: '#fff',
              fontSize: '12px',
              color: '#334155',
            }}
          >
            <div>Paths: {selectedDrawing.paths.length}</div>
            <div>Position: ({Math.round(selectedDrawing.position.x)}, {Math.round(selectedDrawing.position.y)})</div>
          </div>

          <button
            data-testid="delete-selected-drawing-button"
            onClick={() => deleteDrawing(selectedDrawing.id)}
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
      ) : (
        <div>
          <p style={{ color: '#666', marginBottom: '16px' }}>Select a node or drawing to edit</p>
          <button
            onClick={handleAddInlineCodeNode}
            style={{
              width: '100%',
              padding: '12px',
              background: '#2196F3',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              marginBottom: '8px',
            }}
          >
            Add Inline Code Node
          </button>
        </div>
      )}
      <ColorSelectionDialog
        open={cardColorDialogOpen}
        title={cardColorDialogTitle}
        description={isMultiNodeSelection
          ? `Choose a color to apply across ${selectedNodes.length} selected node cards.`
          : 'Choose a card color.'}
        initialColor={cardColorDialogInitialColor}
        defaultColor={cardColorDialogDefaultColor}
        confirmLabel={isMultiNodeSelection ? `Apply to ${selectedNodes.length}` : 'Use Color'}
        allowOpacity
        onCancel={() => setCardColorDialogTarget(null)}
        onConfirm={applyNodeCardColorFromDialog}
      />
      <ColorSelectionDialog
        open={annotationColorDialogOpen}
        title={annotationColorDialogTitle}
        description="Choose annotation color and opacity."
        initialColor={annotationColorDialogInitialColor}
        defaultColor={annotationColorDialogDefaultColor}
        confirmLabel="Use Color"
        allowOpacity
        onCancel={() => setAnnotationColorDialogTarget(null)}
        onConfirm={applyAnnotationColorFromDialog}
      />
    </div>
  );
}

export default NodePanel;
