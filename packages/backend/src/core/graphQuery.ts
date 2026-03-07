import type {
  Connection,
  Graph,
  GraphNode,
} from '../types/index.js';

export const GRAPH_QUERY_NODE_FIELDS = [
  'id',
  'name',
  'type',
  'version',
  'inputNames',
  'outputNames',
] as const;
export type GraphQueryNodeField = (typeof GRAPH_QUERY_NODE_FIELDS)[number];

export const GRAPH_QUERY_CONNECTION_FIELDS = [
  'id',
  'sourceNodeId',
  'sourcePort',
  'targetNodeId',
  'targetPort',
] as const;
export type GraphQueryConnectionField = (typeof GRAPH_QUERY_CONNECTION_FIELDS)[number];

interface GraphQueryBase {
  nodeFields?: GraphQueryNodeField[];
  connectionFields?: GraphQueryConnectionField[];
}

export interface GraphOverviewQuery extends GraphQueryBase {
  operation: 'overview';
}

export interface GraphStartingVerticesQuery extends GraphQueryBase {
  operation: 'starting_vertices';
}

export interface GraphTraverseBfsQuery extends GraphQueryBase {
  operation: 'traverse_bfs';
  startNodeIds: string[];
  depth?: number;
}

export interface GraphTraverseDfsQuery extends GraphQueryBase {
  operation: 'traverse_dfs';
  startNodeIds: string[];
  maxNodes: number;
}

export type GraphQueryRequest =
  | GraphOverviewQuery
  | GraphStartingVerticesQuery
  | GraphTraverseBfsQuery
  | GraphTraverseDfsQuery;

const DEFAULT_GRAPH_QUERY_NODE_FIELDS: GraphQueryNodeField[] = ['id', 'name'];
const DEFAULT_GRAPH_QUERY_CONNECTION_FIELDS: GraphQueryConnectionField[] = [
  'sourcePort',
  'targetPort',
];
const REQUIRED_GRAPH_QUERY_CONNECTION_FIELDS: GraphQueryConnectionField[] = [
  'sourceNodeId',
  'targetNodeId',
];

export class GraphQueryValidationError extends Error {}

function resolveGraphNodeQueryFields(
  requested: GraphQueryNodeField[] | undefined
): GraphQueryNodeField[] {
  const ordered = requested ?? DEFAULT_GRAPH_QUERY_NODE_FIELDS;
  const seen = new Set<GraphQueryNodeField>();
  const unique: GraphQueryNodeField[] = [];
  for (const field of ordered) {
    if (seen.has(field)) {
      continue;
    }
    seen.add(field);
    unique.push(field);
  }
  return unique;
}

function resolveGraphConnectionQueryFields(
  requested: GraphQueryConnectionField[] | undefined
): GraphQueryConnectionField[] {
  const ordered = [
    ...REQUIRED_GRAPH_QUERY_CONNECTION_FIELDS,
    ...(requested ?? DEFAULT_GRAPH_QUERY_CONNECTION_FIELDS),
  ];
  const seen = new Set<GraphQueryConnectionField>();
  const unique: GraphQueryConnectionField[] = [];
  for (const field of ordered) {
    if (seen.has(field)) {
      continue;
    }
    seen.add(field);
    unique.push(field);
  }
  return unique;
}

function projectGraphNode(
  node: GraphNode,
  fields: GraphQueryNodeField[]
): Record<string, unknown> {
  const projected: Record<string, unknown> = {};
  for (const field of fields) {
    switch (field) {
      case 'id':
        projected.id = node.id;
        break;
      case 'name':
        projected.name = node.metadata.name;
        break;
      case 'type':
        projected.type = node.type;
        break;
      case 'version':
        projected.version = node.version;
        break;
      case 'inputNames':
        projected.inputNames = node.metadata.inputs.map((input) => input.name);
        break;
      case 'outputNames':
        projected.outputNames = node.metadata.outputs.map((output) => output.name);
        break;
      default:
        break;
    }
  }
  return projected;
}

function projectGraphConnection(
  connection: Connection,
  fields: GraphQueryConnectionField[]
): Record<string, unknown> {
  const projected: Record<string, unknown> = {};
  for (const field of fields) {
    switch (field) {
      case 'id':
        projected.id = connection.id;
        break;
      case 'sourceNodeId':
        projected.sourceNodeId = connection.sourceNodeId;
        break;
      case 'sourcePort':
        projected.sourcePort = connection.sourcePort;
        break;
      case 'targetNodeId':
        projected.targetNodeId = connection.targetNodeId;
        break;
      case 'targetPort':
        projected.targetPort = connection.targetPort;
        break;
      default:
        break;
    }
  }
  return projected;
}

function buildOutgoingAdjacency(graph: Graph): Map<string, string[]> {
  const outgoing = new Map<string, string[]>();
  for (const node of graph.nodes) {
    outgoing.set(node.id, []);
  }
  for (const connection of graph.connections) {
    const neighbors = outgoing.get(connection.sourceNodeId);
    if (!neighbors) {
      continue;
    }
    neighbors.push(connection.targetNodeId);
  }
  return outgoing;
}

function dedupeNodeIds(nodeIds: string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const nodeId of nodeIds) {
    if (seen.has(nodeId)) {
      continue;
    }
    seen.add(nodeId);
    deduped.push(nodeId);
  }
  return deduped;
}

