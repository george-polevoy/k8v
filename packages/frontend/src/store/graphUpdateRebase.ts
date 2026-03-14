import type {
  Connection,
  Graph,
  GraphCamera,
  GraphDrawing,
  GraphNode,
  GraphProjection,
} from '../types';
import { normalizeGraph } from './graphStoreState';
import { syncActiveProjectionLayout } from '../utils/projections';

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

interface RebaseSuccess {
  ok: true;
  updates: GraphUpdatePayload;
}

interface RebaseConflict {
  ok: false;
}

type RebaseResult = RebaseSuccess | RebaseConflict;

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

function mapById<T extends { id: string }>(items: T[]): Map<string, T> {
  return new Map(items.map((item) => [item.id, item]));
}

function mergeScalarField<T>(
  baseValue: T,
  localValue: T,
  latestValue: T
): T | null {
  if (areValuesEqual(latestValue, baseValue) || areValuesEqual(latestValue, localValue)) {
    return localValue;
  }
  return null;
}

function mergeEntityArraysById<T extends { id: string }>(
  baseItems: T[],
  localItems: T[],
  latestItems: T[]
): T[] | null {
  const baseById = mapById(baseItems);
  const localById = mapById(localItems);
  const latestById = mapById(latestItems);

  const localDeletedIds = new Set(
    baseItems
      .filter((item) => !localById.has(item.id))
      .map((item) => item.id)
  );
  const localUpdatedIds = new Set(
    localItems
      .filter((item) => {
        const baseItem = baseById.get(item.id);
        return Boolean(baseItem) && !areValuesEqual(item, baseItem);
      })
      .map((item) => item.id)
  );
  const localAddedItems = localItems.filter((item) => !baseById.has(item.id));

  const replacements = new Map<string, T>();

  for (const item of localItems) {
    if (!localUpdatedIds.has(item.id)) {
      continue;
    }

    const baseItem = baseById.get(item.id);
    const latestItem = latestById.get(item.id);
    if (!baseItem || !latestItem) {
      return null;
    }

    if (!areValuesEqual(latestItem, baseItem) && !areValuesEqual(latestItem, item)) {
      return null;
    }

    replacements.set(item.id, item);
  }

  for (const item of localAddedItems) {
    const latestItem = latestById.get(item.id);
    if (!latestItem) {
      continue;
    }
    if (!areValuesEqual(latestItem, item)) {
      return null;
    }
  }

  for (const deletedId of localDeletedIds) {
    const baseItem = baseById.get(deletedId);
    const latestItem = latestById.get(deletedId);
    if (!baseItem || !latestItem) {
      continue;
    }
    if (!areValuesEqual(latestItem, baseItem)) {
      return null;
    }
  }

  const merged = latestItems
    .filter((item) => !localDeletedIds.has(item.id))
    .map((item) => replacements.get(item.id) ?? item);

  for (const item of localAddedItems) {
    if (!latestById.has(item.id)) {
      merged.push(item);
    }
  }

  return merged;
}

function mergeRecordByKey<T>(
  baseRecord: Record<string, T>,
  localRecord: Record<string, T>,
  latestRecord: Record<string, T>
): Record<string, T> | null {
  const baseKeys = new Set(Object.keys(baseRecord));
  const localKeys = new Set(Object.keys(localRecord));
  const latestKeys = new Set(Object.keys(latestRecord));

  for (const key of baseKeys) {
    const localHasKey = localKeys.has(key);
    const latestHasKey = latestKeys.has(key);
    const baseValue = baseRecord[key];
    const latestValue = latestRecord[key];

    if (!localHasKey) {
      if (latestHasKey && !areValuesEqual(latestValue, baseValue)) {
        return null;
      }
      continue;
    }

    const localValue = localRecord[key];
    if (!latestHasKey) {
      if (!areValuesEqual(localValue, baseValue)) {
        return null;
      }
      continue;
    }

    if (areValuesEqual(localValue, baseValue)) {
      continue;
    }

    if (!areValuesEqual(latestValue, baseValue) && !areValuesEqual(latestValue, localValue)) {
      return null;
    }
  }

  for (const key of localKeys) {
    if (baseKeys.has(key)) {
      continue;
    }

    const localValue = localRecord[key];
    if (!latestKeys.has(key)) {
      continue;
    }

    if (!areValuesEqual(latestRecord[key], localValue)) {
      return null;
    }
  }

  const merged: Record<string, T> = {};
  for (const [key, value] of Object.entries(latestRecord)) {
    if (!baseKeys.has(key) || localKeys.has(key)) {
      merged[key] = value;
    }
  }

  for (const [key, value] of Object.entries(localRecord)) {
    if (!baseKeys.has(key) || !areValuesEqual(value, baseRecord[key])) {
      merged[key] = value;
    }
  }

  return merged;
}

