import { DEFAULT_RUNTIME_ID, PYTHON_RUNTIME_ID } from './execution/types.js';
import { DEFAULT_GRAPH_PROJECTION_ID, type Graph } from '../types/index.js';
import {
  buildGraphNodeMap,
  filterComputationalConnections,
} from './annotationConnections.js';

function serializeConnectionTargetSlot(
  nodeById: ReadonlyMap<string, Graph['nodes'][number]>,
  connection: Graph['connections'][number]
): string {
  const targetNode = nodeById.get(connection.targetNodeId);
  if (targetNode?.type !== 'annotation') {
    return `${connection.targetNodeId}:${connection.targetPort}`;
  }

  const targetAnchor = connection.targetAnchor
    ? `${connection.targetAnchor.side}:${connection.targetAnchor.offset}`
    : '-';
  return `${connection.targetNodeId}:${connection.targetPort}@${targetAnchor}`;
}

export function validateGraphStructure(graph: Graph): string | null {
  const nodeIds = new Set<string>();
  const drawingIds = new Set<string>();
  const pythonEnvNames = new Set<string>();
  const projectionIds = new Set<string>();

  for (const node of graph.nodes) {
    if (nodeIds.has(node.id)) {
      return `Graph node ids must be unique. Duplicate id: ${node.id}`;
    }
    nodeIds.add(node.id);
  }

  const nodeById = buildGraphNodeMap(graph.nodes);

  if (!Array.isArray(graph.projections) || graph.projections.length === 0) {
    return 'Graph must include at least one projection';
  }
  if (!graph.activeProjectionId) {
    return 'Graph must include activeProjectionId';
  }
  for (const projection of graph.projections) {
    if (projectionIds.has(projection.id)) {
      return `Graph projection ids must be unique. Duplicate id: ${projection.id}`;
    }
    projectionIds.add(projection.id);
  }
  if (!projectionIds.has(DEFAULT_GRAPH_PROJECTION_ID)) {
    return `Graph must include "${DEFAULT_GRAPH_PROJECTION_ID}" projection`;
  }
  if (!projectionIds.has(graph.activeProjectionId)) {
    return `Graph active projection "${graph.activeProjectionId}" does not exist`;
  }

  for (const pythonEnv of graph.pythonEnvs ?? []) {
    if (pythonEnvNames.has(pythonEnv.name)) {
      return `Graph python environment names must be unique. Duplicate name: ${pythonEnv.name}`;
    }
    pythonEnvNames.add(pythonEnv.name);
  }

  for (const drawing of graph.drawings ?? []) {
    if (drawingIds.has(drawing.id)) {
      return `Graph drawing ids must be unique. Duplicate id: ${drawing.id}`;
    }
    drawingIds.add(drawing.id);

    const pathIds = new Set<string>();
    for (const path of drawing.paths) {
      if (pathIds.has(path.id)) {
        return `Drawing ${drawing.id} path ids must be unique. Duplicate id: ${path.id}`;
      }
      pathIds.add(path.id);
    }
  }

  for (const projection of graph.projections ?? []) {
    for (const nodeId of Object.keys(projection.nodePositions ?? {})) {
      if (!nodeIds.has(nodeId)) {
        return `Projection ${projection.id} references missing node ${nodeId}`;
      }
    }
    for (const [nodeId, size] of Object.entries(projection.nodeCardSizes ?? {})) {
      if (!nodeIds.has(nodeId)) {
        return `Projection ${projection.id} card size references missing node ${nodeId}`;
      }
      if (
        !Number.isFinite(size.width) ||
        size.width <= 0 ||
        !Number.isFinite(size.height) ||
        size.height <= 0
      ) {
        return `Projection ${projection.id} has invalid card size for node ${nodeId}`;
      }
    }
  }

  for (const connection of graph.connections) {
    if (!nodeIds.has(connection.sourceNodeId)) {
      return `Connection ${connection.id} references missing source node ${connection.sourceNodeId}`;
    }
    if (!nodeIds.has(connection.targetNodeId)) {
      return `Connection ${connection.id} references missing target node ${connection.targetNodeId}`;
    }
  }

  const occupiedTargetSlots = new Map<string, string>();
  for (const connection of graph.connections) {
    const targetSlot = serializeConnectionTargetSlot(nodeById, connection);
    const existingConnectionId = occupiedTargetSlots.get(targetSlot);
    if (existingConnectionId) {
      return `Target slot ${targetSlot} cannot have multiple inbound connections`;
    }
    occupiedTargetSlots.set(targetSlot, connection.id);
  }

  const adjacency = new Map<string, string[]>();
  for (const nodeId of nodeIds) {
    adjacency.set(nodeId, []);
  }
  for (const connection of filterComputationalConnections(graph.connections, nodeById)) {
    adjacency.get(connection.sourceNodeId)?.push(connection.targetNodeId);
  }

  const visited = new Set<string>();
  const visiting = new Set<string>();

  const dfs = (nodeId: string): boolean => {
    if (visiting.has(nodeId)) {
      return true;
    }
    if (visited.has(nodeId)) {
      return false;
    }

    visiting.add(nodeId);
    const neighbors = adjacency.get(nodeId) || [];
    for (const neighbor of neighbors) {
      if (dfs(neighbor)) {
        return true;
      }
    }
    visiting.delete(nodeId);
    visited.add(nodeId);
    return false;
  };

  for (const nodeId of nodeIds) {
    if (dfs(nodeId)) {
      return 'Graph contains a circular dependency';
    }
  }

  for (const node of graph.nodes) {
    const pythonEnvName = node.config.pythonEnv;
    if (!pythonEnvName) {
      continue;
    }

    const runtimeId = node.config.runtime ?? DEFAULT_RUNTIME_ID;
    if (runtimeId !== PYTHON_RUNTIME_ID) {
      return `Node ${node.id} references pythonEnv "${pythonEnvName}" but runtime "${runtimeId}" is not "${PYTHON_RUNTIME_ID}"`;
    }

    if (!pythonEnvNames.has(pythonEnvName)) {
      return `Node ${node.id} references unknown pythonEnv "${pythonEnvName}"`;
    }
  }

  return null;
}
