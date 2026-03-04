import { Graph, GraphConnectionStrokeSettings } from '../types';
import {
  DEFAULT_GRAPH_CONNECTION_STROKE as SHARED_DEFAULT_GRAPH_CONNECTION_STROKE,
  normalizeGraphConnectionStroke as normalizeSharedGraphConnectionStroke,
} from '../../../shared/src/connectionStroke.js';

export const DEFAULT_GRAPH_CONNECTION_STROKE: GraphConnectionStrokeSettings = SHARED_DEFAULT_GRAPH_CONNECTION_STROKE;

export function normalizeGraphConnectionStroke(
  value: Partial<GraphConnectionStrokeSettings> | null | undefined
): GraphConnectionStrokeSettings {
  return normalizeSharedGraphConnectionStroke(value);
}

export function resolveGraphConnectionStroke(
  graph: Pick<Graph, 'connectionStroke'> | null | undefined
): GraphConnectionStrokeSettings {
  return normalizeGraphConnectionStroke(graph?.connectionStroke);
}
