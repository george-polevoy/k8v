import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  applyProjectionToNodes,
  cloneProjectionNodeCardSizes,
  cloneProjectionNodePositions,
  type GraphProjection,
  normalizeCanvasBackground,
  normalizeGraphProjectionState,
  type PythonEnvironment,
} from './graphModel.js';
import { ensureNodeVersion } from './graphNodeEdits.js';
import type { BulkEditOperationHandler } from './graphBulkEditDomainTypes.js';

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

export const graphBulkEditOperationSchemas = [
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
] as const;

export const graphBulkEditHandlers: Record<string, BulkEditOperationHandler> = {
  graph_set_name: (current, operation) => ({
    graph: {
      ...current,
      name: operation.name,
    },
  }),
  graph_projection_add: (current, operation) => {
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
  },
  graph_projection_select: (current, operation) => {
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
  },
  graph_python_env_add: (current, operation) => {
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
  },
  graph_python_env_edit: (current, operation) => {
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
  },
  graph_python_env_delete: (current, operation) => {
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
  },
};

