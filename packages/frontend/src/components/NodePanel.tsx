import { useState, useEffect, useCallback, useRef } from 'react';
import { useGraphStore } from '../store/graphStore';
import { GraphNode, NodeType, PortDefinition } from '../types';
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

function NodePanel() {
  const selectedNodeId = useGraphStore((state) => state.selectedNodeId);
  const graph = useGraphStore((state) => state.graph);
  const updateNode = useGraphStore((state) => state.updateNode);
  const updateGraph = useGraphStore((state) => state.updateGraph);
  const addNode = useGraphStore((state) => state.addNode);
  const computeNode = useGraphStore((state) => state.computeNode);
  const nodeExecutionState = useGraphStore((state) =>
    selectedNodeId ? state.nodeExecutionStates[selectedNodeId] : null
  );

  const selectedNode = graph?.nodes.find((node) => node.id === selectedNodeId) || null;

  const [codeValue, setCodeValue] = useState('');
  const [nodeNameValue, setNodeNameValue] = useState('');
  const [inputDraftNames, setInputDraftNames] = useState<string[]>([]);
  const [inputValidationError, setInputValidationError] = useState<string | null>(null);
  const updateTimerRef = useRef<NodeJS.Timeout | null>(null);

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
  }, [selectedNode]);

  const debouncedUpdateCode = useCallback((nodeId: string, config: any, newValue: string) => {
    if (updateTimerRef.current) {
      clearTimeout(updateTimerRef.current);
    }

    updateTimerRef.current = setTimeout(() => {
      updateNode(nodeId, { config: { ...config, code: newValue } });
    }, 300);
  }, [updateNode]);

  useEffect(() => {
    return () => {
      if (updateTimerRef.current) {
        clearTimeout(updateTimerRef.current);
      }
    };
  }, []);

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

  const autoRecomputeEnabled = Boolean(selectedNode?.config.config?.autoRecompute);
  const statusLightColor = nodeExecutionState?.hasError
    ? '#ef4444'
    : nodeExecutionState?.isComputing
      ? '#f59e0b'
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
                  updateNode(selectedNode.id, {
                    config: {
                      ...selectedNode.config,
                      runtime: event.target.value,
                    },
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
              </select>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>
                Code:
              </label>
              <textarea
                value={codeValue}
                onChange={(event) => {
                  const nextValue = event.target.value;
                  setCodeValue(nextValue);
                  debouncedUpdateCode(selectedNode.id, selectedNode.config, nextValue);
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
      ) : (
        <div>
          <p style={{ color: '#666', marginBottom: '16px' }}>Select a node to edit</p>
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
