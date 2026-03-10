import { randomUUID } from 'node:crypto';
import {
  type ConnectionAnchor,
  type Connection,
  type Graph,
  type GraphNode,
} from './graphModel.js';

export const ANNOTATION_CONNECTION_PORT = '__annotation__';

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
  sourceAnchor?: ConnectionAnchor;
  targetNodeId: string;
  targetPort: string;
  targetAnchor?: ConnectionAnchor;
  connectionId?: string;
}

interface ConnectionSetResult {
  changed: boolean;
  connection: Connection;
  connections: Connection[];
  replacedConnectionIds: string[];
}

export function areConnectionAnchorsEqual(
  left: ConnectionAnchor | undefined,
  right: ConnectionAnchor | undefined
): boolean {
  if (left === right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }
  return left.side === right.side && Math.abs(left.offset - right.offset) < 1e-6;
}

function isAnnotationNode(node: GraphNode): boolean {
  return node.type === 'annotation';
}

function isValidSourcePort(node: GraphNode, port: string): boolean {
  return (
    (isAnnotationNode(node) && port === ANNOTATION_CONNECTION_PORT) ||
    node.metadata.outputs.some((output) => output.name === port)
  );
}

function isValidTargetPort(node: GraphNode, port: string): boolean {
  return (
    (isAnnotationNode(node) && port === ANNOTATION_CONNECTION_PORT) ||
    node.metadata.inputs.some((input) => input.name === port)
  );
}

export function matchesConnectionDefinition(
  connection: Connection,
  candidate: {
    sourceNodeId: string;
    sourcePort: string;
    sourceAnchor?: ConnectionAnchor;
    targetNodeId: string;
    targetPort: string;
    targetAnchor?: ConnectionAnchor;
  }
): boolean {
  return (
    connection.sourceNodeId === candidate.sourceNodeId &&
    connection.sourcePort === candidate.sourcePort &&
    areConnectionAnchorsEqual(connection.sourceAnchor, candidate.sourceAnchor) &&
    connection.targetNodeId === candidate.targetNodeId &&
    connection.targetPort === candidate.targetPort &&
    areConnectionAnchorsEqual(connection.targetAnchor, candidate.targetAnchor)
  );
}

function matchesTargetSlot(
  connection: Connection,
  targetNode: GraphNode,
  input: ConnectionSetInput
): boolean {
  if (
    connection.targetNodeId !== input.targetNodeId ||
    connection.targetPort !== input.targetPort
  ) {
    return false;
  }

  if (!isAnnotationNode(targetNode)) {
    return true;
  }

  return areConnectionAnchorsEqual(connection.targetAnchor, input.targetAnchor);
}

export function assertConnectionPortsExist(
  graph: Graph,
  sourceNodeId: string,
  sourcePort: string,
  targetNodeId: string,
  targetPort: string,
  sourceAnchor?: ConnectionAnchor,
  targetAnchor?: ConnectionAnchor
): void {
  const sourceNode = getNode(graph, sourceNodeId);
  const targetNode = getNode(graph, targetNodeId);
  if (!isValidSourcePort(sourceNode, sourcePort)) {
    throw new Error(`Source port ${sourcePort} not found on node ${sourceNodeId}`);
  }
  if (!isValidTargetPort(targetNode, targetPort)) {
    throw new Error(`Target port ${targetPort} not found on node ${targetNodeId}`);
  }
  if (sourceAnchor && !isAnnotationNode(sourceNode)) {
    throw new Error(`Source anchor is only valid for annotation node ${sourceNodeId}`);
  }
  if (targetAnchor && !isAnnotationNode(targetNode)) {
    throw new Error(`Target anchor is only valid for annotation node ${targetNodeId}`);
  }
}

export function applyConnectionSet(current: Graph, input: ConnectionSetInput): ConnectionSetResult {
  const targetNode = getNode(current, input.targetNodeId);
  assertConnectionPortsExist(
    current,
    input.sourceNodeId,
    input.sourcePort,
    input.targetNodeId,
    input.targetPort,
    input.sourceAnchor,
    input.targetAnchor
  );

  const inbound = current.connections.filter(
    (connection) => matchesTargetSlot(connection, targetNode, input)
  );

  const matchingInbound = inbound.find(
    (connection) => matchesConnectionDefinition(connection, input)
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
  const unchanged = existingSingleInbound
    ? matchesConnectionDefinition(existingSingleInbound, input) &&
      existingSingleInbound.id === nextConnectionId
    : false;

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
    ...(input.sourceAnchor ? { sourceAnchor: input.sourceAnchor } : {}),
    targetNodeId: input.targetNodeId,
    targetPort: input.targetPort,
    ...(input.targetAnchor ? { targetAnchor: input.targetAnchor } : {}),
  };

  return {
    changed: true,
    connection: nextConnection,
    connections: [
      ...current.connections.filter(
        (connection) => !matchesTargetSlot(connection, targetNode, input)
      ),
      nextConnection,
    ],
    replacedConnectionIds: inbound
      .filter((connection) => connection.id !== nextConnectionId)
      .map((connection) => connection.id),
  };
}
