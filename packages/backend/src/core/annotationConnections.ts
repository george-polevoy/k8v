import type {
  Connection,
  ConnectionAnchor,
  GraphNode,
} from '../types/index.js';
import { NodeType } from '../types/index.js';

export const ANNOTATION_CONNECTION_PORT = '__annotation__';

export function buildGraphNodeMap(nodes: GraphNode[]): Map<string, GraphNode> {
  return new Map(nodes.map((node) => [node.id, node]));
}

export function isAnnotationLinkedConnection(
  connection: Connection,
  nodeById: ReadonlyMap<string, GraphNode>
): boolean {
  return (
    nodeById.get(connection.sourceNodeId)?.type === NodeType.ANNOTATION ||
    nodeById.get(connection.targetNodeId)?.type === NodeType.ANNOTATION
  );
}

export function filterComputationalConnections(
  connections: Connection[],
  nodeById: ReadonlyMap<string, GraphNode>
): Connection[] {
  return connections.filter((connection) => !isAnnotationLinkedConnection(connection, nodeById));
}

function serializeConnectionAnchor(anchor: ConnectionAnchor | undefined): string {
  if (!anchor) {
    return '-';
  }

  return `${anchor.side}:${anchor.offset}`;
}

export function getConnectionSignature(connection: Connection): string {
  return (
    `${connection.sourceNodeId}:${connection.sourcePort}@${serializeConnectionAnchor(connection.sourceAnchor)}` +
    `->${connection.targetNodeId}:${connection.targetPort}@${serializeConnectionAnchor(connection.targetAnchor)}`
  );
}
