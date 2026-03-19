import { Graph, GraphNode, NodeType } from '../../types/index.js';
import {
  buildGraphNodeMap,
  filterComputationalConnections,
  getConnectionSignature,
  isPresentationConnection,
} from '../annotationConnections.js';
import { BackendNodeExecutionState, DEFAULT_NODE_STATE, RecomputeTaskType } from './recomputeTypes.js';

export const DEFAULT_RECOMPUTE_CONCURRENCY = 1;
export const MAX_RECOMPUTE_CONCURRENCY = 32;

export function isErrorTextOutput(textOutput: unknown): boolean {
  return typeof textOutput === 'string' && /^\s*error:/i.test(textOutput.trim());
}

export function toErrorMessage(error: unknown): string {
  if (typeof error === 'string' && error.trim()) {
    return error;
  }
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return 'Recomputation failed';
}

export function isComputableNode(node: GraphNode): boolean {
  return node.type !== NodeType.ANNOTATION;
}

export function clampRecomputeConcurrency(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_RECOMPUTE_CONCURRENCY;
  }

  return Math.max(
    DEFAULT_RECOMPUTE_CONCURRENCY,
    Math.min(MAX_RECOMPUTE_CONCURRENCY, Math.floor(value))
  );
}

export function selectNodeIdsForTask(
  graph: Graph,
  type: RecomputeTaskType,
  rootNodeIds: string[]
): string[] {
  if (type === 'manual_graph') {
    const computableNodeIds = new Set(
      graph.nodes
        .filter((node) => isComputableNode(node))
        .map((node) => node.id)
    );
    return topologicalSortNodeIds(graph).filter((nodeId) => computableNodeIds.has(nodeId));
  }

  const graphNodeIds = new Set(graph.nodes.map((node) => node.id));
  const normalizedRoots = [...new Set(rootNodeIds)].filter((nodeId) => graphNodeIds.has(nodeId));

  if (normalizedRoots.length === 0) {
    return [];
  }

  const impactedNodeIds = collectImpactedDescendants(graph, normalizedRoots);
  const selectedNodeIds = new Set<string>();

  if (type === 'graph_update') {
    for (const node of graph.nodes) {
      if (
        impactedNodeIds.has(node.id) &&
        isComputableNode(node) &&
        getAutoRecomputeEnabled(node)
      ) {
        selectedNodeIds.add(node.id);
      }
    }
  } else {
    for (const rootNodeId of normalizedRoots) {
      const rootNode = graph.nodes.find((node) => node.id === rootNodeId);
      if (rootNode && isComputableNode(rootNode)) {
        selectedNodeIds.add(rootNodeId);
      }
    }

    for (const node of graph.nodes) {
      if (
        impactedNodeIds.has(node.id) &&
        isComputableNode(node) &&
        getAutoRecomputeEnabled(node)
      ) {
        selectedNodeIds.add(node.id);
      }
    }
  }

  return topologicalSortNodeIds(graph).filter((nodeId) => selectedNodeIds.has(nodeId));
}

export function collectStaleNodeIdsFromErrorStates(
  graph: Graph,
  nodeStates: Record<string, BackendNodeExecutionState>
): Set<string> {
  const outgoing = buildOutgoingAdjacency(graph);
  const queue: string[] = [];
  const visited = new Set<string>();
  const staleNodeIds = new Set<string>();

  for (const node of graph.nodes) {
    const nodeState = nodeStates[node.id] ?? DEFAULT_NODE_STATE;
    if (nodeState.hasError) {
      queue.push(node.id);
      visited.add(node.id);
    }
  }

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }

    for (const downstreamNodeId of outgoing.get(current) ?? []) {
      if (!visited.has(downstreamNodeId)) {
        visited.add(downstreamNodeId);
        queue.push(downstreamNodeId);
      }

      staleNodeIds.add(downstreamNodeId);
    }
  }

  return staleNodeIds;
}

