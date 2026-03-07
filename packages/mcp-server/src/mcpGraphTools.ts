import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  applyBulkEditOperation,
  BULK_EDIT_OPERATION_SCHEMA,
  getNextProjectionName,
  type BulkEditOperation,
} from './graphEdits.js';
import { ensureNodeVersion } from './graphNodeEdits.js';
import { requestJson, textResult } from './mcpHttp.js';
import {
  applyProjectionToNodes,
  cloneProjectionNodeCardSizes,
  cloneProjectionNodePositions,
  type Graph,
  type GraphProjection,
  normalizeCanvasBackground,
  normalizeGraph,
  normalizeGraphProjectionState,
  type PythonEnvironment,
} from './graphModel.js';
import type {
  UpdateGraphFn,
} from './mcpGraphClient.js';

const GRAPH_QUERY_NODE_FIELD_VALUES = [
  'id',
  'name',
  'type',
  'version',
  'inputNames',
  'outputNames',
] as const;
const GRAPH_QUERY_CONNECTION_FIELD_VALUES = [
  'id',
  'sourceNodeId',
  'sourcePort',
  'targetNodeId',
  'targetPort',
] as const;
const GRAPH_QUERY_OPERATION_VALUES = [
  'overview',
  'starting_vertices',
  'traverse_bfs',
  'traverse_dfs',
] as const;

const GRAPH_QUERY_NODE_FIELD_SCHEMA = z.enum(GRAPH_QUERY_NODE_FIELD_VALUES);
const GRAPH_QUERY_CONNECTION_FIELD_SCHEMA = z.enum(GRAPH_QUERY_CONNECTION_FIELD_VALUES);

export const GRAPH_QUERY_OPERATION_SCHEMA = z.discriminatedUnion('operation', [
  z.object({
    operation: z.literal('overview'),
    nodeFields: z.array(GRAPH_QUERY_NODE_FIELD_SCHEMA).optional(),
    connectionFields: z.array(GRAPH_QUERY_CONNECTION_FIELD_SCHEMA).optional(),
  }),
  z.object({
    operation: z.literal('starting_vertices'),
    nodeFields: z.array(GRAPH_QUERY_NODE_FIELD_SCHEMA).optional(),
    connectionFields: z.array(GRAPH_QUERY_CONNECTION_FIELD_SCHEMA).optional(),
  }),
  z.object({
    operation: z.literal('traverse_bfs'),
    startNodeIds: z.array(z.string().trim().min(1)).min(1),
    depth: z.number().int().nonnegative().optional(),
    nodeFields: z.array(GRAPH_QUERY_NODE_FIELD_SCHEMA).optional(),
    connectionFields: z.array(GRAPH_QUERY_CONNECTION_FIELD_SCHEMA).optional(),
  }),
  z.object({
    operation: z.literal('traverse_dfs'),
    startNodeIds: z.array(z.string().trim().min(1)).min(1),
    maxNodes: z.number().int().positive(),
    nodeFields: z.array(GRAPH_QUERY_NODE_FIELD_SCHEMA).optional(),
    connectionFields: z.array(GRAPH_QUERY_CONNECTION_FIELD_SCHEMA).optional(),
  }),
]);

type GraphQueryOperation = z.infer<typeof GRAPH_QUERY_OPERATION_SCHEMA>;

type GetGraphFn = (backendUrl: string, graphId: string) => Promise<Graph>;

interface GraphToolRegistrarDeps {
  resolveBackendUrl: (backendUrl?: string) => string;
  getGraph: GetGraphFn;
  updateGraph: UpdateGraphFn;
}

