import { randomUUID } from 'node:crypto';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { renderGraphRegionScreenshotFromFrontend } from './frontendScreenshot.js';
import {
  applyConnectionSet,
  assertConnectionPortsExist,
  filterConnections,
} from './graphConnectionEdits.js';
import {
  applyBulkEditOperation,
  BULK_EDIT_OPERATION_SCHEMA,
  getNextProjectionName,
  type BulkEditOperation,
} from './graphEdits.js';
import {
  ensureNodeVersion,
} from './graphNodeEdits.js';
import { registerNodeTools } from './mcpNodeTools.js';
import { registerConnectionTools } from './mcpConnectionTools.js';
import {
  requestBinary,
  requestJson,
  resolveBackendUrl,
  resolveFrontendUrl,
  textResult,
} from './mcpHttp.js';
import {
  applyProjectionToNodes,
  cloneProjectionNodeCardSizes,
  cloneProjectionNodePositions,
  type Connection,
  DEFAULT_GRAPH_PROJECTION_ID,
  type Graph,
  type GraphProjection,
  normalizeCanvasBackground,
  normalizeDrawingColor,
  normalizeGraph,
  normalizeGraphProjectionState,
  type PythonEnvironment,
} from './graphModel.js';

export { renderGraphRegionScreenshotFromFrontend } from './frontendScreenshot.js';
export {
  applyBulkEditOperation,
  BULK_EDIT_OPERATION_SCHEMA,
} from './graphEdits.js';
export {
  filterConnections,
} from './graphConnectionEdits.js';

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

async function getGraph(backendUrl: string, graphId: string): Promise<Graph> {
  const graph = await requestJson<Graph>(backendUrl, `/api/graphs/${encodeURIComponent(graphId)}`);
  return normalizeGraph(graph);
}

interface UpdateGraphRequestOptions {
  noRecompute?: boolean;
}

function buildGraphUpdateEndpoint(graphId: string, options?: UpdateGraphRequestOptions): string {
  const params = new URLSearchParams();
  if (options?.noRecompute) {
    params.set('noRecompute', 'true');
  }
  const query = params.toString();
  return `/api/graphs/${encodeURIComponent(graphId)}${query ? `?${query}` : ''}`;
}

async function updateGraph(
  backendUrl: string,
  graphId: string,
  mutate: (graph: Graph) => Graph
): Promise<Graph> {
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const currentGraph = await getGraph(backendUrl, graphId);
    const nextGraph = normalizeGraph(mutate(structuredClone(currentGraph)));
    const body = {
      ...nextGraph,
      id: graphId,
      updatedAt: Date.now(),
      ifMatchUpdatedAt: currentGraph.updatedAt,
    };

    try {
      const persisted = await requestJson<Graph>(backendUrl, buildGraphUpdateEndpoint(graphId), {
        method: 'PUT',
        body: JSON.stringify(body),
      });
      return normalizeGraph(persisted);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempt < maxAttempts && /reload and retry/i.test(message)) {
        continue;
      }
      throw error;
    }
  }

  throw new Error(`Failed to update graph ${graphId} after ${maxAttempts} attempts`);
}

async function updateGraphConnectionsWithResult<TResult>(
  backendUrl: string,
  graphId: string,
  mutateConnections: (graph: Graph) => { connections: Connection[]; result: TResult },
  options?: UpdateGraphRequestOptions
): Promise<{ graph: Graph; result: TResult }> {
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const currentGraph = await getGraph(backendUrl, graphId);
    const mutation = mutateConnections(structuredClone(currentGraph));

    const body = {
      connections: mutation.connections,
      ifMatchUpdatedAt: currentGraph.updatedAt,
    };

    try {
      const persisted = await requestJson<Graph>(
        backendUrl,
        buildGraphUpdateEndpoint(graphId, options),
        {
          method: 'PUT',
          body: JSON.stringify(body),
        }
      );
      return {
        graph: normalizeGraph(persisted),
        result: mutation.result,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempt < maxAttempts && /reload and retry/i.test(message)) {
        continue;
      }
      throw error;
    }
  }

  throw new Error(`Failed to update graph ${graphId} after ${maxAttempts} attempts`);
}

async function updateGraphConnections(
  backendUrl: string,
  graphId: string,
  mutateConnections: (graph: Graph) => Connection[],
  options?: UpdateGraphRequestOptions
): Promise<Graph> {
  const result = await updateGraphConnectionsWithResult(
    backendUrl,
    graphId,
    (graph) => ({
      connections: mutateConnections(graph),
      result: undefined,
    }),
    options
  );
  return result.graph;
}

const server: any = new McpServer({
  name: 'k8v-mcp-server',
  version: '0.1.0',
});

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

