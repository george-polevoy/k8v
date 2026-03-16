import type {
  Graph,
  GraphCommand,
} from './index.js';

const GRAPH_UPDATE_KEYS = [
  'name',
  'nodes',
  'connections',
  'recomputeConcurrency',
  'executionTimeoutMs',
  'canvasBackground',
  'connectionStroke',
  'projections',
  'activeProjectionId',
  'cameras',
  'pythonEnvs',
  'drawings',
] as const;

type GraphUpdateKey = (typeof GRAPH_UPDATE_KEYS)[number];
export type GraphCommandUpdatePayload = Partial<Pick<Graph, GraphUpdateKey>>;

function hasOwnGraphUpdateKey(
  updates: GraphCommandUpdatePayload,
  key: GraphUpdateKey
): updates is GraphCommandUpdatePayload & Record<GraphUpdateKey, Graph[GraphUpdateKey]> {
  return Object.prototype.hasOwnProperty.call(updates, key);
}

export function buildGraphCommandsFromGraphUpdate(
  updates: GraphCommandUpdatePayload
): GraphCommand[] {
  const commands: GraphCommand[] = [];

  for (const key of GRAPH_UPDATE_KEYS) {
    if (!hasOwnGraphUpdateKey(updates, key)) {
      continue;
    }

    switch (key) {
      case 'name':
        if (typeof updates.name === 'string') {
          commands.push({
            kind: 'set_graph_name',
            name: updates.name,
          });
        }
        break;
      case 'nodes':
        if (Array.isArray(updates.nodes)) {
          commands.push({
            kind: 'replace_nodes',
            nodes: updates.nodes,
          });
        }
        break;
      case 'connections':
        if (Array.isArray(updates.connections)) {
          commands.push({
            kind: 'replace_connections',
            connections: updates.connections,
          });
        }
        break;
      case 'recomputeConcurrency':
        if (typeof updates.recomputeConcurrency === 'number') {
          commands.push({
            kind: 'set_recompute_concurrency',
            recomputeConcurrency: updates.recomputeConcurrency,
          });
        }
        break;
      case 'executionTimeoutMs':
        if (typeof updates.executionTimeoutMs === 'number') {
          commands.push({
            kind: 'set_execution_timeout',
            executionTimeoutMs: updates.executionTimeoutMs,
          });
        }
        break;
      case 'canvasBackground':
        if (updates.canvasBackground) {
          commands.push({
            kind: 'set_canvas_background',
            canvasBackground: updates.canvasBackground,
          });
        }
        break;
      case 'connectionStroke':
        if (updates.connectionStroke) {
          commands.push({
            kind: 'set_connection_stroke',
            connectionStroke: updates.connectionStroke,
          });
        }
        break;
      case 'projections':
        if (Array.isArray(updates.projections)) {
          commands.push({
            kind: 'replace_projections',
            projections: updates.projections,
          });
        }
        break;
      case 'activeProjectionId':
        if (typeof updates.activeProjectionId === 'string') {
          commands.push({
            kind: 'set_active_projection',
            activeProjectionId: updates.activeProjectionId,
          });
        }
        break;
      case 'cameras':
        if (Array.isArray(updates.cameras)) {
          commands.push({
            kind: 'replace_cameras',
            cameras: updates.cameras,
          });
        }
        break;
      case 'pythonEnvs':
        if (Array.isArray(updates.pythonEnvs)) {
          commands.push({
            kind: 'replace_python_envs',
            pythonEnvs: updates.pythonEnvs,
          });
        }
        break;
      case 'drawings':
        if (Array.isArray(updates.drawings)) {
          commands.push({
            kind: 'replace_drawings',
            drawings: updates.drawings,
          });
        }
        break;
      default:
        break;
    }
  }

  return commands;
}
