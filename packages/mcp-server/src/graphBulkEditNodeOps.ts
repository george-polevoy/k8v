import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { getNode } from './graphConnectionEdits.js';
import {
  applyProjectionToNodes,
  type GraphNode,
  normalizeGraphProjectionState,
} from './graphModel.js';
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
import type { BulkEditOperationHandler } from './graphBulkEditDomainTypes.js';

export const nodeBulkEditOperationSchemas = [
  z.object({
    op: z.literal('node_add_inline'),
    nodeId: z.string().trim().min(1).optional(),
    name: z.string().optional(),
    x: z.number(),
    y: z.number(),
    inputNames: z.array(z.string()).optional(),
    outputNames: z.array(z.string()).optional(),
    code: z.string().optional(),
    runtime: z.string().optional(),
    pythonEnv: z.string().optional(),
    autoRecompute: z.boolean().optional(),
  }),
  z.object({
    op: z.literal('node_add_numeric_input'),
    nodeId: z.string().trim().min(1).optional(),
    name: z.string().optional(),
    x: z.number(),
    y: z.number(),
    value: z.number().optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    step: z.number().optional(),
    autoRecompute: z.boolean().optional(),
  }),
  z.object({
    op: z.literal('node_add_annotation'),
    nodeId: z.string().trim().min(1).optional(),
    name: z.string().optional(),
    x: z.number(),
    y: z.number(),
    text: z.string().optional(),
    backgroundColor: z.string().optional(),
    borderColor: z.string().optional(),
    fontColor: z.string().optional(),
    fontSize: z.number().optional(),
  }),
  z.object({
    op: z.literal('node_move'),
    nodeId: z.string(),
    x: z.number(),
    y: z.number(),
  }),
  z.object({
    op: z.literal('node_set_name'),
    nodeId: z.string(),
    name: z.string(),
  }),
  z.object({
    op: z.literal('node_set_code'),
    nodeId: z.string(),
    code: z.string(),
    outputNames: z.array(z.string()).optional(),
    runtime: z.string().optional(),
    pythonEnv: z.string().optional(),
  }),
  z.object({
    op: z.literal('node_set_annotation'),
    nodeId: z.string(),
    text: z.string().optional(),
    backgroundColor: z.string().optional(),
    borderColor: z.string().optional(),
    fontColor: z.string().optional(),
    fontSize: z.number().optional(),
  }),
  z.object({
    op: z.literal('node_set_auto_recompute'),
    nodeId: z.string(),
    enabled: z.boolean(),
  }),
  z.object({
    op: z.literal('node_add_input'),
    nodeId: z.string(),
    inputName: z.string(),
  }),
  z.object({
    op: z.literal('node_delete_input'),
    nodeId: z.string(),
    inputName: z.string(),
  }),
  z.object({
    op: z.literal('node_move_input'),
    nodeId: z.string(),
    inputName: z.string(),
    direction: z.enum(['up', 'down']),
  }),
  z.object({
    op: z.literal('node_rename_input'),
    nodeId: z.string(),
    oldName: z.string(),
    newName: z.string(),
  }),
  z.object({
    op: z.literal('node_delete'),
    nodeId: z.string(),
  }),
] as const;