server.registerTool(
  'drawing_create',
  {
    description: 'Create a persistent drawing object with a draggable handle/title.',
    inputSchema: {
      graphId: z.string(),
      name: z.string().optional(),
      x: z.number().optional(),
      y: z.number().optional(),
      backendUrl: z.string().optional(),
    },
  },
  async ({ graphId, name, x, y, backendUrl }) => {
    const resolvedBackendUrl = resolveBackendUrl(backendUrl);
    const drawingId = randomUUID();

    const graph = await updateGraph(resolvedBackendUrl, graphId, (current) => ({
      ...current,
      drawings: [
        ...(current.drawings ?? []),
        {
          id: drawingId,
          name: name ?? `Drawing ${((current.drawings ?? []).length + 1)}`,
          position: {
            x: x ?? 0,
            y: y ?? 0,
          },
          paths: [],
        },
      ],
    }));

    return textResult({ graphId, drawingId, graph });
  }
);

server.registerTool(
  'drawing_add_path',
  {
    description: 'Append a path to an existing drawing object.',
    inputSchema: {
      graphId: z.string(),
      drawingId: z.string(),
      points: z.array(z.object({ x: z.number(), y: z.number() })).min(1),
      color: z.union([z.string().regex(/^#[0-9a-fA-F]{6}$/), z.enum(['white', 'green', 'red'])]).optional(),
      thickness: z.number().positive().optional(),
      pathId: z.string().optional(),
      coordinateSpace: z.enum(['world', 'local']).optional(),
      backendUrl: z.string().optional(),
    },
  },
  async ({
    graphId,
    drawingId,
    points,
    color,
    thickness,
    pathId,
    coordinateSpace,
    backendUrl,
  }) => {
    const resolvedBackendUrl = resolveBackendUrl(backendUrl);

    const graph = await updateGraph(resolvedBackendUrl, graphId, (current) => {
      const drawing = (current.drawings ?? []).find((candidate) => candidate.id === drawingId);
      if (!drawing) {
        throw new Error(`Drawing ${drawingId} not found in graph ${graphId}`);
      }

      const localPoints = (coordinateSpace ?? 'world') === 'local'
        ? points
        : points.map((point) => ({
            x: point.x - drawing.position.x,
            y: point.y - drawing.position.y,
          }));

      return {
        ...current,
        drawings: (current.drawings ?? []).map((candidate) =>
          candidate.id === drawingId
            ? {
                ...candidate,
                paths: [
                  ...candidate.paths,
                  {
                    id: pathId ?? randomUUID(),
                    color: normalizeDrawingColor(color, '#ffffff'),
                    thickness: thickness ?? 3,
                    points: localPoints,
                  },
                ],
              }
            : candidate
        ),
      };
    });

    return textResult(graph);
  }
);

server.registerTool(
  'drawing_move',
  {
    description: 'Move a drawing handle (and all of its paths) to a new world position.',
    inputSchema: {
      graphId: z.string(),
      drawingId: z.string(),
      x: z.number(),
      y: z.number(),
      backendUrl: z.string().optional(),
    },
  },
  async ({ graphId, drawingId, x, y, backendUrl }) => {
    const resolvedBackendUrl = resolveBackendUrl(backendUrl);

    const graph = await updateGraph(resolvedBackendUrl, graphId, (current) => ({
      ...current,
      drawings: (current.drawings ?? []).map((drawing) =>
        drawing.id === drawingId
          ? {
              ...drawing,
              position: { x, y },
            }
          : drawing
      ),
    }));

    return textResult(graph);
  }
);

server.registerTool(
  'drawing_set_name',
  {
    description: 'Rename a drawing object.',
    inputSchema: {
      graphId: z.string(),
      drawingId: z.string(),
      name: z.string(),
      backendUrl: z.string().optional(),
    },
  },
  async ({ graphId, drawingId, name, backendUrl }) => {
    const resolvedBackendUrl = resolveBackendUrl(backendUrl);

    const graph = await updateGraph(resolvedBackendUrl, graphId, (current) => ({
      ...current,
      drawings: (current.drawings ?? []).map((drawing) =>
        drawing.id === drawingId
          ? {
              ...drawing,
              name,
            }
          : drawing
      ),
    }));

    return textResult(graph);
  }
);

server.registerTool(
  'drawing_delete',
  {
    description: 'Delete a drawing object and all stored paths.',
    inputSchema: {
      graphId: z.string(),
      drawingId: z.string(),
      backendUrl: z.string().optional(),
    },
  },
  async ({ graphId, drawingId, backendUrl }) => {
    const resolvedBackendUrl = resolveBackendUrl(backendUrl);
    const graph = await updateGraph(resolvedBackendUrl, graphId, (current) => ({
      ...current,
      drawings: (current.drawings ?? []).filter((drawing) => drawing.id !== drawingId),
    }));

    return textResult(graph);
  }
);

registerNodeTools(server, {
  resolveBackendUrl,
  updateGraph,
});

registerConnectionTools(server, {
  resolveBackendUrl,
  getGraph,
  updateGraphConnections,
  updateGraphConnectionsWithResult,
});

server.registerTool(
  'graph_compute',
  {
    description: 'Compute full graph or a selected node.',
    inputSchema: {
      graphId: z.string(),
      nodeId: z.string().optional(),
      backendUrl: z.string().optional(),
    },
  },
  async ({ graphId, nodeId, backendUrl }) => {
    const resolvedBackendUrl = resolveBackendUrl(backendUrl);
    const result = await requestJson<unknown>(
      resolvedBackendUrl,
      `/api/graphs/${encodeURIComponent(graphId)}/compute`,
      {
        method: 'POST',
        body: JSON.stringify(nodeId ? { nodeId } : {}),
      }
    );

    return textResult(result);
  }
);

server.registerTool(
  'graphics_get',
  {
    description:
      'Fetch a graphics artifact by id as binary image data, with optional backend mip-level selection by maxPixels.',
    inputSchema: {
      graphicsId: z.string(),
      maxPixels: z.number().int().positive().optional(),
      includeImage: z.boolean().optional(),
      backendUrl: z.string().optional(),
    },
  },
  async ({ graphicsId, maxPixels, includeImage, backendUrl }) => {
    const resolvedBackendUrl = resolveBackendUrl(backendUrl);
    const params = new URLSearchParams();
    if (typeof maxPixels === 'number' && Number.isFinite(maxPixels) && maxPixels > 0) {
      params.set('maxPixels', String(Math.floor(maxPixels)));
    }
    const query = params.toString();

    const { buffer, headers } = await requestBinary(
      resolvedBackendUrl,
      `/api/graphics/${encodeURIComponent(graphicsId)}/image${query ? `?${query}` : ''}`
    );

    const mimeType = headers.get('content-type') || 'application/octet-stream';
    const selectedLevel = {
      level: Number(headers.get('x-k8v-graphics-level') ?? '0'),
      width: Number(headers.get('x-k8v-graphics-width') ?? '0'),
      height: Number(headers.get('x-k8v-graphics-height') ?? '0'),
      pixelCount: Number(headers.get('x-k8v-graphics-pixels') ?? '0'),
    };

    const content: Array<{
      type: 'text' | 'image';
      text?: string;
      mimeType?: string;
      data?: string;
    }> = [
      {
        type: 'text',
        text: JSON.stringify(
          {
            graphicsId,
            mimeType,
            bytes: buffer.byteLength,
            selectedLevel,
          },
          null,
          2
        ),
      },
    ];

    if (includeImage !== false && mimeType.startsWith('image/')) {
      content.push({
        type: 'image',
        mimeType,
        data: buffer.toString('base64'),
      });
    }

    return { content };
  }
);

server.registerTool(
  'graph_screenshot_region',
  {
    description:
      'Render the frontend canvas-only view in Playwright and capture a fixed-size bitmap for a world-coordinate rectangle.',
    inputSchema: {
      graphId: z.string().optional(),
      graph: z.unknown().optional(),
      backendUrl: z.string().optional(),
      frontendUrl: z.string().optional(),
      regionX: z.number(),
      regionY: z.number(),
      regionWidth: z.number().positive(),
      regionHeight: z.number().positive(),
      bitmapWidth: z.number().int().positive(),
      bitmapHeight: z.number().int().positive(),
      outputPath: z.string().optional(),
      includeBase64: z.boolean().optional(),
    },
  },
  async ({
    graphId,
    graph,
    backendUrl,
    frontendUrl,
    regionX,
    regionY,
    regionWidth,
    regionHeight,
    bitmapWidth,
    bitmapHeight,
    outputPath,
    includeBase64,
  }) => {
    const resolvedBackendUrl = resolveBackendUrl(backendUrl);
    const resolvedFrontendUrl = resolveFrontendUrl(frontendUrl);
    const graphData = graph
      ? normalizeGraph(graph as Graph)
      : graphId
        ? await getGraph(resolvedBackendUrl, graphId)
        : normalizeGraph(await requestJson<Graph>(resolvedBackendUrl, '/api/graphs/latest'));

    const result = await renderGraphRegionScreenshotFromFrontend({
      frontendUrl: resolvedFrontendUrl,
      backendUrl: resolvedBackendUrl,
      graphId: graphData.id,
      graphOverride: graph ? graphData : undefined,
      region: {
        x: regionX,
        y: regionY,
        width: regionWidth,
        height: regionHeight,
      },
      bitmap: {
        width: bitmapWidth,
        height: bitmapHeight,
      },
      outputPath,
      includeBase64,
    });

    const content: Array<{
      type: 'text' | 'image';
      text?: string;
      mimeType?: string;
      data?: string;
    }> = [
      {
        type: 'text',
        text: JSON.stringify(
          {
            graphId: graphData.id,
            region: {
              x: regionX,
              y: regionY,
              width: regionWidth,
              height: regionHeight,
            },
            bitmap: {
              width: bitmapWidth,
              height: bitmapHeight,
            },
            frontendUrl: resolvedFrontendUrl,
            outputPath: result.outputPath,
            bytes: result.bytes,
          },
          null,
          2
        ),
      },
    ];

    if (result.base64) {
      content.push({
        type: 'image',
        mimeType: 'image/png',
        data: result.base64,
      });
    }

    return { content };
  }
);

export async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

const directRunCandidate = process.argv[1];
const isDirectRun = directRunCandidate
  ? pathToFileURL(directRunCandidate).href === import.meta.url
  : false;

if (isDirectRun) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exit(1);
  });
}