function findUnknownNodeIds(graph: Graph, nodeIds: string[]): string[] {
  const graphNodeIds = new Set(graph.nodes.map((node) => node.id));
  return nodeIds.filter((nodeId) => !graphNodeIds.has(nodeId));
}

function traverseGraphBfs(
  graph: Graph,
  startNodeIds: string[],
  depth?: number
): string[] {
  const outgoing = buildOutgoingAdjacency(graph);
  const visited = new Set<string>();
  const ordered: string[] = [];
  const queue: Array<{ nodeId: string; depth: number }> = [];

  for (const startNodeId of startNodeIds) {
    if (visited.has(startNodeId)) {
      continue;
    }
    visited.add(startNodeId);
    ordered.push(startNodeId);
    queue.push({ nodeId: startNodeId, depth: 0 });
  }

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      break;
    }

    if (typeof depth === 'number' && current.depth >= depth) {
      continue;
    }

    for (const neighborId of outgoing.get(current.nodeId) ?? []) {
      if (visited.has(neighborId)) {
        continue;
      }
      visited.add(neighborId);
      ordered.push(neighborId);
      queue.push({ nodeId: neighborId, depth: current.depth + 1 });
    }
  }

  return ordered;
}

function traverseGraphDfs(
  graph: Graph,
  startNodeIds: string[],
  maxNodes: number
): string[] {
  const outgoing = buildOutgoingAdjacency(graph);
  const visited = new Set<string>();
  const ordered: string[] = [];
  const stack: string[] = [];

  for (let index = startNodeIds.length - 1; index >= 0; index -= 1) {
    stack.push(startNodeIds[index]);
  }

  while (stack.length > 0 && ordered.length < maxNodes) {
    const nodeId = stack.pop() as string;
    if (visited.has(nodeId)) {
      continue;
    }

    visited.add(nodeId);
    ordered.push(nodeId);
    if (ordered.length >= maxNodes) {
      break;
    }

    const neighbors = outgoing.get(nodeId) ?? [];
    for (let index = neighbors.length - 1; index >= 0; index -= 1) {
      const neighborId = neighbors[index];
      if (!visited.has(neighborId)) {
        stack.push(neighborId);
      }
    }
  }

  return ordered;
}

function findStartingVertices(graph: Graph): GraphNode[] {
  const nodesWithDownstream = new Set(graph.connections.map((connection) => connection.sourceNodeId));
  return graph.nodes.filter((node) => !nodesWithDownstream.has(node.id));
}

function filterConnectionsForNodeSet(
  connections: Connection[],
  nodeIds: Set<string>
): Connection[] {
  return connections.filter(
    (connection) => nodeIds.has(connection.sourceNodeId) && nodeIds.has(connection.targetNodeId)
  );
}

export function executeGraphQuery(
  graph: Graph,
  query: GraphQueryRequest
): Record<string, unknown> {
  const nodeFields = resolveGraphNodeQueryFields(query.nodeFields);
  const connectionFields = resolveGraphConnectionQueryFields(query.connectionFields);

  if (query.operation === 'overview') {
    return {
      graphId: graph.id,
      operation: query.operation,
      nodeFields,
      connectionFields,
      nodeCount: graph.nodes.length,
      connectionCount: graph.connections.length,
      nodes: graph.nodes.map((node) => projectGraphNode(node, nodeFields)),
      connections: graph.connections.map((connection) =>
        projectGraphConnection(connection, connectionFields)
      ),
    };
  }

  if (query.operation === 'starting_vertices') {
    const startNodes = findStartingVertices(graph);
    return {
      graphId: graph.id,
      operation: query.operation,
      nodeFields,
      nodeCount: startNodes.length,
      nodes: startNodes.map((node) => projectGraphNode(node, nodeFields)),
    };
  }

  const startNodeIds = dedupeNodeIds(query.startNodeIds);
  const unknownNodeIds = findUnknownNodeIds(graph, startNodeIds);
  if (unknownNodeIds.length > 0) {
    throw new GraphQueryValidationError(
      `Start node ids not found in graph ${graph.id}: ${unknownNodeIds.join(', ')}`
    );
  }

  const traversedNodeIds = query.operation === 'traverse_bfs'
    ? traverseGraphBfs(graph, startNodeIds, query.depth)
    : traverseGraphDfs(graph, startNodeIds, query.maxNodes);
  const traversedNodeIdSet = new Set(traversedNodeIds);
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const traversedNodes = traversedNodeIds
    .map((nodeId) => nodeById.get(nodeId))
    .filter((node): node is GraphNode => Boolean(node));
  const traversedConnections = filterConnectionsForNodeSet(
    graph.connections,
    traversedNodeIdSet
  );

  return {
    graphId: graph.id,
    operation: query.operation,
    startNodeIds,
    ...(query.operation === 'traverse_bfs' && typeof query.depth === 'number'
      ? { depth: query.depth }
      : {}),
    ...(query.operation === 'traverse_dfs'
      ? { maxNodes: query.maxNodes }
      : {}),
    nodeFields,
    connectionFields,
    nodeCount: traversedNodes.length,
    connectionCount: traversedConnections.length,
    nodes: traversedNodes.map((node) => projectGraphNode(node, nodeFields)),
    connections: traversedConnections.map((connection) =>
      projectGraphConnection(connection, connectionFields)
    ),
  };
}
