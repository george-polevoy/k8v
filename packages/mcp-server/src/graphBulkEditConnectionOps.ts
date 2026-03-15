import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  applyConnectionSet,
  assertConnectionPortsExist,
  matchesConnectionDefinition,
} from './graphConnectionEdits.js';
import { ConnectionAnchorSchema, type BulkEditOperationHandler } from './graphBulkEditDomainTypes.js';

export const connectionBulkEditOperationSchemas = [
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
] as const;

export const connectionBulkEditHandlers: Record<string, BulkEditOperationHandler> = {
  connection_add: (current, operation) => {
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
  },
  connection_set: (current, operation) => applyConnectionReplace(current, operation),
  connection_replace: (current, operation) => applyConnectionReplace(current, operation),
  connection_delete: (current, operation) => ({
    graph: {
      ...current,
      connections: current.connections.filter(
        (connection) => connection.id !== operation.connectionId
      ),
    },
  }),
};

function applyConnectionReplace(current: Parameters<BulkEditOperationHandler>[0], operation: any) {
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

