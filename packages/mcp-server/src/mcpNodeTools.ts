import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { getNode } from './graphConnectionEdits.js';
import {
  assertValidPortName,
  createAnnotationNode,
  createNumericInputNode,
  ensureNodeVersion,
  inferInputPortNamesFromCode,
  inferOutputPortNamesFromCode,
  updateAnnotationNode,
  updateInlineCodeNodeCode,
} from './graphNodeEdits.js';
import { textResult } from './mcpHttp.js';
import {
  type Graph,
  type GraphNode,
  normalizeGraphProjectionState,
} from './graphModel.js';

type UpdateGraphFn = (
  backendUrl: string,
  graphId: string,
  mutateGraph: (current: Graph) => Graph
) => Promise<Graph>;

interface NodeToolRegistrarDeps {
  resolveBackendUrl: (backendUrl?: string) => string;
  updateGraph: UpdateGraphFn;
}

export function registerNodeTools(server: any, deps: NodeToolRegistrarDeps): void {
  const { resolveBackendUrl, updateGraph } = deps;

  server.registerTool(
    'node_add_inline',
    {
      description: 'Add an inline code node to a graph.',
      inputSchema: {
        graphId: z.string(),
        name: z.string().optional(),
        x: z.number(),
        y: z.number(),
        inputNames: z.array(z.string()).optional(),
        outputNames: z.array(z.string()).optional(),
        code: z.string().optional(),
        runtime: z.string().optional(),
        pythonEnv: z.string().optional(),
        autoRecompute: z.boolean().optional(),
        backendUrl: z.string().optional(),
      },
    },
    async ({
      graphId,
      name,
      x,
      y,
      inputNames,
      outputNames,
      code,
      runtime,
      pythonEnv,
      autoRecompute,
      backendUrl,
    }) => {
      const resolvedBackendUrl = resolveBackendUrl(backendUrl);
      const nodeId = randomUUID();
      const nowVersion = `${Date.now()}-${nodeId}`;
      const inlineCode = code ?? 'outputs.output = inputs.input;';
      const inferredInputNames = inferInputPortNamesFromCode(inlineCode);
      const inferredOutputNames = inferOutputPortNamesFromCode(inlineCode);
      const resolvedInputNames = inputNames && inputNames.length > 0
        ? inputNames
        : (inferredInputNames.length > 0 ? inferredInputNames : ['input']);
      const resolvedOutputNames = outputNames && outputNames.length > 0
        ? outputNames
        : (inferredOutputNames.length > 0 ? inferredOutputNames : ['output']);

      const inputs = resolvedInputNames.map(
        (portName) => {
          assertValidPortName(portName, 'input');
          return {
            name: portName,
            schema: { type: 'object' as const },
          };
        }
      );

      const outputs = resolvedOutputNames.map(
        (portName) => {
          assertValidPortName(portName, 'output');
          return {
            name: portName,
            schema: { type: 'object' as const },
          };
        }
      );

      const node: GraphNode = {
        id: nodeId,
        type: 'inline_code',
        position: { x, y },
        metadata: {
          name: name ?? 'Inline Code',
          inputs,
          outputs,
        },
        config: {
          type: 'inline_code',
          runtime: runtime ?? 'javascript_vm',
          ...(pythonEnv ? { pythonEnv } : {}),
          code: inlineCode,
          config: {
            autoRecompute: autoRecompute ?? false,
          },
        },
        version: nowVersion,
      };

      const graph = await updateGraph(resolvedBackendUrl, graphId, (current) => ({
        ...current,
        nodes: [...current.nodes, node],
      }));

      return textResult({ graphId, nodeId, graph });
    }
  );

  server.registerTool(
    'node_add_numeric_input',
    {
      description: 'Add a numeric input slider node to a graph.',
      inputSchema: {
        graphId: z.string(),
        name: z.string().optional(),
        x: z.number(),
        y: z.number(),
        value: z.number().optional(),
        min: z.number().optional(),
        max: z.number().optional(),
        step: z.number().optional(),
        autoRecompute: z.boolean().optional(),
        backendUrl: z.string().optional(),
      },
    },
    async ({ graphId, name, x, y, value, min, max, step, autoRecompute, backendUrl }) => {
      const resolvedBackendUrl = resolveBackendUrl(backendUrl);
      const node = createNumericInputNode({
        name,
        x,
        y,
        value,
        min,
        max,
        step,
        autoRecompute,
      });

      const graph = await updateGraph(resolvedBackendUrl, graphId, (current) => ({
        ...current,
        nodes: [...current.nodes, node],
      }));

      return textResult({ graphId, nodeId: node.id, graph });
    }
  );

  server.registerTool(
    'node_add_annotation',
    {
      description: 'Add an annotation card node to a graph.',
      inputSchema: {
        graphId: z.string(),
        name: z.string().optional(),
        x: z.number(),
        y: z.number(),
        text: z.string().optional(),
        backgroundColor: z.string().optional(),
        borderColor: z.string().optional(),
        fontColor: z.string().optional(),
        fontSize: z.number().optional(),
        backendUrl: z.string().optional(),
      },
    },
    async ({
      graphId,
      name,
      x,
      y,
      text,
      backgroundColor,
      borderColor,
      fontColor,
      fontSize,
      backendUrl,
    }) => {
      const resolvedBackendUrl = resolveBackendUrl(backendUrl);
      const node = createAnnotationNode({
        name,
        x,
        y,
        text,
        backgroundColor,
        borderColor,
        fontColor,
        fontSize,
      });

      const graph = await updateGraph(resolvedBackendUrl, graphId, (current) => ({
        ...current,
        nodes: [...current.nodes, node],
      }));

      return textResult({ graphId, nodeId: node.id, graph });
    }
  );

  server.registerTool(
    'node_move',
    {
      description: 'Move a node to a new canvas position.',
      inputSchema: {
        graphId: z.string(),
        nodeId: z.string(),
        x: z.number(),
        y: z.number(),
        backendUrl: z.string().optional(),
      },
    },
    async ({ graphId, nodeId, x, y, backendUrl }) => {
      const resolvedBackendUrl = resolveBackendUrl(backendUrl);
      const graph = await updateGraph(resolvedBackendUrl, graphId, (current) => {
        getNode(current, nodeId);
        const projectionState = normalizeGraphProjectionState(
          current.nodes,
          current.projections,
          current.activeProjectionId,
          current.canvasBackground
        );
        const updatedNodes = current.nodes.map((node) =>
          node.id === nodeId
            ? {
                ...node,
                position: { x, y },
              }
            : node
        );
        const updatedProjections = projectionState.projections.map((projection) =>
          projection.id === projectionState.activeProjectionId
            ? {
                ...projection,
                nodePositions: {
                  ...projection.nodePositions,
                  [nodeId]: { x, y },
                },
              }
            : projection
        );

        return {
          ...current,
          nodes: updatedNodes,
          projections: updatedProjections,
          activeProjectionId: projectionState.activeProjectionId,
        };
      });

      return textResult(graph);
    }
  );

  server.registerTool(
    'node_set_name',
    {
      description: 'Rename a node/card.',
      inputSchema: {
        graphId: z.string(),
        nodeId: z.string(),
        name: z.string(),
        backendUrl: z.string().optional(),
      },
    },
    async ({ graphId, nodeId, name, backendUrl }) => {
      const resolvedBackendUrl = resolveBackendUrl(backendUrl);
      const graph = await updateGraph(resolvedBackendUrl, graphId, (current) => ({
        ...current,
        nodes: current.nodes.map((node) =>
          node.id === nodeId
            ? {
                ...node,
                metadata: {
                  ...node.metadata,
                  name,
                },
                version: ensureNodeVersion(node),
              }
            : node
        ),
      }));

      return textResult(graph);
    }
  );

  server.registerTool(
    'node_set_code',
    {
      description: 'Update inline code for a node.',
      inputSchema: {
        graphId: z.string(),
        nodeId: z.string(),
        code: z.string(),
        outputNames: z.array(z.string()).optional(),
        runtime: z.string().optional(),
        pythonEnv: z.string().optional(),
        backendUrl: z.string().optional(),
      },
    },
    async ({ graphId, nodeId, code, outputNames, runtime, pythonEnv, backendUrl }) => {
      const resolvedBackendUrl = resolveBackendUrl(backendUrl);
      const graph = await updateGraph(resolvedBackendUrl, graphId, (current) => ({
        ...current,
        nodes: current.nodes.map((node) =>
          node.id === nodeId
            ? updateInlineCodeNodeCode(node, code, current.connections, outputNames, runtime, pythonEnv)
            : node
        ),
      }));

      return textResult(graph);
    }
  );

  server.registerTool(
    'node_set_annotation',
    {
      description: 'Update annotation content or colors for an annotation node.',
      inputSchema: {
        graphId: z.string(),
        nodeId: z.string(),
        text: z.string().optional(),
        backgroundColor: z.string().optional(),
        borderColor: z.string().optional(),
        fontColor: z.string().optional(),
        fontSize: z.number().optional(),
        backendUrl: z.string().optional(),
      },
    },
    async ({
      graphId,
      nodeId,
      text,
      backgroundColor,
      borderColor,
      fontColor,
      fontSize,
      backendUrl,
    }) => {
      const resolvedBackendUrl = resolveBackendUrl(backendUrl);
      const graph = await updateGraph(resolvedBackendUrl, graphId, (current) => ({
        ...current,
        nodes: current.nodes.map((node) => {
          if (node.id !== nodeId) {
            return node;
          }
          if (node.type !== 'annotation') {
            throw new Error(`Node ${nodeId} is not an annotation node`);
          }
          return updateAnnotationNode(node, {
            text,
            backgroundColor,
            borderColor,
            fontColor,
            fontSize,
          });
        }),
      }));

      return textResult(graph);
    }
  );

  server.registerTool(
    'node_set_auto_recompute',
    {
      description: 'Enable/disable auto recompute for a node.',
      inputSchema: {
        graphId: z.string(),
        nodeId: z.string(),
        enabled: z.boolean(),
        backendUrl: z.string().optional(),
      },
    },
    async ({ graphId, nodeId, enabled, backendUrl }) => {
      const resolvedBackendUrl = resolveBackendUrl(backendUrl);
      const graph = await updateGraph(resolvedBackendUrl, graphId, (current) => ({
        ...current,
        nodes: current.nodes.map((node) =>
          node.id === nodeId
            ? {
                ...node,
                config: {
                  ...node.config,
                  config: {
                    ...(node.config.config ?? {}),
                    autoRecompute: enabled,
                  },
                },
                version: ensureNodeVersion(node),
              }
            : node
        ),
      }));

      return textResult(graph);
    }
  );

  server.registerTool(
    'node_add_input',
    {
      description: 'Add an input port to a node.',
      inputSchema: {
        graphId: z.string(),
        nodeId: z.string(),
        inputName: z.string(),
        backendUrl: z.string().optional(),
      },
    },
    async ({ graphId, nodeId, inputName, backendUrl }) => {
      assertValidPortName(inputName, 'input');
      const resolvedBackendUrl = resolveBackendUrl(backendUrl);

      const graph = await updateGraph(resolvedBackendUrl, graphId, (current) => {
        const node = getNode(current, nodeId);
        if (node.metadata.inputs.some((input) => input.name === inputName)) {
          throw new Error(`Input port ${inputName} already exists on node ${nodeId}`);
        }

        return {
          ...current,
          nodes: current.nodes.map((candidate) =>
            candidate.id === nodeId
              ? {
                  ...candidate,
                  metadata: {
                    ...candidate.metadata,
                    inputs: [
                      ...candidate.metadata.inputs,
                      {
                        name: inputName,
                        schema: { type: 'object' },
                      },
                    ],
                  },
                  version: ensureNodeVersion(candidate),
                }
              : candidate
          ),
        };
      });

      return textResult(graph);
    }
  );

  server.registerTool(
    'node_delete_input',
    {
      description: 'Delete an input port and remove connections targeting it.',
      inputSchema: {
        graphId: z.string(),
        nodeId: z.string(),
        inputName: z.string(),
        backendUrl: z.string().optional(),
      },
    },
    async ({ graphId, nodeId, inputName, backendUrl }) => {
      const resolvedBackendUrl = resolveBackendUrl(backendUrl);

      const graph = await updateGraph(resolvedBackendUrl, graphId, (current) => {
        const node = getNode(current, nodeId);
        if (!node.metadata.inputs.some((input) => input.name === inputName)) {
          throw new Error(`Input port ${inputName} was not found on node ${nodeId}`);
        }

        return {
          ...current,
          nodes: current.nodes.map((candidate) =>
            candidate.id === nodeId
              ? {
                  ...candidate,
                  metadata: {
                    ...candidate.metadata,
                    inputs: candidate.metadata.inputs.filter((input) => input.name !== inputName),
                  },
                  version: ensureNodeVersion(candidate),
                }
              : candidate
          ),
          connections: current.connections.filter(
            (connection) =>
              !(connection.targetNodeId === nodeId && connection.targetPort === inputName)
          ),
        };
      });

      return textResult(graph);
    }
  );

  server.registerTool(
    'node_move_input',
    {
      description: 'Reorder an input port by moving it up/down in the inputs list.',
      inputSchema: {
        graphId: z.string(),
        nodeId: z.string(),
        inputName: z.string(),
        direction: z.enum(['up', 'down']),
        backendUrl: z.string().optional(),
      },
    },
    async ({ graphId, nodeId, inputName, direction, backendUrl }) => {
      const resolvedBackendUrl = resolveBackendUrl(backendUrl);

      const graph = await updateGraph(resolvedBackendUrl, graphId, (current) => {
        const node = getNode(current, nodeId);
        const inputs = [...node.metadata.inputs];
        const index = inputs.findIndex((input) => input.name === inputName);
        if (index === -1) {
          throw new Error(`Input port ${inputName} was not found on node ${nodeId}`);
        }

        const targetIndex = direction === 'up' ? index - 1 : index + 1;
        if (targetIndex < 0 || targetIndex >= inputs.length) {
          return current;
        }

        [inputs[index], inputs[targetIndex]] = [inputs[targetIndex], inputs[index]];

        return {
          ...current,
          nodes: current.nodes.map((candidate) =>
            candidate.id === nodeId
              ? {
                  ...candidate,
                  metadata: {
                    ...candidate.metadata,
                    inputs,
                  },
                  version: ensureNodeVersion(candidate),
                }
              : candidate
          ),
        };
      });

      return textResult(graph);
    }
  );

  server.registerTool(
    'node_rename_input',
    {
      description: 'Rename an input port and retarget existing inbound connections.',
      inputSchema: {
        graphId: z.string(),
        nodeId: z.string(),
        oldName: z.string(),
        newName: z.string(),
        backendUrl: z.string().optional(),
      },
    },
    async ({ graphId, nodeId, oldName, newName, backendUrl }) => {
      assertValidPortName(newName, 'input');
      const resolvedBackendUrl = resolveBackendUrl(backendUrl);

      const graph = await updateGraph(resolvedBackendUrl, graphId, (current) => {
        const node = getNode(current, nodeId);
        if (!node.metadata.inputs.some((input) => input.name === oldName)) {
          throw new Error(`Input port ${oldName} was not found on node ${nodeId}`);
        }
        if (node.metadata.inputs.some((input) => input.name === newName)) {
          throw new Error(`Input port ${newName} already exists on node ${nodeId}`);
        }

        return {
          ...current,
          nodes: current.nodes.map((candidate) =>
            candidate.id === nodeId
              ? {
                  ...candidate,
                  metadata: {
                    ...candidate.metadata,
                    inputs: candidate.metadata.inputs.map((input) =>
                      input.name === oldName
                        ? {
                            ...input,
                            name: newName,
                          }
                        : input
                    ),
                  },
                  version: ensureNodeVersion(candidate),
                }
              : candidate
          ),
          connections: current.connections.map((connection) =>
            connection.targetNodeId === nodeId && connection.targetPort === oldName
              ? {
                  ...connection,
                  targetPort: newName,
                }
              : connection
          ),
        };
      });

      return textResult(graph);
    }
  );

  server.registerTool(
    'node_delete',
    {
      description: 'Delete a node and all connected edges.',
      inputSchema: {
        graphId: z.string(),
        nodeId: z.string(),
        backendUrl: z.string().optional(),
      },
    },
    async ({ graphId, nodeId, backendUrl }) => {
      const resolvedBackendUrl = resolveBackendUrl(backendUrl);
      const graph = await updateGraph(resolvedBackendUrl, graphId, (current) => ({
        ...current,
        nodes: current.nodes.filter((node) => node.id !== nodeId),
        connections: current.connections.filter(
          (connection) =>
            connection.sourceNodeId !== nodeId && connection.targetNodeId !== nodeId
        ),
      }));

      return textResult(graph);
    }
  );
}
