import type {
  Connection,
  ConnectionAnchor,
  GraphNode,
} from '../types';
import {
  areConnectionAnchorsEqual,
  buildGraphNodeMap,
  isAnnotationNode,
} from './annotationConnections';

function serializeConnectionAnchor(anchor: ConnectionAnchor | undefined): string {
  if (!anchor) {
    return '-';
  }

  return `${anchor.side}:${anchor.offset}`;
}

function getConnectionTargetSlotKey(
  connection: Connection,
  targetNode: Pick<GraphNode, 'type'> | undefined
): string {
  if (!isAnnotationNode(targetNode)) {
    return `${connection.targetNodeId}:${connection.targetPort}`;
  }

  return (
    `${connection.targetNodeId}:${connection.targetPort}` +
    `@${serializeConnectionAnchor(connection.targetAnchor)}`
  );
}

function matchesConnectionDefinition(connection: Connection, candidate: Connection): boolean {
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
  candidate: Connection,
  targetNode: Pick<GraphNode, 'type'> | undefined
): boolean {
  if (
    connection.targetNodeId !== candidate.targetNodeId ||
    connection.targetPort !== candidate.targetPort
  ) {
    return false;
  }

  if (!isAnnotationNode(targetNode)) {
    return true;
  }

  return areConnectionAnchorsEqual(connection.targetAnchor, candidate.targetAnchor);
}

export function dedupeConnectionsByTargetSlot(nodes: GraphNode[], connections: Connection[]): Connection[] {
  const nodeById = buildGraphNodeMap(nodes);
  const seenSlots = new Set<string>();
  const deduped: Connection[] = [];

  for (let index = connections.length - 1; index >= 0; index -= 1) {
    const connection = connections[index];
    const slotKey = getConnectionTargetSlotKey(
      connection,
      nodeById.get(connection.targetNodeId)
    );
    if (seenSlots.has(slotKey)) {
      continue;
    }

    seenSlots.add(slotKey);
    deduped.push(connection);
  }

  deduped.reverse();
  return deduped;
}

export function applyConnectionSet(
  nodes: GraphNode[],
  connections: Connection[],
  nextConnection: Connection
): { changed: boolean; connections: Connection[] } {
  const nodeById = buildGraphNodeMap(nodes);
  const targetNode = nodeById.get(nextConnection.targetNodeId);
  const slotConnections = connections.filter((connection) =>
    matchesTargetSlot(connection, nextConnection, targetNode)
  );
  const matchingConnection = slotConnections.find((connection) =>
    matchesConnectionDefinition(connection, nextConnection)
  );

  if (slotConnections.length === 1 && matchingConnection) {
    return {
      changed: false,
      connections,
    };
  }

  return {
    changed: true,
    connections: [
      ...connections.filter((connection) => !matchesTargetSlot(connection, nextConnection, targetNode)),
      matchingConnection ?? nextConnection,
    ],
  };
}