export function collectChangedRootNodeIds(previousGraph: Graph, nextGraph: Graph): string[] {
  const previousNodeMap = new Map(previousGraph.nodes.map((node) => [node.id, node]));
  const nextNodeMap = new Map(nextGraph.nodes.map((node) => [node.id, node]));
  const rootNodeIds = new Set<string>();

  for (const nextNode of nextGraph.nodes) {
    const previousNode = previousNodeMap.get(nextNode.id);
    if (!previousNode || previousNode.version !== nextNode.version) {
      rootNodeIds.add(nextNode.id);
    }
  }

  const previousConnections = new Set(
    previousGraph.connections
      .filter((connection) => !isPresentationConnection(connection))
      .map(getConnectionSignature)
  );
  const nextConnections = new Set(
    nextGraph.connections
      .filter((connection) => !isPresentationConnection(connection))
      .map(getConnectionSignature)
  );

  for (const connection of nextGraph.connections) {
    if (isPresentationConnection(connection)) {
      continue;
    }
    const signature = getConnectionSignature(connection);
    if (previousConnections.has(signature)) {
      continue;
    }

    rootNodeIds.add(connection.sourceNodeId);
    rootNodeIds.add(connection.targetNodeId);
  }

  for (const connection of previousGraph.connections) {
    if (isPresentationConnection(connection)) {
      continue;
    }
    const signature = getConnectionSignature(connection);
    if (nextConnections.has(signature)) {
      continue;
    }

    if (nextNodeMap.has(connection.sourceNodeId)) {
      rootNodeIds.add(connection.sourceNodeId);
    }
    if (nextNodeMap.has(connection.targetNodeId)) {
      rootNodeIds.add(connection.targetNodeId);
    }
  }

  return [...rootNodeIds].filter((nodeId) => nextNodeMap.has(nodeId));
}

function getAutoRecomputeEnabled(node: GraphNode): boolean {
  return Boolean(node.config.config?.autoRecompute);
}

function collectImpactedDescendants(graph: Graph, roots: string[]): Set<string> {
  const outgoing = buildOutgoingAdjacency(graph);
  const queue = [...roots];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || visited.has(current)) {
      continue;
    }

    visited.add(current);

    for (const downstreamNodeId of outgoing.get(current) ?? []) {
      if (!visited.has(downstreamNodeId)) {
        queue.push(downstreamNodeId);
      }
    }
  }

  return visited;
}

function topologicalSortNodeIds(graph: Graph): string[] {
  const nodeOrder = new Map(graph.nodes.map((node, index) => [node.id, index]));
  const nodeById = buildGraphNodeMap(graph.nodes);
  const inDegree = new Map<string, number>();
  const outgoing = new Map<string, string[]>();

  for (const node of graph.nodes) {
    inDegree.set(node.id, 0);
    outgoing.set(node.id, []);
  }

  for (const connection of filterComputationalConnections(graph.connections, nodeById)) {
    if (!inDegree.has(connection.sourceNodeId) || !inDegree.has(connection.targetNodeId)) {
      continue;
    }

    outgoing.get(connection.sourceNodeId)?.push(connection.targetNodeId);
    inDegree.set(
      connection.targetNodeId,
      (inDegree.get(connection.targetNodeId) ?? 0) + 1
    );
  }

  const queue = graph.nodes
    .map((node) => node.id)
    .filter((nodeId) => (inDegree.get(nodeId) ?? 0) === 0)
    .sort((left, right) => (nodeOrder.get(left) ?? 0) - (nodeOrder.get(right) ?? 0));

  const ordered: string[] = [];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }

    ordered.push(current);

    for (const downstreamNodeId of outgoing.get(current) ?? []) {
      const nextDegree = (inDegree.get(downstreamNodeId) ?? 0) - 1;
      inDegree.set(downstreamNodeId, nextDegree);
      if (nextDegree === 0) {
        queue.push(downstreamNodeId);
        queue.sort((left, right) => (nodeOrder.get(left) ?? 0) - (nodeOrder.get(right) ?? 0));
      }
    }
  }

  if (ordered.length !== graph.nodes.length) {
    return graph.nodes.map((node) => node.id);
  }

  return ordered;
}

function buildOutgoingAdjacency(graph: Graph): Map<string, string[]> {
  const outgoing = new Map<string, string[]>();
  const nodeById = buildGraphNodeMap(graph.nodes);

  for (const node of graph.nodes) {
    outgoing.set(node.id, []);
  }

  for (const connection of filterComputationalConnections(graph.connections, nodeById)) {
    outgoing.get(connection.sourceNodeId)?.push(connection.targetNodeId);
  }

  return outgoing;
}