function mergeGraphCamera(
  baseCamera: GraphCamera,
  localCamera: GraphCamera,
  latestCamera: GraphCamera
): GraphCamera | null {
  let mergedName = latestCamera.name;
  if (!areValuesEqual(localCamera.name, baseCamera.name)) {
    const merged = mergeScalarField(baseCamera.name, localCamera.name, latestCamera.name);
    if (merged === null) {
      return null;
    }
    mergedName = merged;
  }

  let mergedViewport = latestCamera.viewport;
  if (!areValuesEqual(localCamera.viewport, baseCamera.viewport)) {
    const merged = mergeScalarField(baseCamera.viewport, localCamera.viewport, latestCamera.viewport);
    if (merged === null) {
      return null;
    }
    mergedViewport = merged;
  }

  let mergedFloatingWindows = latestCamera.floatingWindows ?? {};
  if (!areValuesEqual(localCamera.floatingWindows ?? {}, baseCamera.floatingWindows ?? {})) {
    const merged = mergeRecordByKey(
      baseCamera.floatingWindows ?? {},
      localCamera.floatingWindows ?? {},
      latestCamera.floatingWindows ?? {}
    );
    if (!merged) {
      return null;
    }
    mergedFloatingWindows = merged;
  }

  return {
    ...latestCamera,
    name: mergedName,
    viewport: mergedViewport,
    floatingWindows: mergedFloatingWindows,
  };
}

