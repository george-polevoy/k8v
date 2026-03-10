import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  applyConnectionSet,
  assertConnectionPortsExist,
  getNode,
  matchesConnectionDefinition,
} from './graphConnectionEdits.js';
import {
  applyProjectionToNodes,
  cloneProjectionNodeCardSizes,
  cloneProjectionNodePositions,
  type Graph,
  type GraphNode,
  type GraphProjection,
  normalizeCanvasBackground,
  normalizeDrawingColor,
  normalizeGraphProjectionState,
  type PythonEnvironment,
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

const ConnectionAnchorSchema = z.object({
  side: z.enum(['top', 'right', 'bottom', 'left']),
  offset: z.number().finite().min(0).max(1),
});

export function getNextProjectionName(existingProjections: GraphProjection[]): string {
  const existingNames = new Set(existingProjections.map((projection) => projection.name));
  let index = 1;
  let candidate = `Projection ${index}`;
  while (existingNames.has(candidate)) {
    index += 1;
    candidate = `Projection ${index}`;
  }
  return candidate;
}

export const BULK_EDIT_OPERATION_SCHEMA = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('graph_set_name'),
    name: z.string(),
  }),
  z.object({
    op: z.literal('graph_projection_add'),
    projectionId: z.string().trim().min(1).optional(),
    name: z.string().trim().min(1).optional(),
    sourceProjectionId: z.string().trim().min(1).optional(),
    activate: z.boolean().optional(),
  }),
  z.object({
    op: z.literal('graph_projection_select'),
    projectionId: z.string().trim().min(1),
  }),
  z.object({
    op: z.literal('graph_python_env_add'),
    name: z.string().trim().min(1),
    pythonPath: z.string().trim().min(1),
    cwd: z.string().trim().min(1),
  }),
  z.object({
    op: z.literal('graph_python_env_edit'),
    envName: z.string().trim().min(1),
    name: z.string().trim().min(1).optional(),
    pythonPath: z.string().trim().min(1).optional(),
    cwd: z.string().trim().min(1).optional(),
  }),
  z.object({
    op: z.literal('graph_python_env_delete'),
    envName: z.string().trim().min(1),
  }),
  z.object({
    op: z.literal('drawing_create'),
    drawingId: z.string().trim().min(1).optional(),
    name: z.string().optional(),
    x: z.number().optional(),
    y: z.number().optional(),
  }),
  z.object({
    op: z.literal('drawing_add_path'),
    drawingId: z.string(),
    points: z.array(z.object({ x: z.number(), y: z.number() })).min(1),
    color: z.union([z.string().regex(/^#[0-9a-fA-F]{6}$/), z.enum(['white', 'green', 'red'])]).optional(),
    thickness: z.number().positive().optional(),
    pathId: z.string().optional(),
    coordinateSpace: z.enum(['world', 'local']).optional(),
  }),
  z.object({
    op: z.literal('drawing_move'),
    drawingId: z.string(),
    x: z.number(),
    y: z.number(),
  }),
  z.object({
    op: z.literal('drawing_set_name'),
    drawingId: z.string(),
    name: z.string(),
  }),
  z.object({
    op: z.literal('drawing_delete'),
    drawingId: z.string(),
  }),
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
  z.object({
    op: z.literal('connection_add'),
    sourceNodeId: z.string(),
    sourcePort: z.string(),
    sourceAnchor: ConnectionAnchorSchema.optional(),
    targetNodeId: z.string(),
    targetPort: z.string(),
    targetAnchor: ConnectionAnchorSchema.optional(),
    connectionId: z.string().optional(),
  }),
  z.object({
    op: z.enum(['connection_set', 'connection_replace']),
    sourceNodeId: z.string(),
    sourcePort: z.string(),
    sourceAnchor: ConnectionAnchorSchema.optional(),
    targetNodeId: z.string(),
    targetPort: z.string(),
    targetAnchor: ConnectionAnchorSchema.optional(),
    connectionId: z.string().optional(),
  }),
  z.object({
    op: z.literal('connection_delete'),
    connectionId: z.string(),
  }),
]);

export type BulkEditOperation = z.infer<typeof BULK_EDIT_OPERATION_SCHEMA>;

type BulkEditOperationResult = {
  graph: Graph;
  details?: Record<string, unknown>;
};

export function applyBulkEditOperation(current: Graph, operation: BulkEditOperation): BulkEditOperationResult {
  switch (operation.op) {
    case 'graph_set_name':
      return {
        graph: {
          ...current,
          name: operation.name,
        },
      };
    case 'graph_projection_add': {
      const projectionState = normalizeGraphProjectionState(
        current.nodes,
        current.projections,
        current.activeProjectionId,
        current.canvasBackground
      );

      const sourceId = operation.sourceProjectionId?.trim() || projectionState.activeProjectionId;
      const sourceProjection = projectionState.projections.find((projection) => projection.id === sourceId);
      if (!sourceProjection) {
        throw new Error(`Projection "${sourceId}" was not found in graph ${current.id}`);
      }

      const nextProjectionId = operation.projectionId?.trim() || randomUUID();
      if (projectionState.projections.some((projection) => projection.id === nextProjectionId)) {
        throw new Error(`Projection "${nextProjectionId}" already exists in graph ${current.id}`);
      }

      const newProjection: GraphProjection = {
        id: nextProjectionId,
        name: operation.name?.trim() || getNextProjectionName(projectionState.projections),
        nodePositions: cloneProjectionNodePositions(current.nodes, sourceProjection),
        nodeCardSizes: cloneProjectionNodeCardSizes(current.nodes, sourceProjection),
        canvasBackground: normalizeCanvasBackground(
          sourceProjection.canvasBackground ?? current.canvasBackground
        ),
      };

      const nextActiveProjectionId = operation.activate === false
        ? projectionState.activeProjectionId
        : newProjection.id;
      const activeProjection = nextActiveProjectionId === newProjection.id
        ? newProjection
        : projectionState.projections.find(
            (projection) => projection.id === nextActiveProjectionId
          ) ?? newProjection;

      return {
        graph: {
          ...current,
          projections: [...projectionState.projections, newProjection],
          activeProjectionId: nextActiveProjectionId,
          nodes: applyProjectionToNodes(current.nodes, activeProjection),
          canvasBackground: normalizeCanvasBackground(
            activeProjection.canvasBackground ?? current.canvasBackground
          ),
        },
        details: {
          projectionId: newProjection.id,
          activeProjectionId: nextActiveProjectionId,
        },
      };
    }
    case 'graph_projection_select': {
      const projectionState = normalizeGraphProjectionState(
        current.nodes,
        current.projections,
        current.activeProjectionId,
        current.canvasBackground
      );
      const selectedProjection = projectionState.projections.find(
        (projection) => projection.id === operation.projectionId
      );
      if (!selectedProjection) {
        throw new Error(`Projection "${operation.projectionId}" was not found in graph ${current.id}`);
      }

      return {
        graph: {
          ...current,
          projections: projectionState.projections,
          activeProjectionId: selectedProjection.id,
          nodes: applyProjectionToNodes(current.nodes, selectedProjection),
          canvasBackground: normalizeCanvasBackground(
            selectedProjection.canvasBackground ?? current.canvasBackground
          ),
        },
      };
    }
    case 'graph_python_env_add': {
      const existingEnvs = current.pythonEnvs ?? [];
      if (existingEnvs.some((env) => env.name === operation.name)) {
        throw new Error(`Python environment "${operation.name}" already exists in graph ${current.id}`);
      }

      return {
        graph: {
          ...current,
          pythonEnvs: [
            ...existingEnvs,
            {
              name: operation.name,
              pythonPath: operation.pythonPath,
              cwd: operation.cwd,
            },
          ],
        },
      };
    }
    case 'graph_python_env_edit': {
      const existingEnvs = current.pythonEnvs ?? [];
      const envIndex = existingEnvs.findIndex((env) => env.name === operation.envName);
      if (envIndex === -1) {
        throw new Error(`Python environment "${operation.envName}" was not found in graph ${current.id}`);
      }

      const existingEnv = existingEnvs[envIndex];
      const nextEnvName = operation.name ?? existingEnv.name;
      const nextEnv: PythonEnvironment = {
        name: nextEnvName,
        pythonPath: operation.pythonPath ?? existingEnv.pythonPath,
        cwd: operation.cwd ?? existingEnv.cwd,
      };

      const duplicateName = existingEnvs.some(
        (env, index) => index !== envIndex && env.name === nextEnv.name
      );
      if (duplicateName) {
        throw new Error(`Python environment "${nextEnv.name}" already exists in graph ${current.id}`);
      }

      const nextNodes =
        nextEnvName === operation.envName
          ? current.nodes
          : current.nodes.map((node) =>
              node.config.pythonEnv === operation.envName
                ? {
                    ...node,
                    config: {
                      ...node.config,
                      pythonEnv: nextEnvName,
                    },
                    version: ensureNodeVersion(node),
                  }
                : node
            );

      return {
        graph: {
          ...current,
          pythonEnvs: existingEnvs.map((env, index) => (index === envIndex ? nextEnv : env)),
          nodes: nextNodes,
        },
      };
    }
    case 'graph_python_env_delete': {
      const existingEnvs = current.pythonEnvs ?? [];
      const hasEnv = existingEnvs.some((env) => env.name === operation.envName);
      if (!hasEnv) {
        throw new Error(`Python environment "${operation.envName}" was not found in graph ${current.id}`);
      }

      return {
        graph: {
          ...current,
          pythonEnvs: existingEnvs.filter((env) => env.name !== operation.envName),
          nodes: current.nodes.map((node) =>
            node.config.pythonEnv === operation.envName
              ? {
                  ...node,
                  config: {
                    ...node.config,
                    pythonEnv: undefined,
                  },
                  version: ensureNodeVersion(node),
                }
              : node
          ),
        },
      };
    }
    case 'drawing_create': {
      const drawingId = operation.drawingId?.trim() || randomUUID();
      if ((current.drawings ?? []).some((drawing) => drawing.id === drawingId)) {
        throw new Error(`Drawing ${drawingId} already exists in graph ${current.id}`);
      }

      return {
        graph: {
          ...current,
          drawings: [
            ...(current.drawings ?? []),
            {
              id: drawingId,
              name: operation.name ?? `Drawing ${((current.drawings ?? []).length + 1)}`,
              position: {
                x: operation.x ?? 0,
                y: operation.y ?? 0,
              },
              paths: [],
            },
          ],
        },
        details: { drawingId },
      };
    }
    case 'drawing_add_path': {
      const drawing = (current.drawings ?? []).find((candidate) => candidate.id === operation.drawingId);
      if (!drawing) {
        throw new Error(`Drawing ${operation.drawingId} not found in graph ${current.id}`);
      }

      const localPoints = (operation.coordinateSpace ?? 'world') === 'local'
        ? operation.points
        : operation.points.map((point) => ({
            x: point.x - drawing.position.x,
            y: point.y - drawing.position.y,
          }));
      const nextPathId = operation.pathId ?? randomUUID();

      return {
        graph: {
          ...current,
          drawings: (current.drawings ?? []).map((candidate) =>
            candidate.id === operation.drawingId
              ? {
                  ...candidate,
                  paths: [
                    ...candidate.paths,
                    {
                      id: nextPathId,
                      color: normalizeDrawingColor(operation.color, '#ffffff'),
                      thickness: operation.thickness ?? 3,
                      points: localPoints,
                    },
                  ],
                }
              : candidate
          ),
        },
        details: {
          drawingId: operation.drawingId,
          pathId: nextPathId,
        },
      };
    }
    case 'drawing_move':
      return {
        graph: {
          ...current,
          drawings: (current.drawings ?? []).map((drawing) =>
            drawing.id === operation.drawingId
              ? {
                  ...drawing,
                  position: { x: operation.x, y: operation.y },
                }
              : drawing
          ),
        },
      };
    case 'drawing_set_name':
      return {
        graph: {
          ...current,
          drawings: (current.drawings ?? []).map((drawing) =>
            drawing.id === operation.drawingId
              ? {
                  ...drawing,
                  name: operation.name,
                }
              : drawing
          ),
        },
      };
    case 'drawing_delete':
      return {
        graph: {
          ...current,
          drawings: (current.drawings ?? []).filter((drawing) => drawing.id !== operation.drawingId),
        },
      };
    case 'node_add_inline': {
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
    }
    case 'node_add_numeric_input': {
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
    }
    case 'node_add_annotation': {
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
    }
    case 'node_move': {
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
    }
    case 'node_set_name':
      return {
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
      };
    case 'node_set_code':
      return {
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
      };
    case 'node_set_annotation':
      return {
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
      };
    case 'node_set_auto_recompute':
      return {
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
      };
    case 'node_add_input': {
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
    }
    case 'node_delete_input': {
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
    }
    case 'node_move_input': {
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
    }
    case 'node_rename_input': {
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
    }
    case 'node_delete':
      return {
        graph: {
          ...current,
          nodes: current.nodes.filter((node) => node.id !== operation.nodeId),
          connections: current.connections.filter(
            (connection) =>
              connection.sourceNodeId !== operation.nodeId && connection.targetNodeId !== operation.nodeId
          ),
        },
      };
    case 'connection_add': {
      assertConnectionPortsExist(
        current,
        operation.sourceNodeId,
        operation.sourcePort,
        operation.targetNodeId,
        operation.targetPort,
        operation.sourceAnchor,
        operation.targetAnchor
      );

      const duplicate = current.connections.some(
        (connection) => matchesConnectionDefinition(connection, {
          sourceNodeId: operation.sourceNodeId,
          sourcePort: operation.sourcePort,
          sourceAnchor: operation.sourceAnchor,
          targetNodeId: operation.targetNodeId,
          targetPort: operation.targetPort,
          targetAnchor: operation.targetAnchor,
        })
      );
      if (duplicate) {
        return { graph: current };
      }

      return {
        graph: {
          ...current,
          connections: [
            ...current.connections,
            {
              id: operation.connectionId ?? randomUUID(),
              sourceNodeId: operation.sourceNodeId,
              sourcePort: operation.sourcePort,
              ...(operation.sourceAnchor ? { sourceAnchor: operation.sourceAnchor } : {}),
              targetNodeId: operation.targetNodeId,
              targetPort: operation.targetPort,
              ...(operation.targetAnchor ? { targetAnchor: operation.targetAnchor } : {}),
            },
          ],
        },
      };
    }
    case 'connection_set':
    case 'connection_replace': {
      const result = applyConnectionSet(current, {
        sourceNodeId: operation.sourceNodeId,
        sourcePort: operation.sourcePort,
        sourceAnchor: operation.sourceAnchor,
        targetNodeId: operation.targetNodeId,
        targetPort: operation.targetPort,
        targetAnchor: operation.targetAnchor,
        connectionId: operation.connectionId,
      });

      if (!result.changed) {
        return { graph: current };
      }

      return {
        graph: {
          ...current,
          connections: result.connections,
        },
        details: {
          connection: result.connection,
          replacedConnectionIds: result.replacedConnectionIds,
        },
      };
    }
    case 'connection_delete':
      return {
        graph: {
          ...current,
          connections: current.connections.filter(
            (connection) => connection.id !== operation.connectionId
          ),
        },
      };
  }
}
