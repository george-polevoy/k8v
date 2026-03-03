import { useCallback, useEffect, useState } from 'react';
import { useGraphStore } from '../store/graphStore';
import {
  CanvasBackgroundSettings,
  GraphConnectionStrokeSettings,
  PythonEnvironment,
} from '../types';
import { normalizeCanvasBackground } from '../utils/canvasBackground';
import {
  DEFAULT_GRAPH_CONNECTION_STROKE,
  normalizeGraphConnectionStroke,
} from '../utils/connectionStroke';
import {
  applyProjectionToNodes,
  cloneProjectionNodeCardSizes,
  cloneProjectionNodePositions,
  DEFAULT_GRAPH_PROJECTION_ID,
  normalizeGraphProjectionState,
  withCanvasBackgroundInProjection,
} from '../utils/projections';
import ColorSelectionDialog from './ColorSelectionDialog';
import { v4 as uuidv4 } from 'uuid';

const MIN_RECOMPUTE_CONCURRENCY = 1;
const MAX_RECOMPUTE_CONCURRENCY = 32;
const DEFAULT_GRAPH_EXECUTION_TIMEOUT_MS = 30_000;
const DEFAULT_GRAPH_EXECUTION_TIMEOUT_SECONDS = DEFAULT_GRAPH_EXECUTION_TIMEOUT_MS / 1000;

function formatGraphOptionLabel(name: string, id: string): string {
  return `${name} (${id.slice(0, 8)})`;
}

function formatProjectionOptionLabel(name: string, id: string): string {
  if (id === DEFAULT_GRAPH_PROJECTION_ID) {
    return `${name} (${id})`;
  }
  return `${name} (${id.slice(0, 8)})`;
}

function getNextPythonEnvName(envs: PythonEnvironment[]): string {
  const existing = new Set(envs.map((env) => env.name));
  let index = 1;
  let candidate = `python_env_${index}`;
  while (existing.has(candidate)) {
    index += 1;
    candidate = `python_env_${index}`;
  }
  return candidate;
}

function getNextProjectionName(existingNames: string[]): string {
  const existing = new Set(existingNames);
  let index = 1;
  let candidate = `Projection ${index}`;
  while (existing.has(candidate)) {
    index += 1;
    candidate = `Projection ${index}`;
  }
  return candidate;
}

function normalizeRecomputeConcurrency(
  value: unknown,
  fallback = MIN_RECOMPUTE_CONCURRENCY
): number {
  const parsedValue = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim() !== ''
      ? Number.parseInt(value, 10)
      : Number.NaN;

  if (!Number.isFinite(parsedValue)) {
    return fallback;
  }

  const rounded = Math.trunc(parsedValue);
  return Math.min(
    MAX_RECOMPUTE_CONCURRENCY,
    Math.max(MIN_RECOMPUTE_CONCURRENCY, rounded)
  );
}

function normalizeGraphExecutionTimeoutMs(
  value: unknown,
  fallback = DEFAULT_GRAPH_EXECUTION_TIMEOUT_MS
): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

function normalizeExecutionTimeoutSeconds(
  value: unknown,
  fallback = DEFAULT_GRAPH_EXECUTION_TIMEOUT_SECONDS
): number {
  const parsedValue = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim() !== ''
      ? Number.parseFloat(value)
      : Number.NaN;

  if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
    return fallback;
  }

  return parsedValue;
}

interface GraphPanelProps {
  embedded?: boolean;
}

type ConnectionStrokeColorTarget = 'foreground' | 'background' | null;

