import type {
  Connection,
  ConnectionAnchor,
  Graph,
  GraphNode,
} from './index.js';

export const ANNOTATION_CONNECTION_PORT = '__annotation__';

export interface ConnectionListFilters {
  nodeId?: string;
  targetPort?: string;
}

export interface ConnectionSetInput {
  sourceNodeId: string;
  sourcePort: string;
  sourceAnchor?: ConnectionAnchor;
  targetNodeId: string;
  targetPort: string;
  targetAnchor?: ConnectionAnchor;
  connectionId?: string;
}

export interface ConnectionSetResult {
  changed: boolean;
  connection: Connection;
  connections: Connection[];
  replacedConnectionIds: string[];
}

function createGeneratedId(prefix: string): string {
  const cryptoLike = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  return cryptoLike?.randomUUID?.() ?? `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function serializeConnectionAnchor(anchor: ConnectionAnchor | undefined): string {
  if (!anchor) {
    return '-';
  }
  return `${anchor.side}:${anchor.offset}`;
}

export function buildGraphNodeMap(nodes: GraphNode[]): Map<string, GraphNode> {
  return new Map(nodes.map((node) => [node.id, node]));
}

export function isAnnotationNode(node: Pick<GraphNode, 'type'> | null | undefined): boolean {
  return node?.type === 'annotation';
}

export function isAnnotationLinkedConnection(
  connection: Connection,
  nodeById: ReadonlyMap<string, GraphNode>
): boolean {
  return (
    isAnnotationNode(nodeById.get(connection.sourceNodeId)) ||
    isAnnotationNode(nodeById.get(connection.targetNodeId))
  );
}

export function filterComputationalConnections(
  connections: Connection[],
  nodeById: ReadonlyMap<string, GraphNode>
): Connection[] {
  return connections.filter((connection) => !isAnnotationLinkedConnection(connection, nodeById));
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

export function getConnectionSignature(connection: Connection): string {
  return (
    `${connection.sourceNodeId}:${connection.sourcePort}@${serializeConnectionAnchor(connection.sourceAnchor)}` +
    `->${connection.targetNodeId}:${connection.targetPort}@${serializeConnectionAnchor(connection.targetAnchor)}`
  );
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

export function getNode(graph: Pick<Graph, 'id' | 'nodes'>, nodeId: string): GraphNode {
  const node = graph.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) {
    throw new Error(`Node ${nodeId} not found in graph ${graph.id}`);
  }
  return node;
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
  targetNode: Pick<GraphNode, 'type'> | undefined,
  input: Pick<ConnectionSetInput, 'targetNodeId' | 'targetPort' | 'targetAnchor'>
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

export function dedupeConnectionsByTargetSlot(nodes: GraphNode[], connections: Connection[]): Connection[] {
  const nodeById = buildGraphNodeMap(nodes);
  const seenSlots = new Set<string>();
  const deduped: Connection[] = [];

  for (let index = connections.length - 1; index >= 0; index -= 1) {
    const connection = connections[index];
    const targetNode = nodeById.get(connection.targetNodeId);
    const slotKey = !isAnnotationNode(targetNode)
      ? `${connection.targetNodeId}:${connection.targetPort}`
      : `${connection.targetNodeId}:${connection.targetPort}@${serializeConnectionAnchor(connection.targetAnchor)}`;
    if (seenSlots.has(slotKey)) {
      continue;
    }
    seenSlots.add(slotKey);
    deduped.push(connection);
  }

  deduped.reverse();
  return deduped;
}

export function assertConnectionPortsExist(
  graph: Pick<Graph, 'id' | 'nodes'>,
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

export function applyConnectionSetToConnections(
  nodes: GraphNode[],
  connections: Connection[],
  nextConnection: Connection
): { changed: boolean; connections: Connection[] } {
  const nodeById = buildGraphNodeMap(nodes);
  const targetNode = nodeById.get(nextConnection.targetNodeId);
  const slotConnections = connections.filter((connection) =>
    matchesTargetSlot(connection, targetNode, nextConnection)
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
      ...connections.filter((connection) => !matchesTargetSlot(connection, targetNode, nextConnection)),
      matchingConnection ?? nextConnection,
    ],
  };
}

export function applyConnectionSet(
  current: Pick<Graph, 'id' | 'nodes' | 'connections'>,
  input: ConnectionSetInput
): ConnectionSetResult {
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

  const inbound = current.connections.filter((connection) =>
    matchesTargetSlot(connection, targetNode, input)
  );
  const matchingInbound = inbound.find((connection) => matchesConnectionDefinition(connection, input));
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

  const nextConnectionId = explicitConnectionId ?? matchingInbound?.id ?? createGeneratedId('connection');
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
      ...current.connections.filter((connection) => !matchesTargetSlot(connection, targetNode, input)),
      nextConnection,
    ],
    replacedConnectionIds: inbound
      .filter((connection) => connection.id !== nextConnectionId)
      .map((connection) => connection.id),
  };
}
