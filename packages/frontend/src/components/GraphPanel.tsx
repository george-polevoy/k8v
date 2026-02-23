import { useCallback, useEffect, useState } from 'react';
import { useGraphStore } from '../store/graphStore';
import { CanvasBackgroundSettings, PythonEnvironment } from '../types';
import { normalizeCanvasBackground } from '../utils/canvasBackground';
import ColorSelectionDialog from './ColorSelectionDialog';

function formatGraphOptionLabel(name: string, id: string): string {
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

interface GraphPanelProps {
  embedded?: boolean;
}

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
  const [pythonEnvDrafts, setPythonEnvDrafts] = useState<PythonEnvironment[]>([]);
  const [pythonEnvValidationError, setPythonEnvValidationError] = useState<string | null>(null);
  const [isGraphActionInFlight, setIsGraphActionInFlight] = useState(false);
  const [isDeleteGraphConfirming, setIsDeleteGraphConfirming] = useState(false);

  useEffect(() => {
    void refreshGraphSummaries();
  }, [refreshGraphSummaries]);

  useEffect(() => {
    if (graph) {
      setGraphNameValue(graph.name);
      setCanvasBackgroundDraft(normalizeCanvasBackground(graph.canvasBackground));
      setPythonEnvDrafts(graph.pythonEnvs ?? []);
    } else {
      setGraphNameValue('');
      setCanvasBackgroundDraft(normalizeCanvasBackground(undefined));
      setPythonEnvDrafts([]);
    }
    setPythonEnvValidationError(null);
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

  const commitCanvasBackground = useCallback(async () => {
    if (!graph) {
      return;
    }

    const normalized = normalizeCanvasBackground(canvasBackgroundDraft);
    const currentNormalized = normalizeCanvasBackground(graph.canvasBackground);
    if (
      normalized.mode === currentNormalized.mode &&
      normalized.baseColor === currentNormalized.baseColor
    ) {
      return;
    }

    setIsGraphActionInFlight(true);
    try {
      await updateGraph({
        canvasBackground: normalized,
        updatedAt: Date.now(),
      });
      await refreshGraphSummaries();
    } finally {
      setIsGraphActionInFlight(false);
    }
  }, [canvasBackgroundDraft, graph, refreshGraphSummaries, updateGraph]);

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
            Canvas Background
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
            <span>{canvasBackgroundDraft.baseColor}</span>
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
    </div>
  );
}

export default GraphPanel;