function GraphPanel({ embedded = false }: GraphPanelProps) {
  const graph = useGraphStore((state) => state.graph);
  const graphSummaries = useGraphStore((state) => state.graphSummaries);
  const loadGraph = useGraphStore((state) => state.loadGraph);
  const createGraph = useGraphStore((state) => state.createGraph);
  const deleteGraph = useGraphStore((state) => state.deleteGraph);
  const refreshGraphSummaries = useGraphStore((state) => state.refreshGraphSummaries);
  const updateGraph = useGraphStore((state) => state.updateGraph);

  const [graphNameValue, setGraphNameValue] = useState('');
  const [newGraphName, setNewGraphName] = useState('Untitled Graph');
  const [canvasBackgroundDraft, setCanvasBackgroundDraft] = useState<CanvasBackgroundSettings>(
    normalizeCanvasBackground(undefined)
  );
  const [showCanvasBackgroundColorDialog, setShowCanvasBackgroundColorDialog] = useState(false);
  const [connectionStrokeDraft, setConnectionStrokeDraft] = useState<GraphConnectionStrokeSettings>(
    normalizeGraphConnectionStroke(undefined)
  );
  const [connectionStrokeColorTarget, setConnectionStrokeColorTarget] =
    useState<ConnectionStrokeColorTarget>(null);
  const [pythonEnvDrafts, setPythonEnvDrafts] = useState<PythonEnvironment[]>([]);
  const [pythonEnvValidationError, setPythonEnvValidationError] = useState<string | null>(null);
  const [recomputeConcurrencyValue, setRecomputeConcurrencyValue] = useState(
    String(MIN_RECOMPUTE_CONCURRENCY)
  );
  const [executionTimeoutSecondsValue, setExecutionTimeoutSecondsValue] = useState(
    String(DEFAULT_GRAPH_EXECUTION_TIMEOUT_SECONDS)
  );
  const [isGraphActionInFlight, setIsGraphActionInFlight] = useState(false);
  const [isDeleteGraphConfirming, setIsDeleteGraphConfirming] = useState(false);

  useEffect(() => {
    void refreshGraphSummaries();
  }, [refreshGraphSummaries]);

  useEffect(() => {
    if (graph) {
      const projectionState = normalizeGraphProjectionState(
        graph.nodes,
        graph.projections,
        graph.activeProjectionId,
        graph.canvasBackground
      );
      const activeProjection = projectionState.projections.find(
        (projection) => projection.id === projectionState.activeProjectionId
      ) ?? projectionState.projections[0];
      setGraphNameValue(graph.name);
      setCanvasBackgroundDraft(
        normalizeCanvasBackground(activeProjection?.canvasBackground ?? graph.canvasBackground)
      );
      setConnectionStrokeDraft(normalizeGraphConnectionStroke(graph.connectionStroke));
      setPythonEnvDrafts(graph.pythonEnvs ?? []);
      setRecomputeConcurrencyValue(
        String(
          normalizeRecomputeConcurrency(
            graph.recomputeConcurrency,
            MIN_RECOMPUTE_CONCURRENCY
          )
        )
      );
      setExecutionTimeoutSecondsValue(
        String(
          normalizeGraphExecutionTimeoutMs(graph.executionTimeoutMs) / 1000
        )
      );
    } else {
      setGraphNameValue('');
      setCanvasBackgroundDraft(normalizeCanvasBackground(undefined));
      setConnectionStrokeDraft(normalizeGraphConnectionStroke(undefined));
      setPythonEnvDrafts([]);
      setRecomputeConcurrencyValue(String(MIN_RECOMPUTE_CONCURRENCY));
      setExecutionTimeoutSecondsValue(String(DEFAULT_GRAPH_EXECUTION_TIMEOUT_SECONDS));
    }
    setPythonEnvValidationError(null);
    setConnectionStrokeColorTarget(null);
  }, [graph]);

  useEffect(() => {
    setIsDeleteGraphConfirming(false);
  }, [graph?.id]);

  const commitGraphName = useCallback(async () => {
    if (!graph) {
      return;
    }

    const trimmed = graphNameValue.trim();
    if (!trimmed) {
      setGraphNameValue(graph.name);
      return;
    }
    if (trimmed === graph.name) {
      return;
    }

    setIsGraphActionInFlight(true);
    try {
      await updateGraph({ name: trimmed });
      await refreshGraphSummaries();
    } finally {
      setIsGraphActionInFlight(false);
    }
  }, [graph, graphNameValue, refreshGraphSummaries, updateGraph]);

  const handleSelectGraph = useCallback(async (graphId: string) => {
    if (!graphId || (graph && graph.id === graphId)) {
      return;
    }

    setIsGraphActionInFlight(true);
    try {
      await loadGraph(graphId);
      await refreshGraphSummaries();
    } finally {
      setIsGraphActionInFlight(false);
    }
  }, [graph, loadGraph, refreshGraphSummaries]);

  const handleCreateGraph = useCallback(async () => {
    const name = newGraphName.trim() || 'Untitled Graph';
    setIsGraphActionInFlight(true);
    try {
      await createGraph(name);
      await refreshGraphSummaries();
      setNewGraphName('Untitled Graph');
    } finally {
      setIsGraphActionInFlight(false);
    }
  }, [createGraph, newGraphName, refreshGraphSummaries]);

  const handleDeleteCurrentGraph = useCallback(async () => {
    if (!graph) {
      return;
    }

    setIsGraphActionInFlight(true);
    try {
      await deleteGraph(graph.id);
      await refreshGraphSummaries();
      setIsDeleteGraphConfirming(false);
    } finally {
      setIsGraphActionInFlight(false);
    }
  }, [deleteGraph, graph, refreshGraphSummaries]);

  const commitRecomputeConcurrency = useCallback(async () => {
    if (!graph) {
      return;
    }

    const current = normalizeRecomputeConcurrency(
      graph.recomputeConcurrency,
      MIN_RECOMPUTE_CONCURRENCY
    );
    const next = normalizeRecomputeConcurrency(recomputeConcurrencyValue, current);
    setRecomputeConcurrencyValue(String(next));
    if (next === current) {
      return;
    }

    setIsGraphActionInFlight(true);
    try {
      await updateGraph({ recomputeConcurrency: next });
      await refreshGraphSummaries();
    } finally {
      setIsGraphActionInFlight(false);
    }
  }, [graph, recomputeConcurrencyValue, refreshGraphSummaries, updateGraph]);

  const commitExecutionTimeout = useCallback(async () => {
    if (!graph) {
      return;
    }

    const currentTimeoutMs = normalizeGraphExecutionTimeoutMs(graph.executionTimeoutMs);
    const currentSeconds = currentTimeoutMs / 1000;
    const nextSeconds = normalizeExecutionTimeoutSeconds(executionTimeoutSecondsValue, currentSeconds);
    const nextTimeoutMs = Math.max(1, Math.round(nextSeconds * 1000));
    setExecutionTimeoutSecondsValue(String(nextTimeoutMs / 1000));
    if (nextTimeoutMs === currentTimeoutMs) {
      return;
    }

    setIsGraphActionInFlight(true);
    try {
      await updateGraph({ executionTimeoutMs: nextTimeoutMs });
      await refreshGraphSummaries();
    } finally {
      setIsGraphActionInFlight(false);
    }
  }, [executionTimeoutSecondsValue, graph, refreshGraphSummaries, updateGraph]);

  const commitCanvasBackground = useCallback(async () => {
    if (!graph) {
      return;
    }

    const projectionState = normalizeGraphProjectionState(
      graph.nodes,
      graph.projections,
      graph.activeProjectionId,
      graph.canvasBackground
    );
    const activeProjection = projectionState.projections.find(
      (projection) => projection.id === projectionState.activeProjectionId
    ) ?? projectionState.projections[0];
    if (!activeProjection) {
      return;
    }

    const normalized = normalizeCanvasBackground(canvasBackgroundDraft);
    const currentNormalized = normalizeCanvasBackground(
      activeProjection.canvasBackground ?? graph.canvasBackground
    );
    if (
      normalized.mode === currentNormalized.mode &&
      normalized.baseColor === currentNormalized.baseColor
    ) {
      return;
    }
    const updatedProjections = projectionState.projections.map((projection) =>
      projection.id === projectionState.activeProjectionId
        ? withCanvasBackgroundInProjection(projection, normalized)
        : projection
    );

    setIsGraphActionInFlight(true);
    try {
      await updateGraph({
        projections: updatedProjections,
        activeProjectionId: projectionState.activeProjectionId,
        canvasBackground: normalized,
        updatedAt: Date.now(),
      });
      await refreshGraphSummaries();
    } finally {
      setIsGraphActionInFlight(false);
    }
  }, [canvasBackgroundDraft, graph, refreshGraphSummaries, updateGraph]);

  const updateConnectionStrokeForegroundWidth = useCallback((nextValue: string) => {
    const parsedValue = Number.parseFloat(nextValue);
    if (!Number.isFinite(parsedValue)) {
      return;
    }
    setConnectionStrokeDraft((current) => normalizeGraphConnectionStroke({
      ...current,
      foregroundWidth: parsedValue,
      backgroundWidth: parsedValue * 2,
    }));
  }, []);

  const updateConnectionStrokeBackgroundWidth = useCallback((nextValue: string) => {
    const parsedValue = Number.parseFloat(nextValue);
    if (!Number.isFinite(parsedValue)) {
      return;
    }
    setConnectionStrokeDraft((current) => normalizeGraphConnectionStroke({
      ...current,
      foregroundWidth: parsedValue * 0.5,
      backgroundWidth: parsedValue,
    }));
  }, []);

  const commitConnectionStroke = useCallback(async () => {
    if (!graph) {
      return;
    }

    const normalized = normalizeGraphConnectionStroke(connectionStrokeDraft);
    setConnectionStrokeDraft(normalized);
    const current = normalizeGraphConnectionStroke(graph.connectionStroke);
    if (
      normalized.foregroundColor === current.foregroundColor &&
      normalized.backgroundColor === current.backgroundColor &&
      normalized.foregroundWidth === current.foregroundWidth &&
      normalized.backgroundWidth === current.backgroundWidth
    ) {
      return;
    }

    setIsGraphActionInFlight(true);
    try {
      await updateGraph({ connectionStroke: normalized });
      await refreshGraphSummaries();
    } finally {
      setIsGraphActionInFlight(false);
    }
  }, [connectionStrokeDraft, graph, refreshGraphSummaries, updateGraph]);

  const updatePythonEnvDraftField = useCallback((
    index: number,
    field: keyof PythonEnvironment,
    value: string
  ) => {
    setPythonEnvDrafts((current) =>
      current.map((env, envIndex) =>
        envIndex === index
          ? {
              ...env,
              [field]: value,
            }
          : env
      )
    );
    setPythonEnvValidationError(null);
  }, []);

  const addPythonEnvDraft = useCallback(() => {
    setPythonEnvDrafts((current) => [
      ...current,
      {
        name: getNextPythonEnvName(current),
        pythonPath: '',
        cwd: '',
      },
    ]);
    setPythonEnvValidationError(null);
  }, []);

  const deletePythonEnvDraft = useCallback((index: number) => {
    setPythonEnvDrafts((current) => current.filter((_, envIndex) => envIndex !== index));
    setPythonEnvValidationError(null);
  }, []);

  const commitPythonEnvs = useCallback(async () => {
    if (!graph) {
      return;
    }

    const normalizedEnvs = pythonEnvDrafts.map((env) => ({
      name: env.name.trim(),
      pythonPath: env.pythonPath.trim(),
      cwd: env.cwd.trim(),
    }));

    for (const env of normalizedEnvs) {
      if (!env.name || !env.pythonPath || !env.cwd) {
        setPythonEnvValidationError('Each Python env requires name, python path, and working directory.');
        return;
      }
    }

    const uniqueNames = new Set(normalizedEnvs.map((env) => env.name));
    if (uniqueNames.size !== normalizedEnvs.length) {
      setPythonEnvValidationError('Python env names must be unique within a graph.');
      return;
    }

    const envNames = new Set(normalizedEnvs.map((env) => env.name));
    const nextNodes = graph.nodes.map((node) => {
      if (!node.config.pythonEnv || envNames.has(node.config.pythonEnv)) {
        return node;
      }

      const configWithoutPythonEnv = {
        ...node.config,
        pythonEnv: undefined,
      };
      return {
        ...node,
        config: configWithoutPythonEnv,
        version: `${Date.now()}-${node.id}`,
      };
    });

    setIsGraphActionInFlight(true);
    try {
      await updateGraph({
        nodes: nextNodes,
        pythonEnvs: normalizedEnvs,
        updatedAt: Date.now(),
      });
      await refreshGraphSummaries();
      setPythonEnvValidationError(null);
    } finally {
      setIsGraphActionInFlight(false);
    }
  }, [graph, pythonEnvDrafts, refreshGraphSummaries, updateGraph]);

  const handleSelectProjection = useCallback(async (projectionId: string) => {
    if (!graph || !projectionId.trim()) {
      return;
    }

    const projectionState = normalizeGraphProjectionState(
      graph.nodes,
      graph.projections,
      graph.activeProjectionId,
      graph.canvasBackground
    );
    if (projectionState.activeProjectionId === projectionId) {
      return;
    }

    const selectedProjection = projectionState.projections.find(
      (projection) => projection.id === projectionId
    );
    if (!selectedProjection) {
      return;
    }

    setIsGraphActionInFlight(true);
    try {
      const nextBackground = normalizeCanvasBackground(
        selectedProjection.canvasBackground ?? graph.canvasBackground
      );
      await updateGraph({
        projections: projectionState.projections,
        activeProjectionId: selectedProjection.id,
        nodes: applyProjectionToNodes(graph.nodes, selectedProjection),
        canvasBackground: nextBackground,
        updatedAt: Date.now(),
      });
      await refreshGraphSummaries();
    } finally {
      setIsGraphActionInFlight(false);
    }
  }, [graph, refreshGraphSummaries, updateGraph]);

  const handleAddProjection = useCallback(async () => {
    if (!graph) {
      return;
    }

    const projectionState = normalizeGraphProjectionState(
      graph.nodes,
      graph.projections,
      graph.activeProjectionId,
      graph.canvasBackground
    );
    const sourceProjection = projectionState.projections.find(
      (projection) => projection.id === projectionState.activeProjectionId
    );
    const projectionId = uuidv4();
    const projectionName = getNextProjectionName(
      projectionState.projections.map((projection) => projection.name)
    );
    const newProjection = {
      id: projectionId,
      name: projectionName,
      nodePositions: cloneProjectionNodePositions(graph.nodes, sourceProjection),
      nodeCardSizes: cloneProjectionNodeCardSizes(graph.nodes, sourceProjection),
      canvasBackground: normalizeCanvasBackground(
        sourceProjection?.canvasBackground ?? graph.canvasBackground
      ),
    };

    setIsGraphActionInFlight(true);
    try {
      await updateGraph({
        projections: [...projectionState.projections, newProjection],
        activeProjectionId: newProjection.id,
        nodes: applyProjectionToNodes(graph.nodes, newProjection),
        canvasBackground: normalizeCanvasBackground(newProjection.canvasBackground),
        updatedAt: Date.now(),
      });
      await refreshGraphSummaries();
    } finally {
      setIsGraphActionInFlight(false);
    }
  }, [graph, refreshGraphSummaries, updateGraph]);

  const handleRemoveProjection = useCallback(async () => {
    if (!graph) {
      return;
    }

    const projectionState = normalizeGraphProjectionState(
      graph.nodes,
      graph.projections,
      graph.activeProjectionId,
      graph.canvasBackground
    );
    if (projectionState.projections.length <= 1) {
      return;
    }

    const activeProjection = projectionState.projections.find(
      (projection) => projection.id === projectionState.activeProjectionId
    );
    if (!activeProjection || activeProjection.id === DEFAULT_GRAPH_PROJECTION_ID) {
      return;
    }

    const remainingProjections = projectionState.projections.filter(
      (projection) => projection.id !== activeProjection.id
    );
    if (remainingProjections.length === 0) {
      return;
    }

    const nextActiveProjection = remainingProjections.find(
      (projection) => projection.id === DEFAULT_GRAPH_PROJECTION_ID
    ) ?? remainingProjections[0];

    setIsGraphActionInFlight(true);
    try {
      const nextBackground = normalizeCanvasBackground(
        nextActiveProjection.canvasBackground ?? graph.canvasBackground
      );
      await updateGraph({
        projections: remainingProjections,
        activeProjectionId: nextActiveProjection.id,
        nodes: applyProjectionToNodes(graph.nodes, nextActiveProjection),
        canvasBackground: nextBackground,
        updatedAt: Date.now(),
      });
      await refreshGraphSummaries();
    } finally {
      setIsGraphActionInFlight(false);
    }
  }, [graph, refreshGraphSummaries, updateGraph]);

  const projectionState = graph
    ? normalizeGraphProjectionState(
      graph.nodes,
      graph.projections,
      graph.activeProjectionId,
      graph.canvasBackground
    )
    : null;
  const projectionOptions = projectionState?.projections ?? [];
  const activeProjectionId = projectionState?.activeProjectionId ?? DEFAULT_GRAPH_PROJECTION_ID;
  const canRemoveActiveProjection = Boolean(
    graph &&
    !isGraphActionInFlight &&
    projectionOptions.length > 1 &&
    activeProjectionId !== DEFAULT_GRAPH_PROJECTION_ID
  );
  const isConnectionStrokeColorDialogOpen = connectionStrokeColorTarget !== null;
  const connectionStrokeDialogTitle = connectionStrokeColorTarget === 'background'
    ? 'Connection Background Color'
    : 'Connection Foreground Color';
  const connectionStrokeDialogDescription = connectionStrokeColorTarget === 'background'
    ? 'Background stroke is drawn under the foreground stroke and auto-kept at 2x foreground width.'
    : 'Foreground stroke is drawn on top of the background stroke for connector clarity.';
  const connectionStrokeDialogInitialColor = connectionStrokeColorTarget === 'background'
    ? connectionStrokeDraft.backgroundColor
    : connectionStrokeDraft.foregroundColor;

  return (
    <div
      data-testid="graph-panel"
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
      {!embedded && <h3 style={{ marginBottom: '16px' }}>Graph Panel</h3>}
      <div
        style={embedded
          ? {}
          : {
              padding: '10px',
              border: '1px solid #dbe4ef',
              borderRadius: '6px',
              background: '#fff',
            }}
      >
        <label style={{ display: 'block', marginBottom: '6px', fontSize: '11px', color: '#475569' }}>
          Select graph
        </label>
        <select
          data-testid="graph-select"
          value={graph?.id ?? ''}
          disabled={isGraphActionInFlight}
          onChange={(event) => {
            void handleSelectGraph(event.target.value);
          }}
          style={{
            width: '100%',
            padding: '8px',
            marginBottom: '8px',
            border: '1px solid #d1d5db',
            borderRadius: '4px',
            boxSizing: 'border-box',
          }}
        >
          {graphSummaries.length === 0 && <option value="">No graphs available</option>}
          {graphSummaries.map((summary) => (
            <option key={summary.id} value={summary.id}>
              {formatGraphOptionLabel(summary.name, summary.id)}
            </option>
          ))}
        </select>

        <label style={{ display: 'block', marginBottom: '6px', fontSize: '11px', color: '#475569' }}>
          Rename current graph
        </label>
        <input
          data-testid="graph-name-input"
          type="text"
          value={graphNameValue}
          disabled={!graph || isGraphActionInFlight}
          onChange={(event) => setGraphNameValue(event.target.value)}
          onBlur={() => {
            void commitGraphName();
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.currentTarget.blur();
            }
            if (event.key === 'Escape' && graph) {
              setGraphNameValue(graph.name);
              event.currentTarget.blur();
            }
          }}
          style={{
            width: '100%',
            padding: '8px',
            marginBottom: '8px',
            border: '1px solid #d1d5db',
            borderRadius: '4px',
            boxSizing: 'border-box',
          }}
        />

        <label style={{ display: 'block', marginBottom: '6px', fontSize: '11px', color: '#475569' }}>
          Recompute workers
        </label>
        <input
          data-testid="graph-recompute-concurrency-input"
          type="number"
          min={MIN_RECOMPUTE_CONCURRENCY}
          max={MAX_RECOMPUTE_CONCURRENCY}
          step={1}
          value={recomputeConcurrencyValue}
          disabled={!graph || isGraphActionInFlight}
          onChange={(event) => setRecomputeConcurrencyValue(event.target.value)}
          onBlur={() => {
            void commitRecomputeConcurrency();
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.currentTarget.blur();
            }
            if (event.key === 'Escape') {
              setRecomputeConcurrencyValue(
                String(
                  normalizeRecomputeConcurrency(
                    graph?.recomputeConcurrency,
                    MIN_RECOMPUTE_CONCURRENCY
                  )
                )
              );
              event.currentTarget.blur();
            }
          }}
          style={{
            width: '100%',
            padding: '8px',
            marginBottom: '4px',
            border: '1px solid #d1d5db',
            borderRadius: '4px',
            boxSizing: 'border-box',
          }}
        />
        <div style={{ marginBottom: '8px', fontSize: '10px', color: '#64748b' }}>
          Graph-level backend recompute worker concurrency (1-32).
        </div>

        <label style={{ display: 'block', marginBottom: '6px', fontSize: '11px', color: '#475569' }}>
          Script timeout (seconds)
        </label>
        <input
          data-testid="graph-execution-timeout-input"
          type="number"
          min={0.001}
          step={0.1}
          value={executionTimeoutSecondsValue}
          disabled={!graph || isGraphActionInFlight}
          onChange={(event) => setExecutionTimeoutSecondsValue(event.target.value)}
          onBlur={() => {
            void commitExecutionTimeout();
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.currentTarget.blur();
            }
            if (event.key === 'Escape') {
              const currentTimeoutMs = normalizeGraphExecutionTimeoutMs(graph?.executionTimeoutMs);
              setExecutionTimeoutSecondsValue(String(currentTimeoutMs / 1000));
              event.currentTarget.blur();
            }
          }}
          style={{
            width: '100%',
            padding: '8px',
            marginBottom: '4px',
            border: '1px solid #d1d5db',
            borderRadius: '4px',
            boxSizing: 'border-box',
          }}
        />
        <div style={{ marginBottom: '8px', fontSize: '10px', color: '#64748b' }}>
          Graph-level inline runtime timeout. Default 30 seconds. No maximum.
        </div>

        {!isDeleteGraphConfirming ? (
          <button
            data-testid="delete-graph-button"
            disabled={!graph || isGraphActionInFlight}
            onClick={() => {
              if (!graph || isGraphActionInFlight) {
                return;
              }
              setIsDeleteGraphConfirming(true);
            }}
            style={{
              width: '100%',
              padding: '8px 10px',
              marginBottom: '10px',
              background: '#b91c1c',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: !graph || isGraphActionInFlight ? 'not-allowed' : 'pointer',
              fontSize: '12px',
            }}
          >
            Delete Current Graph
          </button>
        ) : (
          <div
            style={{
              marginBottom: '10px',
              padding: '8px',
              border: '1px solid #fecaca',
              borderRadius: '6px',
              background: '#fef2f2',
            }}
          >
            <div style={{ fontSize: '11px', color: '#7f1d1d', marginBottom: '8px' }}>
              Delete this graph permanently?
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                data-testid="confirm-delete-graph-button"
                disabled={!graph || isGraphActionInFlight}
                onClick={() => {
                  void handleDeleteCurrentGraph();
                }}
                style={{
                  flex: 1,
                  padding: '7px 8px',
                  background: '#b91c1c',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: !graph || isGraphActionInFlight ? 'not-allowed' : 'pointer',
                  fontSize: '12px',
                }}
              >
                Confirm Delete
              </button>
              <button
                data-testid="cancel-delete-graph-button"
                disabled={isGraphActionInFlight}
                onClick={() => setIsDeleteGraphConfirming(false)}
                style={{
                  flex: 1,
                  padding: '7px 8px',
                  background: '#e2e8f0',
                  color: '#0f172a',
                  border: '1px solid #cbd5e1',
                  borderRadius: '4px',
                  cursor: isGraphActionInFlight ? 'not-allowed' : 'pointer',
                  fontSize: '12px',
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        <label style={{ display: 'block', marginBottom: '6px', fontSize: '11px', color: '#475569' }}>
          New graph
        </label>
        <div style={{ display: 'flex', gap: '8px' }}>
          <input
            data-testid="new-graph-name-input"
            type="text"
            value={newGraphName}
            disabled={isGraphActionInFlight}
            onChange={(event) => setNewGraphName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                void handleCreateGraph();
              }
            }}
            style={{
              flex: 1,
              padding: '8px',
              border: '1px solid #d1d5db',
              borderRadius: '4px',
              boxSizing: 'border-box',
            }}
          />
          <button
            data-testid="create-graph-button"
            disabled={isGraphActionInFlight}
            onClick={() => {
              void handleCreateGraph();
            }}
            style={{
              padding: '8px 10px',
              background: '#2563eb',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: isGraphActionInFlight ? 'not-allowed' : 'pointer',
              fontSize: '12px',
            }}
          >
            Create
          </button>
        </div>

        <div
          style={{
            marginTop: '10px',
            padding: '8px',
            border: '1px solid #e2e8f0',
            borderRadius: '6px',
            background: '#f8fafc',
          }}
        >
          <div style={{ fontSize: '11px', color: '#334155', fontWeight: 700, marginBottom: '8px' }}>
            Projections
          </div>
          <label style={{ display: 'block', marginBottom: '6px', fontSize: '11px', color: '#475569' }}>
            Active projection
          </label>
          <select
            data-testid="projection-select"
            value={graph ? activeProjectionId : ''}
            disabled={!graph || isGraphActionInFlight}
            onChange={(event) => {
              void handleSelectProjection(event.target.value);
            }}
            style={{
              width: '100%',
              padding: '8px',
              marginBottom: '8px',
              border: '1px solid #d1d5db',
              borderRadius: '4px',
              boxSizing: 'border-box',
            }}
          >
            {projectionOptions.map((projection) => (
              <option key={projection.id} value={projection.id}>
                {formatProjectionOptionLabel(projection.name, projection.id)}
              </option>
            ))}
          </select>
          <button
            data-testid="projection-add"
            disabled={!graph || isGraphActionInFlight}
            onClick={() => {
              void handleAddProjection();
            }}
            style={{
              width: '100%',
              padding: '7px 8px',
              background: '#475569',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              fontSize: '11px',
              cursor: !graph || isGraphActionInFlight ? 'not-allowed' : 'pointer',
            }}
          >
            Add Projection
          </button>
          <button
            data-testid="projection-remove"
            disabled={!canRemoveActiveProjection}
            onClick={() => {
              void handleRemoveProjection();
            }}
            style={{
              width: '100%',
              marginTop: '8px',
              padding: '7px 8px',
              background: '#b91c1c',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              fontSize: '11px',
              cursor: canRemoveActiveProjection ? 'pointer' : 'not-allowed',
            }}
          >
            Remove Active Projection
          </button>
        </div>

        <div
          style={{
            marginTop: '10px',
            padding: '8px',
            border: '1px solid #e2e8f0',
            borderRadius: '6px',
            background: '#f8fafc',
          }}
        >
          <div style={{ fontSize: '11px', color: '#334155', fontWeight: 700, marginBottom: '8px' }}>
            Projection Background
          </div>
          <label style={{ display: 'block', marginBottom: '6px', fontSize: '11px', color: '#475569' }}>
            Mode
          </label>
          <select
            data-testid="canvas-background-mode-select"
            value={canvasBackgroundDraft.mode}
            disabled={!graph || isGraphActionInFlight}
            onChange={(event) =>
              setCanvasBackgroundDraft((current) => ({
                ...current,
                mode: event.target.value === 'solid' ? 'solid' : 'gradient',
              }))
            }
            style={{
              width: '100%',
              padding: '8px',
              marginBottom: '8px',
              border: '1px solid #d1d5db',
              borderRadius: '4px',
              boxSizing: 'border-box',
            }}
          >
            <option value="gradient">Gradient</option>
            <option value="solid">Solid</option>
          </select>

          <label style={{ display: 'block', marginBottom: '6px', fontSize: '11px', color: '#475569' }}>
            Base color
          </label>
          <button
            data-testid="canvas-background-color-input"
            type="button"
            disabled={!graph || isGraphActionInFlight}
            onClick={() => {
              if (!graph || isGraphActionInFlight) {
                return;
              }
              setShowCanvasBackgroundColorDialog(true);
            }}
            style={{
              width: '100%',
              height: '34px',
              marginBottom: '8px',
              padding: '6px 8px',
              border: '1px solid #d1d5db',
              borderRadius: '4px',
              boxSizing: 'border-box',
              background: '#ffffff',
              cursor: !graph || isGraphActionInFlight ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '8px',
              color: '#0f172a',
              fontSize: '11px',
            }}
          >
            <span>Choose color</span>
            <span
              style={{
                width: '14px',
                height: '14px',
                borderRadius: '50%',
                border: '1px solid #334155',
                background: canvasBackgroundDraft.baseColor,
                flexShrink: 0,
              }}
            />
          </button>

          <button
            data-testid="canvas-background-save"
            disabled={!graph || isGraphActionInFlight}
            onClick={() => {
              void commitCanvasBackground();
            }}
            style={{
              width: '100%',
              padding: '7px 8px',
              background: '#2563eb',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              fontSize: '11px',
              cursor: !graph || isGraphActionInFlight ? 'not-allowed' : 'pointer',
            }}
          >
            Save Background
          </button>
        </div>

        <div
          style={{
            marginTop: '10px',
            padding: '8px',
            border: '1px solid #e2e8f0',
            borderRadius: '6px',
            background: '#f8fafc',
          }}
        >
          <div style={{ fontSize: '11px', color: '#334155', fontWeight: 700, marginBottom: '8px' }}>
            Connection Strokes
          </div>

          <label style={{ display: 'block', marginBottom: '6px', fontSize: '11px', color: '#475569' }}>
            Foreground color
          </label>
          <button
            data-testid="connection-stroke-foreground-color-input"
            type="button"
            disabled={!graph || isGraphActionInFlight}
            onClick={() => {
              if (!graph || isGraphActionInFlight) {
                return;
              }
              setConnectionStrokeColorTarget('foreground');
            }}
            style={{
              width: '100%',
              height: '34px',
              marginBottom: '8px',
              padding: '6px 8px',
              border: '1px solid #d1d5db',
              borderRadius: '4px',
              boxSizing: 'border-box',
              background: '#ffffff',
              cursor: !graph || isGraphActionInFlight ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '8px',
              color: '#0f172a',
              fontSize: '11px',
            }}
          >
            <span>Choose color</span>
            <span
              style={{
                width: '14px',
                height: '14px',
                borderRadius: '50%',
                border: '1px solid #334155',
                background: connectionStrokeDraft.foregroundColor,
                flexShrink: 0,
              }}
            />
          </button>

          <label style={{ display: 'block', marginBottom: '6px', fontSize: '11px', color: '#475569' }}>
            Background color
          </label>
          <button
            data-testid="connection-stroke-background-color-input"
            type="button"
            disabled={!graph || isGraphActionInFlight}
            onClick={() => {
              if (!graph || isGraphActionInFlight) {
                return;
              }
              setConnectionStrokeColorTarget('background');
            }}
            style={{
              width: '100%',
              height: '34px',
              marginBottom: '8px',
              padding: '6px 8px',
              border: '1px solid #d1d5db',
              borderRadius: '4px',
              boxSizing: 'border-box',
              background: '#ffffff',
              cursor: !graph || isGraphActionInFlight ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '8px',
              color: '#0f172a',
              fontSize: '11px',
            }}
          >
            <span>Choose color</span>
            <span
              style={{
                width: '14px',
                height: '14px',
                borderRadius: '50%',
                border: '1px solid #334155',
                background: connectionStrokeDraft.backgroundColor,
                flexShrink: 0,
              }}
            />
          </button>

          <label style={{ display: 'block', marginBottom: '6px', fontSize: '11px', color: '#475569' }}>
            Foreground width
          </label>
          <input
            data-testid="connection-stroke-foreground-width-input"
            type="number"
            min={0.25}
            max={24}
            step={0.1}
            value={connectionStrokeDraft.foregroundWidth}
            disabled={!graph || isGraphActionInFlight}
            onChange={(event) => updateConnectionStrokeForegroundWidth(event.target.value)}
            style={{
              width: '100%',
              padding: '8px',
              marginBottom: '8px',
              border: '1px solid #d1d5db',
              borderRadius: '4px',
              boxSizing: 'border-box',
            }}
          />

          <label style={{ display: 'block', marginBottom: '6px', fontSize: '11px', color: '#475569' }}>
            Background width
          </label>
          <input
            data-testid="connection-stroke-background-width-input"
            type="number"
            min={0.5}
            max={48}
            step={0.1}
            value={connectionStrokeDraft.backgroundWidth}
            disabled={!graph || isGraphActionInFlight}
            onChange={(event) => updateConnectionStrokeBackgroundWidth(event.target.value)}
            style={{
              width: '100%',
              padding: '8px',
              marginBottom: '4px',
              border: '1px solid #d1d5db',
              borderRadius: '4px',
              boxSizing: 'border-box',
            }}
          />
          <div style={{ marginBottom: '8px', fontSize: '10px', color: '#64748b' }}>
            Background width stays 2x foreground width.
          </div>

          <button
            data-testid="connection-stroke-save"
            disabled={!graph || isGraphActionInFlight}
            onClick={() => {
              void commitConnectionStroke();
            }}
            style={{
              width: '100%',
              padding: '7px 8px',
              background: '#2563eb',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              fontSize: '11px',
              cursor: !graph || isGraphActionInFlight ? 'not-allowed' : 'pointer',
            }}
          >
            Save Connection Strokes
          </button>
        </div>

        <div
          style={{
            marginTop: '10px',
            padding: '8px',
            border: '1px solid #e2e8f0',
            borderRadius: '6px',
            background: '#f8fafc',
          }}
        >
          <div style={{ fontSize: '11px', color: '#334155', fontWeight: 700, marginBottom: '8px' }}>
            Python Environments
          </div>
          {pythonEnvDrafts.length === 0 ? (
            <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '8px' }}>
              No graph-level Python envs defined.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '8px' }}>
              {pythonEnvDrafts.map((env, index) => (
                <div
                  key={`${env.name}-${index}`}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr',
                    gap: '6px',
                    padding: '8px',
                    border: '1px solid #dbe4ef',
                    borderRadius: '4px',
                    background: '#ffffff',
                  }}
                >
                  <input
                    data-testid={`python-env-name-${index}`}
                    type="text"
                    value={env.name}
                    placeholder="Env name"
                    onChange={(event) => updatePythonEnvDraftField(index, 'name', event.target.value)}
                    style={{
                      width: '100%',
                      padding: '6px',
                      border: '1px solid #d1d5db',
                      borderRadius: '4px',
                      fontSize: '11px',
                      boxSizing: 'border-box',
                    }}
                  />
                  <input
                    data-testid={`python-env-path-${index}`}
                    type="text"
                    value={env.pythonPath}
                    placeholder="/path/to/python"
                    onChange={(event) => updatePythonEnvDraftField(index, 'pythonPath', event.target.value)}
                    style={{
                      width: '100%',
                      padding: '6px',
                      border: '1px solid #d1d5db',
                      borderRadius: '4px',
                      fontSize: '11px',
                      boxSizing: 'border-box',
                    }}
                  />
                  <input
                    data-testid={`python-env-cwd-${index}`}
                    type="text"
                    value={env.cwd}
                    placeholder="/working/directory"
                    onChange={(event) => updatePythonEnvDraftField(index, 'cwd', event.target.value)}
                    style={{
                      width: '100%',
                      padding: '6px',
                      border: '1px solid #d1d5db',
                      borderRadius: '4px',
                      fontSize: '11px',
                      boxSizing: 'border-box',
                    }}
                  />
                  <button
                    data-testid={`python-env-delete-${index}`}
                    onClick={() => deletePythonEnvDraft(index)}
                    style={{
                      justifySelf: 'end',
                      padding: '4px 8px',
                      border: '1px solid #fecaca',
                      background: '#fff1f2',
                      color: '#b91c1c',
                      borderRadius: '4px',
                      fontSize: '11px',
                      cursor: 'pointer',
                    }}
                  >
                    Delete
                  </button>
                </div>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              data-testid="python-env-add"
              disabled={isGraphActionInFlight}
              onClick={addPythonEnvDraft}
              style={{
                flex: 1,
                padding: '7px 8px',
                background: '#e2e8f0',
                border: '1px solid #cbd5e1',
                borderRadius: '4px',
                fontSize: '11px',
                cursor: isGraphActionInFlight ? 'not-allowed' : 'pointer',
              }}
            >
              Add Env
            </button>
            <button
              data-testid="python-env-save"
              disabled={isGraphActionInFlight || !graph}
              onClick={() => {
                void commitPythonEnvs();
              }}
              style={{
                flex: 1,
                padding: '7px 8px',
                background: '#0f766e',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                fontSize: '11px',
                cursor: isGraphActionInFlight ? 'not-allowed' : 'pointer',
              }}
            >
              Save Envs
            </button>
          </div>
          {pythonEnvValidationError && (
            <div style={{ marginTop: '6px', color: '#b91c1c', fontSize: '11px' }}>
              {pythonEnvValidationError}
            </div>
          )}
        </div>
        {graph && (
          <div style={{ marginTop: '8px', fontSize: '10px', color: '#64748b' }}>
            Current graph ID: <code>{graph.id}</code>
          </div>
        )}
      </div>
      <ColorSelectionDialog
        open={showCanvasBackgroundColorDialog}
        title="Canvas Base Color"
        description="This color is used directly in solid mode and as the base tone in gradient mode."
        initialColor={canvasBackgroundDraft.baseColor}
        defaultColor="#1d437e"
        confirmLabel="Use Color"
        onCancel={() => setShowCanvasBackgroundColorDialog(false)}
        onConfirm={(color) => {
          setCanvasBackgroundDraft((current) => ({
            ...current,
            baseColor: color,
          }));
          setShowCanvasBackgroundColorDialog(false);
        }}
      />
      <ColorSelectionDialog
        open={isConnectionStrokeColorDialogOpen}
        title={connectionStrokeDialogTitle}
        description={connectionStrokeDialogDescription}
        initialColor={connectionStrokeDialogInitialColor}
        defaultColor={connectionStrokeColorTarget === 'background'
          ? DEFAULT_GRAPH_CONNECTION_STROKE.backgroundColor
          : DEFAULT_GRAPH_CONNECTION_STROKE.foregroundColor}
        confirmLabel="Use Color"
        onCancel={() => setConnectionStrokeColorTarget(null)}
        onConfirm={(color) => {
          setConnectionStrokeDraft((current) => normalizeGraphConnectionStroke({
            ...current,
            ...(connectionStrokeColorTarget === 'background'
              ? { backgroundColor: color }
              : { foregroundColor: color }),
          }));
          setConnectionStrokeColorTarget(null);
        }}
      />
    </div>
  );
}

export default GraphPanel;
