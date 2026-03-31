import type {
  Connection,
  Graph,
  GraphCommand,
  GraphNode,
  GraphProjection,
  PythonEnvironment,
} from './index.js';
import { DEFAULT_GRAPH_PROJECTION_ID } from './index.js';
import {
  applyConnectionSet,
  assertConnectionPortsExist,
  getNode,
  matchesConnectionDefinition,
} from './graphConnection.js';
import {
  applyProjectionToNodes,
  cloneProjectionNodeCardSizes,
  cloneProjectionNodePositions,
  syncActiveProjectionLayout,
} from './graphProjection.js';
import { DEFAULT_DRAWING_COLOR, normalizeDrawingColor } from './graphDrawing.js';
import { getNextProjectionName } from './graphState.js';
import {
  assertValidPortName,
  createAnnotationNode,
  createInlineCodeNode,
  createNumericInputNode,
  ensureNodeVersion,
  inferInputPortNamesFromCode,
  inferOutputPortNamesFromCode,
  updateAnnotationNode,
  updateInlineCodeNodeCode,
} from './graphNodes.js';

function createGeneratedId(prefix: string): string {
  const cryptoLike = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  return cryptoLike?.randomUUID?.() ?? `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function replaceNode(
  graph: Graph,
  nodeId: string,
  updater: (node: GraphNode) => GraphNode
): Graph {
  return {
    ...graph,
    nodes: graph.nodes.map((node) => (node.id === nodeId ? updater(node) : node)),
  };
}

export function applyGraphCommandMutation(graph: Graph, command: GraphCommand): Graph {
  switch (command.kind) {
    case 'compute_graph':
    case 'compute_node':
      return graph;

    case 'replace_nodes':
      return {
        ...graph,
        nodes: command.nodes,
        projections: syncActiveProjectionLayout(
          graph.projections,
          command.nodes,
          graph.activeProjectionId
        ),
      };

    case 'replace_connections':
      return {
        ...graph,
        connections: command.connections,
      };

    case 'replace_drawings':
      return {
        ...graph,
        drawings: command.drawings,
      };

    case 'replace_projections':
      if (command.projections.length === 0) {
        throw new Error('At least one projection must remain in the graph.');
      }
      return {
        ...graph,
        projections: command.projections,
      };

    case 'replace_cameras':
      return {
        ...graph,
        cameras: command.cameras,
      };

    case 'replace_python_envs':
      return {
        ...graph,
        pythonEnvs: command.pythonEnvs,
      };

    case 'set_graph_name':
      return {
        ...graph,
        name: command.name,
      };

    case 'set_recompute_concurrency':
      return {
        ...graph,
        recomputeConcurrency: command.recomputeConcurrency,
      };

    case 'set_execution_timeout':
      return {
        ...graph,
        executionTimeoutMs: command.executionTimeoutMs,
      };

    case 'set_connection_stroke':
      return {
        ...graph,
        connectionStroke: command.connectionStroke,
      };

    case 'set_canvas_background': {
      const activeProjectionId = graph.activeProjectionId ?? DEFAULT_GRAPH_PROJECTION_ID;
      return {
        ...graph,
        canvasBackground: command.canvasBackground,
        projections: (graph.projections ?? []).map((projection) =>
          projection.id === activeProjectionId
            ? {
                ...projection,
                canvasBackground: command.canvasBackground,
              }
            : projection
        ),
      };
    }

    case 'set_active_projection':
      return applyGraphCommandMutation(graph, {
        kind: 'graph_projection_select',
        projectionId: command.activeProjectionId,
      });

    case 'graph_projection_add': {
      const projections = graph.projections ?? [];
      const sourceId =
        command.sourceProjectionId?.trim() ||
        graph.activeProjectionId ||
        DEFAULT_GRAPH_PROJECTION_ID;
      const sourceProjection = projections.find((projection) => projection.id === sourceId);
      if (!sourceProjection) {
        throw new Error(`Projection "${sourceId}" was not found in graph ${graph.id}`);
      }

      const nextProjectionId = command.projectionId?.trim() || createGeneratedId('projection');
      if (projections.some((projection) => projection.id === nextProjectionId)) {
        throw new Error(`Projection "${nextProjectionId}" already exists in graph ${graph.id}`);
      }

      const newProjection: GraphProjection = {
        id: nextProjectionId,
        name: command.name?.trim() || getNextProjectionName(projections.map((projection) => projection.name)),
        nodePositions: cloneProjectionNodePositions(graph.nodes, sourceProjection),
        nodeCardSizes: cloneProjectionNodeCardSizes(graph.nodes, sourceProjection),
        canvasBackground: sourceProjection.canvasBackground ?? graph.canvasBackground,
      };

      const nextActiveProjectionId = command.activate === false
        ? graph.activeProjectionId ?? DEFAULT_GRAPH_PROJECTION_ID
        : newProjection.id;
      const activeProjection = nextActiveProjectionId === newProjection.id
        ? newProjection
        : projections.find((projection) => projection.id === nextActiveProjectionId) ?? newProjection;

      return {
        ...graph,
        projections: [...projections, newProjection],
        activeProjectionId: nextActiveProjectionId,
        nodes: applyProjectionToNodes(graph.nodes, activeProjection),
        canvasBackground: activeProjection.canvasBackground ?? graph.canvasBackground,
      };
    }

    case 'graph_projection_select': {
      const projection = (graph.projections ?? []).find(
        (candidate) => candidate.id === command.projectionId
      );
      if (!projection) {
        throw new Error(`Projection "${command.projectionId}" was not found in graph ${graph.id}`);
      }

      return {
        ...graph,
        activeProjectionId: projection.id,
        nodes: applyProjectionToNodes(graph.nodes, projection),
        canvasBackground: projection.canvasBackground ?? graph.canvasBackground,
      };
    }

    case 'graph_python_env_add': {
      const existingEnvs = graph.pythonEnvs ?? [];
      if (existingEnvs.some((env) => env.name === command.name)) {
        throw new Error(`Python environment "${command.name}" already exists in graph ${graph.id}`);
      }

      return {
        ...graph,
        pythonEnvs: [
          ...existingEnvs,
          {
            name: command.name,
            pythonPath: command.pythonPath,
            cwd: command.cwd,
          },
        ],
      };
    }

    case 'graph_python_env_edit': {
      const existingEnvs = graph.pythonEnvs ?? [];
      const envIndex = existingEnvs.findIndex((env) => env.name === command.envName);
      if (envIndex === -1) {
        throw new Error(`Python environment "${command.envName}" was not found in graph ${graph.id}`);
      }

      const existingEnv = existingEnvs[envIndex];
      const nextEnvName = command.name ?? existingEnv.name;
      const nextEnv: PythonEnvironment = {
        name: nextEnvName,
        pythonPath: command.pythonPath ?? existingEnv.pythonPath,
        cwd: command.cwd ?? existingEnv.cwd,
      };
      const duplicateName = existingEnvs.some(
        (env, index) => index !== envIndex && env.name === nextEnv.name
      );
      if (duplicateName) {
        throw new Error(`Python environment "${nextEnv.name}" already exists in graph ${graph.id}`);
      }

      return {
        ...graph,
        pythonEnvs: existingEnvs.map((env, index) => (index === envIndex ? nextEnv : env)),
        nodes:
          nextEnvName === command.envName
            ? graph.nodes
            : graph.nodes.map((node) =>
                node.config.pythonEnv === command.envName
                  ? {
                      ...node,
                      config: {
                        ...node.config,
                        pythonEnv: nextEnvName,
                      },
                      version: ensureNodeVersion(node),
                    }
                  : node
              ),
      };
    }

    case 'graph_python_env_delete': {
      const existingEnvs = graph.pythonEnvs ?? [];
      if (!existingEnvs.some((env) => env.name === command.envName)) {
        throw new Error(`Python environment "${command.envName}" was not found in graph ${graph.id}`);
      }

      return {
        ...graph,
        pythonEnvs: existingEnvs.filter((env) => env.name !== command.envName),
        nodes: graph.nodes.map((node) =>
          node.config.pythonEnv === command.envName
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
      };
    }

    case 'node_add_inline': {
      const inlineCode = command.code ?? 'outputs.output = inputs.input;';
      const inferredInputNames = inferInputPortNamesFromCode(inlineCode);
      const inferredOutputNames = inferOutputPortNamesFromCode(inlineCode);
      const resolvedInputNames = command.inputNames?.length
        ? command.inputNames
        : inferredInputNames.length > 0
          ? inferredInputNames
          : ['input'];
      const resolvedOutputNames = command.outputNames?.length
        ? command.outputNames
        : inferredOutputNames.length > 0
          ? inferredOutputNames
          : ['output'];

      for (const inputName of resolvedInputNames) {
        assertValidPortName(inputName, 'input');
      }
      for (const outputName of resolvedOutputNames) {
        assertValidPortName(outputName, 'output');
      }

      const node = createInlineCodeNode({
        nodeId: command.nodeId,
        name: command.name,
        position: { x: command.x, y: command.y },
        cardWidth: command.cardWidth,
        cardHeight: command.cardHeight,
        custom: command.custom,
        inputNames: resolvedInputNames,
        outputNames: resolvedOutputNames,
        code: inlineCode,
        runtime: command.runtime,
        pythonEnv: command.pythonEnv,
        autoRecompute: command.autoRecompute,
      });
      if (graph.nodes.some((candidate) => candidate.id === node.id)) {
        throw new Error(`Node ${node.id} already exists in graph ${graph.id}`);
      }
      return {
        ...graph,
        nodes: [...graph.nodes, node],
      };
    }

    case 'node_add_numeric_input': {
      const node = createNumericInputNode({
        nodeId: command.nodeId,
        name: command.name,
        position: { x: command.x, y: command.y },
        cardWidth: command.cardWidth,
        cardHeight: command.cardHeight,
        custom: command.custom,
        value: command.value,
        min: command.min,
        max: command.max,
        step: command.step,
        autoRecompute: command.autoRecompute,
      });
      if (graph.nodes.some((candidate) => candidate.id === node.id)) {
        throw new Error(`Node ${node.id} already exists in graph ${graph.id}`);
      }
      return {
        ...graph,
        nodes: [...graph.nodes, node],
      };
    }

    case 'node_add_annotation': {
      const node = createAnnotationNode({
        nodeId: command.nodeId,
        name: command.name,
        position: { x: command.x, y: command.y },
        cardWidth: command.cardWidth,
        cardHeight: command.cardHeight,
        custom: command.custom,
        text: command.text,
        backgroundColor: command.backgroundColor,
        borderColor: command.borderColor,
        fontColor: command.fontColor,
        fontSize: command.fontSize,
      });
      if (graph.nodes.some((candidate) => candidate.id === node.id)) {
        throw new Error(`Node ${node.id} already exists in graph ${graph.id}`);
      }
      return {
        ...graph,
        nodes: [...graph.nodes, node],
      };
    }

    case 'node_move':
      getNode(graph, command.nodeId);
      return replaceNode(graph, command.nodeId, (node) => ({
        ...node,
        position: { x: command.x, y: command.y },
      }));

    case 'node_set_name':
      return replaceNode(graph, command.nodeId, (node) => ({
        ...node,
        metadata: {
          ...node.metadata,
          name: command.name,
        },
        version: ensureNodeVersion(node),
      }));

    case 'node_set_custom':
      return replaceNode(graph, command.nodeId, (node) => ({
        ...node,
        metadata: {
          ...node.metadata,
          custom: typeof structuredClone === 'function'
            ? structuredClone(command.custom)
            : JSON.parse(JSON.stringify(command.custom)) as typeof command.custom,
        },
        version: ensureNodeVersion(node),
      }));

    case 'node_set_code':
      return replaceNode(graph, command.nodeId, (node) => {
        if (node.type !== 'inline_code') {
          throw new Error(`Node ${command.nodeId} is not an inline code node`);
        }
        return updateInlineCodeNodeCode(
          node,
          command.code,
          graph.connections,
          command.outputNames,
          command.runtime,
          command.pythonEnv
        );
      });

    case 'node_set_annotation':
      return replaceNode(graph, command.nodeId, (node) => {
        if (node.type !== 'annotation') {
          throw new Error(`Node ${command.nodeId} is not an annotation node`);
        }
        return updateAnnotationNode(node, {
          text: command.text,
          backgroundColor: command.backgroundColor,
          borderColor: command.borderColor,
          fontColor: command.fontColor,
          fontSize: command.fontSize,
        });
      });

    case 'node_set_auto_recompute':
      return replaceNode(graph, command.nodeId, (node) => ({
        ...node,
        config: {
          ...node.config,
          config: {
            ...(node.config.config ?? {}),
            autoRecompute: command.enabled,
          },
        },
        version: ensureNodeVersion(node),
      }));

    case 'node_add_input': {
      assertValidPortName(command.inputName, 'input');
      const node = getNode(graph, command.nodeId);
      if (node.metadata.inputs.some((input) => input.name === command.inputName)) {
        throw new Error(`Input port ${command.inputName} already exists on node ${command.nodeId}`);
      }
      return replaceNode(graph, command.nodeId, (candidate) => ({
        ...candidate,
        metadata: {
          ...candidate.metadata,
          inputs: [
            ...candidate.metadata.inputs,
            {
              name: command.inputName,
              schema: { type: 'object' as const },
            },
          ],
        },
        version: ensureNodeVersion(candidate),
      }));
    }

    case 'node_delete_input': {
      const node = getNode(graph, command.nodeId);
      if (!node.metadata.inputs.some((input) => input.name === command.inputName)) {
        throw new Error(`Input port ${command.inputName} was not found on node ${command.nodeId}`);
      }
      return {
        ...replaceNode(graph, command.nodeId, (candidate) => ({
          ...candidate,
          metadata: {
            ...candidate.metadata,
            inputs: candidate.metadata.inputs.filter((input) => input.name !== command.inputName),
          },
          version: ensureNodeVersion(candidate),
        })),
        connections: graph.connections.filter(
          (connection) =>
            !(connection.targetNodeId === command.nodeId && connection.targetPort === command.inputName)
        ),
      };
    }

    case 'node_move_input': {
      const node = getNode(graph, command.nodeId);
      const inputs = [...node.metadata.inputs];
      const index = inputs.findIndex((input) => input.name === command.inputName);
      if (index === -1) {
        throw new Error(`Input port ${command.inputName} was not found on node ${command.nodeId}`);
      }

      const targetIndex = command.direction === 'up' ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= inputs.length) {
        return graph;
      }

      [inputs[index], inputs[targetIndex]] = [inputs[targetIndex], inputs[index]];
      return replaceNode(graph, command.nodeId, (candidate) => ({
        ...candidate,
        metadata: {
          ...candidate.metadata,
          inputs,
        },
        version: ensureNodeVersion(candidate),
      }));
    }

    case 'node_rename_input': {
      assertValidPortName(command.newName, 'input');
      const node = getNode(graph, command.nodeId);
      if (!node.metadata.inputs.some((input) => input.name === command.oldName)) {
        throw new Error(`Input port ${command.oldName} was not found on node ${command.nodeId}`);
      }
      if (node.metadata.inputs.some((input) => input.name === command.newName)) {
        throw new Error(`Input port ${command.newName} already exists on node ${command.nodeId}`);
      }
      return {
        ...replaceNode(graph, command.nodeId, (candidate) => ({
          ...candidate,
          metadata: {
            ...candidate.metadata,
            inputs: candidate.metadata.inputs.map((input) =>
              input.name === command.oldName
                ? {
                    ...input,
                    name: command.newName,
                  }
                : input
            ),
          },
          version: ensureNodeVersion(candidate),
        })),
        connections: graph.connections.map((connection) =>
          connection.targetNodeId === command.nodeId && connection.targetPort === command.oldName
            ? {
                ...connection,
                targetPort: command.newName,
              }
            : connection
        ),
      };
    }

    case 'node_delete':
      return {
        ...graph,
        nodes: graph.nodes.filter((node) => node.id !== command.nodeId),
        connections: graph.connections.filter(
          (connection) =>
            connection.sourceNodeId !== command.nodeId && connection.targetNodeId !== command.nodeId
        ),
      };

    case 'connection_add': {
      assertConnectionPortsExist(
        graph,
        command.sourceNodeId,
        command.sourcePort,
        command.targetNodeId,
        command.targetPort,
        command.sourceAnchor,
        command.targetAnchor
      );
      const duplicate = graph.connections.some((connection) =>
        matchesConnectionDefinition(connection, {
          sourceNodeId: command.sourceNodeId,
          sourcePort: command.sourcePort,
          sourceAnchor: command.sourceAnchor,
          targetNodeId: command.targetNodeId,
          targetPort: command.targetPort,
          targetAnchor: command.targetAnchor,
        })
      );
      if (duplicate) {
        return graph;
      }
      return {
        ...graph,
        connections: [
          ...graph.connections,
          {
            id: command.connectionId ?? createGeneratedId('connection'),
            sourceNodeId: command.sourceNodeId,
            sourcePort: command.sourcePort,
            ...(command.sourceAnchor ? { sourceAnchor: command.sourceAnchor } : {}),
            targetNodeId: command.targetNodeId,
            targetPort: command.targetPort,
            ...(command.targetAnchor ? { targetAnchor: command.targetAnchor } : {}),
          },
        ],
      };
    }

    case 'connection_set':
    case 'connection_replace': {
      const result = applyConnectionSet(graph, {
        sourceNodeId: command.sourceNodeId,
        sourcePort: command.sourcePort,
        sourceAnchor: command.sourceAnchor,
        targetNodeId: command.targetNodeId,
        targetPort: command.targetPort,
        targetAnchor: command.targetAnchor,
        connectionId: command.connectionId,
      });
      if (!result.changed) {
        return graph;
      }
      return {
        ...graph,
        connections: result.connections,
      };
    }

    case 'connection_delete':
      return {
        ...graph,
        connections: graph.connections.filter((connection) => connection.id !== command.connectionId),
      };

    case 'drawing_create': {
      const drawingId = command.drawingId?.trim() || createGeneratedId('drawing');
      if ((graph.drawings ?? []).some((drawing) => drawing.id === drawingId)) {
        throw new Error(`Drawing ${drawingId} already exists in graph ${graph.id}`);
      }
      return {
        ...graph,
        drawings: [
          ...(graph.drawings ?? []),
          {
            id: drawingId,
            name: command.name ?? `Drawing ${((graph.drawings ?? []).length + 1)}`,
            position: {
              x: command.x ?? 0,
              y: command.y ?? 0,
            },
            paths: [],
          },
        ],
      };
    }

    case 'drawing_add_path': {
      const drawing = (graph.drawings ?? []).find((candidate) => candidate.id === command.drawingId);
      if (!drawing) {
        throw new Error(`Drawing ${command.drawingId} not found in graph ${graph.id}`);
      }
      const localPoints =
        (command.coordinateSpace ?? 'world') === 'local'
          ? command.points
          : command.points.map((point) => ({
              x: point.x - drawing.position.x,
              y: point.y - drawing.position.y,
            }));
      const pathId = command.pathId ?? createGeneratedId('path');
      return {
        ...graph,
        drawings: (graph.drawings ?? []).map((candidate) =>
          candidate.id === command.drawingId
            ? {
                ...candidate,
                paths: [
                  ...candidate.paths,
                  {
                    id: pathId,
                    color: normalizeDrawingColor(command.color, '#ffffff'),
                    thickness: command.thickness ?? 3,
                    points: localPoints,
                  },
                ],
              }
            : candidate
        ),
      };
    }

    case 'drawing_move':
      return {
        ...graph,
        drawings: (graph.drawings ?? []).map((drawing) =>
          drawing.id === command.drawingId
            ? {
                ...drawing,
                position: { x: command.x, y: command.y },
              }
            : drawing
        ),
      };

    case 'drawing_set_name':
      return {
        ...graph,
        drawings: (graph.drawings ?? []).map((drawing) =>
          drawing.id === command.drawingId
            ? {
                ...drawing,
                name: command.name,
              }
            : drawing
        ),
      };

    case 'drawing_delete':
      return {
        ...graph,
        drawings: (graph.drawings ?? []).filter((drawing) => drawing.id !== command.drawingId),
      };

    default:
      throw new Error(`Unsupported graph mutation command: ${JSON.stringify(command)}`);
  }
}

export function applyGraphCommands(graph: Graph, commands: GraphCommand[]): Graph {
  return commands.reduce((current, command) => applyGraphCommandMutation(current, command), graph);
}