export const nodeBulkEditHandlers: Record<string, BulkEditOperationHandler> = {
  node_add_inline: (current, operation) => {
    const nodeId = operation.nodeId?.trim() || randomUUID();
    if (current.nodes.some((node) => node.id === nodeId)) {
      throw new Error(`Node ${nodeId} already exists in graph ${current.id}`);
    }

    const nowVersion = `${Date.now()}-${nodeId}`;
    const inlineCode = operation.code ?? 'outputs.output = inputs.input;';
    const inferredInputNames = inferInputPortNamesFromCode(inlineCode);
    const inferredOutputNames = inferOutputPortNamesFromCode(inlineCode);
    const resolvedInputNames = operation.inputNames && operation.inputNames.length > 0
      ? operation.inputNames
      : (inferredInputNames.length > 0 ? inferredInputNames : ['input']);
    const resolvedOutputNames = operation.outputNames && operation.outputNames.length > 0
      ? operation.outputNames
      : (inferredOutputNames.length > 0 ? inferredOutputNames : ['output']);

    const inputs = resolvedInputNames.map(
      (portName: string) => {
        assertValidPortName(portName, 'input');
        return {
          name: portName,
          schema: { type: 'object' as const },
        };
      }
    );

    const outputs = resolvedOutputNames.map(
      (portName: string) => {
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
      position: { x: operation.x, y: operation.y },
      metadata: {
        name: operation.name ?? 'Inline Code',
        inputs,
        outputs,
      },
      config: {
        type: 'inline_code',
        runtime: operation.runtime ?? 'javascript_vm',
        ...(operation.pythonEnv ? { pythonEnv: operation.pythonEnv } : {}),
        code: inlineCode,
        config: {
          autoRecompute: operation.autoRecompute ?? false,
        },
      },
      version: nowVersion,
    };

    return {
      graph: {
        ...current,
        nodes: [...current.nodes, node],
      },
      details: { nodeId },
    };
  },
  node_add_numeric_input: (current, operation) => {
    const node = createNumericInputNode({
      nodeId: operation.nodeId,
      name: operation.name,
      x: operation.x,
      y: operation.y,
      value: operation.value,
      min: operation.min,
      max: operation.max,
      step: operation.step,
      autoRecompute: operation.autoRecompute,
    });
    if (current.nodes.some((candidate) => candidate.id === node.id)) {
      throw new Error(`Node ${node.id} already exists in graph ${current.id}`);
    }

    return {
      graph: {
        ...current,
        nodes: [...current.nodes, node],
      },
      details: { nodeId: node.id },
    };
  },
  node_add_annotation: (current, operation) => {
    const node = createAnnotationNode({
      nodeId: operation.nodeId,
      name: operation.name,
      x: operation.x,
      y: operation.y,
      text: operation.text,
      backgroundColor: operation.backgroundColor,
      borderColor: operation.borderColor,
      fontColor: operation.fontColor,
      fontSize: operation.fontSize,
    });
    if (current.nodes.some((candidate) => candidate.id === node.id)) {
      throw new Error(`Node ${node.id} already exists in graph ${current.id}`);
    }

    return {
      graph: {
        ...current,
        nodes: [...current.nodes, node],
      },
      details: { nodeId: node.id },
    };
  },
  node_move: (current, operation) => {
    getNode(current, operation.nodeId);
    const projectionState = normalizeGraphProjectionState(
      current.nodes,
      current.projections,
      current.activeProjectionId,
      current.canvasBackground
    );
    const updatedNodes = current.nodes.map((node) =>
      node.id === operation.nodeId
        ? {
            ...node,
            position: { x: operation.x, y: operation.y },
          }
        : node
    );
    const updatedProjections = projectionState.projections.map((projection) =>
      projection.id === projectionState.activeProjectionId
        ? {
            ...projection,
            nodePositions: {
              ...projection.nodePositions,
              [operation.nodeId]: { x: operation.x, y: operation.y },
            },
          }
        : projection
    );

    return {
      graph: {
        ...current,
        nodes: updatedNodes,
        projections: updatedProjections,
        activeProjectionId: projectionState.activeProjectionId,
      },
    };
  },
  node_set_name: (current, operation) => ({
    graph: {
      ...current,
      nodes: current.nodes.map((node) =>
        node.id === operation.nodeId
          ? {
              ...node,
              metadata: {
                ...node.metadata,
                name: operation.name,
              },
              version: ensureNodeVersion(node),
            }
          : node
      ),
    },
  }),
  node_set_code: (current, operation) => ({
    graph: {
      ...current,
      nodes: current.nodes.map((node) =>
        node.id === operation.nodeId
          ? updateInlineCodeNodeCode(
              node,
              operation.code,
              current.connections,
              operation.outputNames,
              operation.runtime,
              operation.pythonEnv
            )
          : node
      ),
    },
  }),
  node_set_annotation: (current, operation) => ({
    graph: {
      ...current,
      nodes: current.nodes.map((node) => {
        if (node.id !== operation.nodeId) {
          return node;
        }
        if (node.type !== 'annotation') {
          throw new Error(`Node ${operation.nodeId} is not an annotation node`);
        }
        return updateAnnotationNode(node, {
          text: operation.text,
          backgroundColor: operation.backgroundColor,
          borderColor: operation.borderColor,
          fontColor: operation.fontColor,
          fontSize: operation.fontSize,
        });
      }),
    },
  }),
  node_set_auto_recompute: (current, operation) => ({
    graph: {
      ...current,
      nodes: current.nodes.map((node) =>
        node.id === operation.nodeId
          ? {
              ...node,
              config: {
                ...node.config,
                config: {
                  ...(node.config.config ?? {}),
                  autoRecompute: operation.enabled,
                },
              },
              version: ensureNodeVersion(node),
            }
          : node
      ),
    },
  }),
  node_add_input: (current, operation) => {
    assertValidPortName(operation.inputName, 'input');
    const node = getNode(current, operation.nodeId);
    if (node.metadata.inputs.some((input) => input.name === operation.inputName)) {
      throw new Error(`Input port ${operation.inputName} already exists on node ${operation.nodeId}`);
    }

    return {
      graph: {
        ...current,
        nodes: current.nodes.map((candidate) =>
          candidate.id === operation.nodeId
            ? {
                ...candidate,
                metadata: {
                  ...candidate.metadata,
                  inputs: [
                    ...candidate.metadata.inputs,
                    {
                      name: operation.inputName,
                      schema: { type: 'object' },
                    },
                  ],
                },
                version: ensureNodeVersion(candidate),
              }
            : candidate
        ),
      },
    };
  },
  node_delete_input: (current, operation) => {
    const node = getNode(current, operation.nodeId);
    if (!node.metadata.inputs.some((input) => input.name === operation.inputName)) {
      throw new Error(`Input port ${operation.inputName} was not found on node ${operation.nodeId}`);
    }

    return {
      graph: {
        ...current,
        nodes: current.nodes.map((candidate) =>
          candidate.id === operation.nodeId
            ? {
                ...candidate,
                metadata: {
                  ...candidate.metadata,
                  inputs: candidate.metadata.inputs.filter((input) => input.name !== operation.inputName),
                },
                version: ensureNodeVersion(candidate),
              }
            : candidate
        ),
        connections: current.connections.filter(
          (connection) =>
            !(connection.targetNodeId === operation.nodeId && connection.targetPort === operation.inputName)
        ),
      },
    };
  },
  node_move_input: (current, operation) => {
    const node = getNode(current, operation.nodeId);
    const inputs = [...node.metadata.inputs];
    const index = inputs.findIndex((input) => input.name === operation.inputName);
    if (index === -1) {
      throw new Error(`Input port ${operation.inputName} was not found on node ${operation.nodeId}`);
    }

    const targetIndex = operation.direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= inputs.length) {
      return { graph: current };
    }

    [inputs[index], inputs[targetIndex]] = [inputs[targetIndex], inputs[index]];

    return {
      graph: {
        ...current,
        nodes: current.nodes.map((candidate) =>
          candidate.id === operation.nodeId
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
      },
    };
  },
  node_rename_input: (current, operation) => {
    assertValidPortName(operation.newName, 'input');
    const node = getNode(current, operation.nodeId);
    if (!node.metadata.inputs.some((input) => input.name === operation.oldName)) {
      throw new Error(`Input port ${operation.oldName} was not found on node ${operation.nodeId}`);
    }
    if (node.metadata.inputs.some((input) => input.name === operation.newName)) {
      throw new Error(`Input port ${operation.newName} already exists on node ${operation.nodeId}`);
    }

    return {
      graph: {
        ...current,
        nodes: current.nodes.map((candidate) =>
          candidate.id === operation.nodeId
            ? {
                ...candidate,
                metadata: {
                  ...candidate.metadata,
                  inputs: candidate.metadata.inputs.map((input) =>
                    input.name === operation.oldName
                      ? {
                          ...input,
                          name: operation.newName,
                        }
                      : input
                  ),
                },
                version: ensureNodeVersion(candidate),
              }
            : candidate
        ),
        connections: current.connections.map((connection) =>
          connection.targetNodeId === operation.nodeId && connection.targetPort === operation.oldName
            ? {
                ...connection,
                targetPort: operation.newName,
              }
            : connection
        ),
      },
    };
  },
  node_delete: (current, operation) => ({
    graph: {
      ...current,
      nodes: current.nodes.filter((node) => node.id !== operation.nodeId),
      connections: current.connections.filter(
        (connection) =>
          connection.sourceNodeId !== operation.nodeId && connection.targetNodeId !== operation.nodeId
      ),
    },
  }),
};

