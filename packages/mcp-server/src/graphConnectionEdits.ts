import { randomUUID } from 'node:crypto';
import {
  type Connection,
  type Graph,
  type GraphNode,
} from './graphModel.js';

export function getNode(graph: Graph, nodeId: string): GraphNode {
  const node = graph.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) {
    throw new Error(`Node ${nodeId} not found in graph ${graph.id}`);
  }
  return node;
}

export interface ConnectionListFilters {
  nodeId?: string;
  targetPort?: string;
}

export function filterConnections(
  connections: Connection[],
  filters: ConnectionListFilters = {}
): Connection[] {
  const nodeId = filters.nodeId?.trim();
  const targetPort = filters.targetPort?.trim();

  return connections.filter((connection) => {
    if (nodeId && connection.sourceNodeId !== nodeId && connection.targetNodeId !== nodeId) {
      return false;
    }
    if (targetPort && connection.targetPort !== targetPort) {
      return false;
    }
    return true;
  });
}

interface ConnectionSetInput {
  sourceNodeId: string;
  sourcePort: string;
  targetNodeId: string;
  targetPort: string;
  connectionId?: string;
}

interface ConnectionSetResult {
  changed: boolean;
  connection: Connection;
  connections: Connection[];
  replacedConnectionIds: string[];
}

export function assertConnectionPortsExist(
  graph: Graph,
  sourceNodeId: string,
  sourcePort: string,
  targetNodeId: string,
  targetPort: string
): void {
  const sourceNode = getNode(graph, sourceNodeId);
  const targetNode = getNode(graph, targetNodeId);
  if (!sourceNode.metadata.outputs.some((output) => output.name === sourcePort)) {
    throw new Error(`Source port ${sourcePort} not found on node ${sourceNodeId}`);
  }
  if (!targetNode.metadata.inputs.some((input) => input.name === targetPort)) {
    throw new Error(`Target port ${targetPort} not found on node ${targetNodeId}`);
  }
}

export function applyConnectionSet(current: Graph, input: ConnectionSetInput): ConnectionSetResult {
  assertConnectionPortsExist(
    current,
    input.sourceNodeId,
    input.sourcePort,
    input.targetNodeId,
    input.targetPort
  );

  const inbound = current.connections.filter(
    (connection) =>
      connection.targetNodeId === input.targetNodeId &&
      connection.targetPort === input.targetPort
  );

  const matchingInbound = inbound.find(
    (connection) =>
      connection.sourceNodeId === input.sourceNodeId &&
      connection.sourcePort === input.sourcePort
  );

  const explicitConnectionId = input.connectionId?.trim() || undefined;
  if (explicitConnectionId) {
    const conflicting = current.connections.find(
      (connection) =>
        connection.id === explicitConnectionId &&
        !inbound.some((candidate) => candidate.id === explicitConnectionId)
    );
    if (conflicting) {
      throw new Error(`Connection id ${explicitConnectionId} already exists in graph ${current.id}`);
    }
  }

  const nextConnectionId = explicitConnectionId ?? matchingInbound?.id ?? randomUUID();
  const existingSingleInbound = inbound.length === 1 ? inbound[0] : undefined;
  const unchanged =
    Boolean(existingSingleInbound) &&
    existingSingleInbound?.sourceNodeId === input.sourceNodeId &&
    existingSingleInbound?.sourcePort === input.sourcePort &&
    existingSingleInbound?.id === nextConnectionId;

  if (unchanged && existingSingleInbound) {
    return {
      changed: false,
      connection: existingSingleInbound,
      connections: current.connections,
      replacedConnectionIds: [],
    };
  }

  const nextConnection: Connection = {
    id: nextConnectionId,
    sourceNodeId: input.sourceNodeId,
    sourcePort: input.sourcePort,
    targetNodeId: input.targetNodeId,
    targetPort: input.targetPort,
  };

  return {
    changed: true,
    connection: nextConnection,
    connections: [
      ...current.connections.filter(
        (connection) =>
          !(connection.targetNodeId === input.targetNodeId && connection.targetPort === input.targetPort)
      ),
      nextConnection,
    ],
    replacedConnectionIds: inbound
      .filter((connection) => connection.id !== nextConnectionId)
      .map((connection) => connection.id),
  };
}
