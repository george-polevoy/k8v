import type {
  Connection,
  GraphNode,
} from '../types';
import {
  applyConnectionSetToConnections,
  dedupeConnectionsByTargetSlot,
} from '../types';

export { dedupeConnectionsByTargetSlot };

export function applyConnectionSet(
  nodes: GraphNode[],
  connections: Connection[],
  nextConnection: Connection
): { changed: boolean; connections: Connection[] } {
  return applyConnectionSetToConnections(nodes, connections, nextConnection);
}
