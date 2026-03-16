import type { Graph } from '../types';
import { syncActiveProjectionLayout } from '../utils/projections';
import { normalizeGraph } from './graphStoreState';

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

export type GraphUpdatePayload = Partial<Pick<Graph, GraphUpdateKey>>;

function hasOwnGraphUpdateKey(
  updates: Partial<Graph>,
  key: GraphUpdateKey
): updates is Partial<Graph> & Record<GraphUpdateKey, Graph[GraphUpdateKey]> {
  return Object.prototype.hasOwnProperty.call(updates, key);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function areValuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true;
  }

  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }
    for (let index = 0; index < left.length; index += 1) {
      if (!areValuesEqual(left[index], right[index])) {
        return false;
      }
    }
    return true;
  }

  if (isObject(left) || isObject(right)) {
    if (!isObject(left) || !isObject(right)) {
      return false;
    }
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    if (leftKeys.length !== rightKeys.length) {
      return false;
    }
    for (const key of leftKeys) {
      if (!Object.prototype.hasOwnProperty.call(right, key)) {
        return false;
      }
      if (!areValuesEqual(left[key], right[key])) {
        return false;
      }
    }
    return true;
  }

  return false;
}

export function deriveGraphUpdatePayload(
  baseGraph: Graph,
  updates: Partial<Graph>
): GraphUpdatePayload {
  const payload: GraphUpdatePayload = {};
  const payloadRecord = payload as Partial<Record<GraphUpdateKey, Graph[GraphUpdateKey]>>;

  for (const key of GRAPH_UPDATE_KEYS) {
    if (!hasOwnGraphUpdateKey(updates, key)) {
      continue;
    }

    const nextValue = updates[key];
    if (!areValuesEqual(nextValue, baseGraph[key])) {
      payloadRecord[key] = nextValue;
    }
  }

  return payload;
}

export function applyGraphUpdatePayload(
  baseGraph: Graph,
  updates: GraphUpdatePayload
): Graph {
  const activeProjectionId = updates.activeProjectionId ?? baseGraph.activeProjectionId;
  const nodes = updates.nodes ?? baseGraph.nodes;
  const projections = hasOwnGraphUpdateKey(updates, 'projections')
    ? updates.projections
    : updates.nodes
      ? syncActiveProjectionLayout(baseGraph.projections, nodes, activeProjectionId)
      : baseGraph.projections;

  return normalizeGraph({
    ...baseGraph,
    ...updates,
    nodes,
    projections,
  } as Graph);
}