function mergeGraphCameras(
  baseItems: GraphCamera[],
  localItems: GraphCamera[],
  latestItems: GraphCamera[]
): GraphCamera[] | null {
  const baseById = mapById(baseItems);
  const localById = mapById(localItems);
  const latestById = mapById(latestItems);
  const localDeletedIds = new Set(
    baseItems
      .filter((item) => !localById.has(item.id))
      .map((item) => item.id)
  );
  const localAddedItems = localItems.filter((item) => !baseById.has(item.id));
  const replacements = new Map<string, GraphCamera>();

  for (const localItem of localItems) {
    const baseItem = baseById.get(localItem.id);
    if (!baseItem || areValuesEqual(localItem, baseItem)) {
      continue;
    }

    const latestItem = latestById.get(localItem.id);
    if (!latestItem) {
      return null;
    }

    const merged = mergeGraphCamera(baseItem, localItem, latestItem);
    if (!merged) {
      return null;
    }
    replacements.set(localItem.id, merged);
  }

  for (const item of localAddedItems) {
    const latestItem = latestById.get(item.id);
    if (!latestItem) {
      continue;
    }
    if (!areValuesEqual(latestItem, item)) {
      return null;
    }
  }

  for (const deletedId of localDeletedIds) {
    const baseItem = baseById.get(deletedId);
    const latestItem = latestById.get(deletedId);
    if (!baseItem || !latestItem) {
      continue;
    }
    if (!areValuesEqual(latestItem, baseItem)) {
      return null;
    }
  }

  const merged = latestItems
    .filter((item) => !localDeletedIds.has(item.id))
    .map((item) => replacements.get(item.id) ?? item);

  for (const item of localAddedItems) {
    if (!latestById.has(item.id)) {
      merged.push(item);
    }
  }

  return merged;
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

export function rebaseGraphUpdate(
  baseGraph: Graph,
  updates: GraphUpdatePayload,
  latestGraph: Graph
): RebaseResult {
  const rebased: GraphUpdatePayload = {};

  if (hasOwnGraphUpdateKey(updates, 'name')) {
    const merged = mergeScalarField(baseGraph.name, updates.name, latestGraph.name);
    if (merged === null) {
      return { ok: false };
    }
    rebased.name = merged;
  }

  if (hasOwnGraphUpdateKey(updates, 'recomputeConcurrency')) {
    const merged = mergeScalarField(
      baseGraph.recomputeConcurrency,
      updates.recomputeConcurrency,
      latestGraph.recomputeConcurrency
    );
    if (merged === null) {
      return { ok: false };
    }
    rebased.recomputeConcurrency = merged;
  }

  if (hasOwnGraphUpdateKey(updates, 'executionTimeoutMs')) {
    const merged = mergeScalarField(
      baseGraph.executionTimeoutMs,
      updates.executionTimeoutMs,
      latestGraph.executionTimeoutMs
    );
    if (merged === null) {
      return { ok: false };
    }
    rebased.executionTimeoutMs = merged;
  }

  if (hasOwnGraphUpdateKey(updates, 'canvasBackground')) {
    const merged = mergeScalarField(
      baseGraph.canvasBackground,
      updates.canvasBackground,
      latestGraph.canvasBackground
    );
    if (merged === null) {
      return { ok: false };
    }
    rebased.canvasBackground = merged;
  }

  if (hasOwnGraphUpdateKey(updates, 'connectionStroke')) {
    const merged = mergeScalarField(
      baseGraph.connectionStroke,
      updates.connectionStroke,
      latestGraph.connectionStroke
    );
    if (merged === null) {
      return { ok: false };
    }
    rebased.connectionStroke = merged;
  }

  if (hasOwnGraphUpdateKey(updates, 'activeProjectionId')) {
    const merged = mergeScalarField(
      baseGraph.activeProjectionId,
      updates.activeProjectionId,
      latestGraph.activeProjectionId
    );
    if (merged === null) {
      return { ok: false };
    }
    rebased.activeProjectionId = merged;
  }

  if (hasOwnGraphUpdateKey(updates, 'pythonEnvs')) {
    const merged = mergeScalarField(
      baseGraph.pythonEnvs,
      updates.pythonEnvs,
      latestGraph.pythonEnvs
    );
    if (merged === null) {
      return { ok: false };
    }
    rebased.pythonEnvs = merged;
  }

  if (hasOwnGraphUpdateKey(updates, 'nodes')) {
    if (!Array.isArray(updates.nodes)) {
      return { ok: false };
    }
    const merged = mergeEntityArraysById<GraphNode>(
      baseGraph.nodes,
      updates.nodes,
      latestGraph.nodes
    );
    if (!merged) {
      return { ok: false };
    }
    rebased.nodes = merged;
  }

  if (hasOwnGraphUpdateKey(updates, 'connections')) {
    if (!Array.isArray(updates.connections)) {
      return { ok: false };
    }
    const merged = mergeEntityArraysById<Connection>(
      baseGraph.connections,
      updates.connections,
      latestGraph.connections
    );
    if (!merged) {
      return { ok: false };
    }
    rebased.connections = merged;
  }

  if (hasOwnGraphUpdateKey(updates, 'drawings')) {
    const merged = mergeEntityArraysById<GraphDrawing>(
      baseGraph.drawings ?? [],
      updates.drawings ?? [],
      latestGraph.drawings ?? []
    );
    if (!merged) {
      return { ok: false };
    }
    rebased.drawings = merged;
  }

  if (hasOwnGraphUpdateKey(updates, 'projections')) {
    const merged = mergeEntityArraysById<GraphProjection>(
      baseGraph.projections ?? [],
      updates.projections ?? [],
      latestGraph.projections ?? []
    );
    if (!merged) {
      return { ok: false };
    }
    rebased.projections = merged;
  }

  if (hasOwnGraphUpdateKey(updates, 'cameras')) {
    const merged = mergeGraphCameras(
      baseGraph.cameras ?? [],
      updates.cameras ?? [],
      latestGraph.cameras ?? []
    );
    if (!merged) {
      return { ok: false };
    }
    rebased.cameras = merged;
  }

  return {
    ok: true,
    updates: rebased,
  };
}
