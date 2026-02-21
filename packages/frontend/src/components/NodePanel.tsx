import { useState, useEffect, useCallback } from 'react';
import { useGraphStore } from '../store/graphStore';
import { GraphNode, NodeType, PortDefinition, PythonEnvironment } from '../types';
import { createInlineCodeNode } from '../utils/nodeFactory';

const PORT_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

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

function NodePanel() {
  const selectedNodeId = useGraphStore((state) => state.selectedNodeId);
  const selectedDrawingId = useGraphStore((state) => state.selectedDrawingId);
  const graph = useGraphStore((state) => state.graph);
  const graphSummaries = useGraphStore((state) => state.graphSummaries);
  const loadGraph = useGraphStore((state) => state.loadGraph);
  const createGraph = useGraphStore((state) => state.createGraph);
  const refreshGraphSummaries = useGraphStore((state) => state.refreshGraphSummaries);
  const updateNode = useGraphStore((state) => state.updateNode);
  const updateGraph = useGraphStore((state) => state.updateGraph);
  const addNode = useGraphStore((state) => state.addNode);
  const updateDrawing = useGraphStore((state) => state.updateDrawing);
  const deleteDrawing = useGraphStore((state) => state.deleteDrawing);
  const computeNode = useGraphStore((state) => state.computeNode);
  const nodeExecutionState = useGraphStore((state) =>
    selectedNodeId ? state.nodeExecutionStates[selectedNodeId] : null
  );

  const selectedNode = graph?.nodes.find((node) => node.id === selectedNodeId) || null;
  const selectedDrawing = graph?.drawings?.find((drawing) => drawing.id === selectedDrawingId) || null;

  const [codeValue, setCodeValue] = useState('');
  const [graphNameValue, setGraphNameValue] = useState('');
  const [newGraphName, setNewGraphName] = useState('Untitled Graph');
  const [nodeNameValue, setNodeNameValue] = useState('');
  const [drawingNameValue, setDrawingNameValue] = useState('');
  const [inputDraftNames, setInputDraftNames] = useState<string[]>([]);
  const [inputValidationError, setInputValidationError] = useState<string | null>(null);
  const [pythonEnvDrafts, setPythonEnvDrafts] = useState<PythonEnvironment[]>([]);
  const [pythonEnvValidationError, setPythonEnvValidationError] = useState<string | null>(null);
  const [isGraphActionInFlight, setIsGraphActionInFlight] = useState(false);

  useEffect(() => {
    void refreshGraphSummaries();
  }, [refreshGraphSummaries]);

  useEffect(() => {
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

    setInputValidationError(null);
  }, [selectedNode, graph]);

  useEffect(() => {
    if (selectedDrawing) {
      setDrawingNameValue(selectedDrawing.name);
    } else {
      setDrawingNameValue('');
    }
  }, [selectedDrawing]);

  useEffect(() => {
    if (graph) {
      setGraphNameValue(graph.name);
      setPythonEnvDrafts(graph.pythonEnvs ?? []);
    } else {
      setGraphNameValue('');
      setPythonEnvDrafts([]);
    }
    setPythonEnvValidationError(null);
  }, [graph]);

  const commitInlineCode = useCallback(() => {
    if (!selectedNode || selectedNode.config.type !== NodeType.INLINE_CODE) {
      return;
    }

    const currentCode = selectedNode.config.code ?? '';
    if (codeValue === currentCode) {
      return;
    }

    updateNode(selectedNode.id, {
      config: {
        ...selectedNode.config,
        code: codeValue,
      },
    });
  }, [codeValue, selectedNode, updateNode]);

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

  const autoRecomputeEnabled = Boolean(selectedNode?.config.config?.autoRecompute);
  const graphPythonEnvs = graph?.pythonEnvs ?? [];
  const selectedPythonEnvExists = Boolean(
    selectedNode?.config.pythonEnv &&
      graphPythonEnvs.some((env) => env.name === selectedNode.config.pythonEnv)
  );
  const statusLightColor = nodeExecutionState?.hasError
    ? '#ef4444'
    : nodeExecutionState?.isComputing
      ? '#f59e0b'
      : nodeExecutionState?.isStale
        ? '#8b5a2b'
      : autoRecomputeEnabled
        ? '#22c55e'
        : '#94a3b8';

  return (
    <div
      data-testid="node-panel"
      style={{
        width: '300px',
        background: '#f9f9f9',
        borderLeft: '1px solid #ddd',
        padding: '16px',
        overflowY: 'auto',
      }}
    >
      <h3 style={{ marginBottom: '16px' }}>Node Panel</h3>
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

      {selectedNode ? (
        <div>
          <h4 style={{ marginBottom: '12px' }}>{selectedNode.metadata.name}</h4>

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
              <div style={{ marginTop: '8px', color: '#b91c1c', fontSize: '11px' }}>
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
          </div>

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
                style={{
                  padding: '4px 8px',
                  background: '#e2e8f0',
                  border: '1px solid #cbd5e1',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '11px',
                }}
              >
                + Add Input
              </button>
            </div>

            {selectedNode.metadata.inputs.length === 0 ? (
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
    </div>
  );
}

export default NodePanel;