export function registerGraphTools(server: any, deps: GraphToolRegistrarDeps): void {
  const { resolveBackendUrl, getGraph, updateGraph } = deps;

  server.registerTool(
    'graph_list',
    {
      description: 'List available graphs.',
      inputSchema: {
        backendUrl: z.string().optional(),
      },
    },
    async ({ backendUrl }) => {
      const resolvedBackendUrl = resolveBackendUrl(backendUrl);
      const response = await requestJson<{ graphs: Array<{ id: string; name: string; updated_at: number }> }>(
        resolvedBackendUrl,
        '/api/graphs'
      );
      return textResult(response);
    }
  );

  server.registerTool(
    'graph_get',
    {
      description: 'Get a graph by id, or the latest graph when graphId is omitted.',
      inputSchema: {
        graphId: z.string().optional(),
        backendUrl: z.string().optional(),
      },
    },
    async ({ graphId, backendUrl }) => {
      const resolvedBackendUrl = resolveBackendUrl(backendUrl);
      const graph = graphId
        ? await getGraph(resolvedBackendUrl, graphId)
        : normalizeGraph(await requestJson<Graph>(resolvedBackendUrl, '/api/graphs/latest'));

      return textResult(graph);
    }
  );

  server.registerTool(
    'graph_query',
    {
      description:
        'Run lightweight graph queries (overview, BFS/DFS traversal, starting vertices) and return only requested fields.',
      inputSchema: {
        graphId: z.string(),
        operation: z.enum(GRAPH_QUERY_OPERATION_VALUES),
        startNodeIds: z.array(z.string()).optional(),
        depth: z.number().int().nonnegative().optional(),
        maxNodes: z.number().int().positive().optional(),
        nodeFields: z.array(GRAPH_QUERY_NODE_FIELD_SCHEMA).optional(),
        connectionFields: z.array(GRAPH_QUERY_CONNECTION_FIELD_SCHEMA).optional(),
        backendUrl: z.string().optional(),
      },
    },
    async ({
      graphId,
      operation,
      startNodeIds,
      depth,
      maxNodes,
      nodeFields,
      connectionFields,
      backendUrl,
    }) => {
      const resolvedBackendUrl = resolveBackendUrl(backendUrl);
      const parsedQuery: GraphQueryOperation = GRAPH_QUERY_OPERATION_SCHEMA.parse({
        operation,
        startNodeIds,
        depth,
        maxNodes,
        nodeFields,
        connectionFields,
      });

      const result = await requestJson<unknown>(
        resolvedBackendUrl,
        `/api/graphs/${encodeURIComponent(graphId)}/query`,
        {
          method: 'POST',
          body: JSON.stringify(parsedQuery),
        }
      );

      return textResult(result);
    }
  );

  server.registerTool(
    'graph_create',
    {
      description: 'Create a new empty graph.',
      inputSchema: {
        name: z.string().optional(),
        backendUrl: z.string().optional(),
      },
    },
    async ({ name, backendUrl }) => {
      const resolvedBackendUrl = resolveBackendUrl(backendUrl);
      const graph = normalizeGraph(await requestJson<Graph>(resolvedBackendUrl, '/api/graphs', {
        method: 'POST',
        body: JSON.stringify({ name: name ?? 'Untitled Graph' }),
      }));

      return textResult(graph);
    }
  );

  server.registerTool(
    'graph_set_name',
    {
      description: 'Update the graph display name.',
      inputSchema: {
        graphId: z.string(),
        name: z.string(),
        backendUrl: z.string().optional(),
      },
    },
    async ({ graphId, name, backendUrl }) => {
      const resolvedBackendUrl = resolveBackendUrl(backendUrl);
      const graph = await updateGraph(resolvedBackendUrl, graphId, (current) => ({
        ...current,
        name,
      }));

      return textResult(graph);
    }
  );

  server.registerTool(
    'bulk_edit',
    {
      description:
        'Apply multiple graph-edit operations sequentially in a single persisted graph update.',
      inputSchema: {
        graphId: z.string(),
        operations: z.array(BULK_EDIT_OPERATION_SCHEMA).min(1),
        backendUrl: z.string().optional(),
      },
    },
    async ({ graphId, operations, backendUrl }) => {
      const resolvedBackendUrl = resolveBackendUrl(backendUrl);
      const operationResults: Array<{
        index: number;
        op: BulkEditOperation['op'];
        details?: Record<string, unknown>;
      }> = [];

      const graph = await updateGraph(resolvedBackendUrl, graphId, (current) => {
        let nextGraph = current;
        for (let index = 0; index < operations.length; index += 1) {
          const operation = operations[index];
          try {
            const result = applyBulkEditOperation(nextGraph, operation);
            nextGraph = normalizeGraph(result.graph);
            operationResults.push({
              index,
              op: operation.op,
              ...(result.details ? { details: result.details } : {}),
            });
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`bulk_edit operation ${index + 1} (${operation.op}) failed: ${message}`);
          }
        }
        return nextGraph;
      });

      return textResult({
        graphId,
        operationsApplied: operationResults.length,
        operationResults,
        graph,
      });
    }
  );

  server.registerTool(
    'graph_projection_add',
    {
      description:
        'Add a new graph projection. Node coordinates, node card sizes, and projection background are cloned from the currently selected projection unless sourceProjectionId is provided.',
      inputSchema: {
        graphId: z.string(),
        projectionId: z.string().trim().min(1).optional(),
        name: z.string().trim().min(1).optional(),
        sourceProjectionId: z.string().trim().min(1).optional(),
        activate: z.boolean().optional(),
        backendUrl: z.string().optional(),
      },
    },
    async ({ graphId, projectionId, name, sourceProjectionId, activate, backendUrl }) => {
      const resolvedBackendUrl = resolveBackendUrl(backendUrl);
      const graph = await updateGraph(resolvedBackendUrl, graphId, (current) => {
        const projectionState = normalizeGraphProjectionState(
          current.nodes,
          current.projections,
          current.activeProjectionId,
          current.canvasBackground
        );

        const sourceId = sourceProjectionId?.trim() || projectionState.activeProjectionId;
        const sourceProjection = projectionState.projections.find((projection) => projection.id === sourceId);
        if (!sourceProjection) {
          throw new Error(`Projection "${sourceId}" was not found in graph ${graphId}`);
        }

        const nextProjectionId = projectionId?.trim() || randomUUID();
        if (projectionState.projections.some((projection) => projection.id === nextProjectionId)) {
          throw new Error(`Projection "${nextProjectionId}" already exists in graph ${graphId}`);
        }

        const newProjection: GraphProjection = {
          id: nextProjectionId,
          name: name?.trim() || getNextProjectionName(projectionState.projections),
          nodePositions: cloneProjectionNodePositions(current.nodes, sourceProjection),
          nodeCardSizes: cloneProjectionNodeCardSizes(current.nodes, sourceProjection),
          canvasBackground: normalizeCanvasBackground(
            sourceProjection.canvasBackground ?? current.canvasBackground
          ),
        };

        const nextActiveProjectionId = activate === false
          ? projectionState.activeProjectionId
          : newProjection.id;
        const activeProjection = nextActiveProjectionId === newProjection.id
          ? newProjection
          : projectionState.projections.find(
              (projection) => projection.id === nextActiveProjectionId
            ) ?? newProjection;

        return {
          ...current,
          projections: [...projectionState.projections, newProjection],
          activeProjectionId: nextActiveProjectionId,
          nodes: applyProjectionToNodes(current.nodes, activeProjection),
          canvasBackground: normalizeCanvasBackground(
            activeProjection.canvasBackground ?? current.canvasBackground
          ),
        };
      });

      return textResult(graph);
    }
  );

  server.registerTool(
    'graph_projection_select',
    {
      description: 'Set the active graph projection and apply its stored node coordinates, card sizes, and background to the graph.',
      inputSchema: {
        graphId: z.string(),
        projectionId: z.string().trim().min(1),
        backendUrl: z.string().optional(),
      },
    },
    async ({ graphId, projectionId, backendUrl }) => {
      const resolvedBackendUrl = resolveBackendUrl(backendUrl);
      const graph = await updateGraph(resolvedBackendUrl, graphId, (current) => {
        const projectionState = normalizeGraphProjectionState(
          current.nodes,
          current.projections,
          current.activeProjectionId,
          current.canvasBackground
        );
        const selectedProjection = projectionState.projections.find(
          (projection) => projection.id === projectionId
        );
        if (!selectedProjection) {
          throw new Error(`Projection "${projectionId}" was not found in graph ${graphId}`);
        }

        return {
          ...current,
          projections: projectionState.projections,
          activeProjectionId: selectedProjection.id,
          nodes: applyProjectionToNodes(current.nodes, selectedProjection),
          canvasBackground: normalizeCanvasBackground(
            selectedProjection.canvasBackground ?? current.canvasBackground
          ),
        };
      });

      return textResult(graph);
    }
  );

  server.registerTool(
    'graph_python_env_add',
    {
      description: 'Add a named Python environment definition to a graph.',
      inputSchema: {
        graphId: z.string(),
        name: z.string().trim().min(1),
        pythonPath: z.string().trim().min(1),
        cwd: z.string().trim().min(1),
        backendUrl: z.string().optional(),
      },
    },
    async ({ graphId, name, pythonPath, cwd, backendUrl }) => {
      const resolvedBackendUrl = resolveBackendUrl(backendUrl);
      const graph = await updateGraph(resolvedBackendUrl, graphId, (current) => {
        const existingEnvs = current.pythonEnvs ?? [];
        if (existingEnvs.some((env) => env.name === name)) {
          throw new Error(`Python environment "${name}" already exists in graph ${graphId}`);
        }

        return {
          ...current,
          pythonEnvs: [
            ...existingEnvs,
            {
              name,
              pythonPath,
              cwd,
            },
          ],
        };
      });

      return textResult(graph);
    }
  );

  server.registerTool(
    'graph_python_env_edit',
    {
      description:
        'Edit an existing graph Python environment by name (rename and/or update pythonPath/cwd).',
      inputSchema: {
        graphId: z.string(),
        envName: z.string().trim().min(1),
        name: z.string().trim().min(1).optional(),
        pythonPath: z.string().trim().min(1).optional(),
        cwd: z.string().trim().min(1).optional(),
        backendUrl: z.string().optional(),
      },
    },
    async ({ graphId, envName, name, pythonPath, cwd, backendUrl }) => {
      const resolvedBackendUrl = resolveBackendUrl(backendUrl);
      const graph = await updateGraph(resolvedBackendUrl, graphId, (current) => {
        const existingEnvs = current.pythonEnvs ?? [];
        const envIndex = existingEnvs.findIndex((env) => env.name === envName);
        if (envIndex === -1) {
          throw new Error(`Python environment "${envName}" was not found in graph ${graphId}`);
        }

        const existingEnv = existingEnvs[envIndex];
        const nextEnvName = name ?? existingEnv.name;
        const nextEnv: PythonEnvironment = {
          name: nextEnvName,
          pythonPath: pythonPath ?? existingEnv.pythonPath,
          cwd: cwd ?? existingEnv.cwd,
        };

        const duplicateName = existingEnvs.some(
          (env, index) => index !== envIndex && env.name === nextEnv.name
        );
        if (duplicateName) {
          throw new Error(`Python environment "${nextEnv.name}" already exists in graph ${graphId}`);
        }

        const nextNodes =
          nextEnvName === envName
            ? current.nodes
            : current.nodes.map((node) =>
                node.config.pythonEnv === envName
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
          ...current,
          pythonEnvs: existingEnvs.map((env, index) => (index === envIndex ? nextEnv : env)),
          nodes: nextNodes,
        };
      });

      return textResult(graph);
    }
  );

  server.registerTool(
    'graph_python_env_delete',
    {
      description:
        'Delete a graph Python environment by name and clear pythonEnv bindings from nodes that referenced it.',
      inputSchema: {
        graphId: z.string(),
        envName: z.string().trim().min(1),
        backendUrl: z.string().optional(),
      },
    },
    async ({ graphId, envName, backendUrl }) => {
      const resolvedBackendUrl = resolveBackendUrl(backendUrl);
      const graph = await updateGraph(resolvedBackendUrl, graphId, (current) => {
        const existingEnvs = current.pythonEnvs ?? [];
        const hasEnv = existingEnvs.some((env) => env.name === envName);
        if (!hasEnv) {
          throw new Error(`Python environment "${envName}" was not found in graph ${graphId}`);
        }

        return {
          ...current,
          pythonEnvs: existingEnvs.filter((env) => env.name !== envName),
          nodes: current.nodes.map((node) =>
            node.config.pythonEnv === envName
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
      });

      return textResult(graph);
    }
  );
}
