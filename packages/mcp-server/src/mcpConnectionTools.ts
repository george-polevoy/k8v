import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  applyConnectionSet,
  assertConnectionPortsExist,
  filterConnections,
} from './graphConnectionEdits.js';
import { textResult } from './mcpHttp.js';
import { type Connection, type Graph } from './graphModel.js';

type GetGraphFn = (backendUrl: string, graphId: string) => Promise<Graph>;

type UpdateGraphConnectionsFn = (
  backendUrl: string,
  graphId: string,
  mutateConnections: (connections: Graph) => Connection[],
  options?: { noRecompute?: boolean }
) => Promise<Graph>;

type UpdateGraphConnectionsWithResultFn = <TResult>(
  backendUrl: string,
  graphId: string,
  mutateConnections: (connections: Graph) => {
    connections: Connection[];
    result: TResult;
  },
  options?: { noRecompute?: boolean }
) => Promise<{ graph: Graph; result: TResult }>;

interface ConnectionToolRegistrarDeps {
  resolveBackendUrl: (backendUrl?: string) => string;
  getGraph: GetGraphFn;
  updateGraphConnections: UpdateGraphConnectionsFn;
  updateGraphConnectionsWithResult: UpdateGraphConnectionsWithResultFn;
}

export function registerConnectionTools(server: any, deps: ConnectionToolRegistrarDeps): void {
  const {
    resolveBackendUrl,
    getGraph,
    updateGraphConnections,
    updateGraphConnectionsWithResult,
  } = deps;

  server.registerTool(
    'connections_list',
    {
      description: 'List graph connections with optional node/target-port filtering.',
      inputSchema: {
        graphId: z.string(),
        nodeId: z.string().optional(),
        targetPort: z.string().optional(),
        backendUrl: z.string().optional(),
      },
    },
    async ({ graphId, nodeId, targetPort, backendUrl }) => {
      const resolvedBackendUrl = resolveBackendUrl(backendUrl);
      const graph = await getGraph(resolvedBackendUrl, graphId);
      const connections = filterConnections(graph.connections, { nodeId, targetPort });

      return textResult({
        graphId: graph.id,
        filters: {
          ...(nodeId?.trim() ? { nodeId: nodeId.trim() } : {}),
          ...(targetPort?.trim() ? { targetPort: targetPort.trim() } : {}),
        },
        count: connections.length,
        connections,
      });
    }
  );

  server.registerTool(
    'connection_add',
    {
      description: 'Create a connection between two ports.',
      inputSchema: {
        graphId: z.string(),
        sourceNodeId: z.string(),
        sourcePort: z.string(),
        targetNodeId: z.string(),
        targetPort: z.string(),
        connectionId: z.string().optional(),
        noRecompute: z.boolean().optional(),
        backendUrl: z.string().optional(),
      },
    },
    async ({
      graphId,
      sourceNodeId,
      sourcePort,
      targetNodeId,
      targetPort,
      connectionId,
      noRecompute,
      backendUrl,
    }) => {
      const resolvedBackendUrl = resolveBackendUrl(backendUrl);

      const graph = await updateGraphConnections(
        resolvedBackendUrl,
        graphId,
        (current) => {
          assertConnectionPortsExist(current, sourceNodeId, sourcePort, targetNodeId, targetPort);

          const duplicate = current.connections.some(
            (connection) =>
              connection.sourceNodeId === sourceNodeId &&
              connection.sourcePort === sourcePort &&
              connection.targetNodeId === targetNodeId &&
              connection.targetPort === targetPort
          );
          if (duplicate) {
            return current.connections;
          }

          return [
            ...current.connections,
            {
              id: connectionId ?? randomUUID(),
              sourceNodeId,
              sourcePort,
              targetNodeId,
              targetPort,
            },
          ];
        },
        {
          noRecompute,
        }
      );

      return textResult(graph);
    }
  );

  server.registerTool(
    'connection_set',
    {
      description:
        'Atomically set the source for a target input port, replacing any existing inbound connection(s).',
      inputSchema: {
        graphId: z.string(),
        sourceNodeId: z.string(),
        sourcePort: z.string(),
        targetNodeId: z.string(),
        targetPort: z.string(),
        connectionId: z.string().optional(),
        noRecompute: z.boolean().optional(),
        backendUrl: z.string().optional(),
      },
    },
    async ({
      graphId,
      sourceNodeId,
      sourcePort,
      targetNodeId,
      targetPort,
      connectionId,
      noRecompute,
      backendUrl,
    }) => {
      const resolvedBackendUrl = resolveBackendUrl(backendUrl);
      const { graph, result: operationResult } = await updateGraphConnectionsWithResult(
        resolvedBackendUrl,
        graphId,
        (current) => {
          const result = applyConnectionSet(current, {
            sourceNodeId,
            sourcePort,
            targetNodeId,
            targetPort,
            connectionId,
          });
          return {
            connections: result.connections,
            result,
          };
        },
        {
          noRecompute,
        }
      );

      return textResult({
        graphId,
        connection: operationResult.connection,
        replacedConnectionIds: operationResult.replacedConnectionIds,
        changed: operationResult.changed,
        graph,
      });
    }
  );

  server.registerTool(
    'connection_replace',
    {
      description:
        'Alias of connection_set: atomically set the source for a target input port and replace existing inbound edge(s).',
      inputSchema: {
        graphId: z.string(),
        sourceNodeId: z.string(),
        sourcePort: z.string(),
        targetNodeId: z.string(),
        targetPort: z.string(),
        connectionId: z.string().optional(),
        noRecompute: z.boolean().optional(),
        backendUrl: z.string().optional(),
      },
    },
    async ({
      graphId,
      sourceNodeId,
      sourcePort,
      targetNodeId,
      targetPort,
      connectionId,
      noRecompute,
      backendUrl,
    }) => {
      const resolvedBackendUrl = resolveBackendUrl(backendUrl);
      const { graph, result: operationResult } = await updateGraphConnectionsWithResult(
        resolvedBackendUrl,
        graphId,
        (current) => {
          const result = applyConnectionSet(current, {
            sourceNodeId,
            sourcePort,
            targetNodeId,
            targetPort,
            connectionId,
          });
          return {
            connections: result.connections,
            result,
          };
        },
        {
          noRecompute,
        }
      );

      return textResult({
        graphId,
        connection: operationResult.connection,
        replacedConnectionIds: operationResult.replacedConnectionIds,
        changed: operationResult.changed,
        graph,
      });
    }
  );

  server.registerTool(
    'connection_delete',
    {
      description: 'Delete a connection by id.',
      inputSchema: {
        graphId: z.string(),
        connectionId: z.string(),
        noRecompute: z.boolean().optional(),
        backendUrl: z.string().optional(),
      },
    },
    async ({ graphId, connectionId, noRecompute, backendUrl }) => {
      const resolvedBackendUrl = resolveBackendUrl(backendUrl);
      const graph = await updateGraphConnections(
        resolvedBackendUrl,
        graphId,
        (current) => current.connections.filter((connection) => connection.id !== connectionId),
        {
          noRecompute,
        }
      );

      return textResult(graph);
    }
  );
}
