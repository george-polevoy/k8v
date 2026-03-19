import type { Connection, GraphDrawing, GraphNode, GraphicsArtifact } from '../types';
import {
  isPresentationArrowConnection,
} from '../utils/annotationConnections';
import { isRenderableGraphicsArtifact } from '../utils/graphics';

export function getNextDrawingName(drawings: GraphDrawing[]): string {
  const existing = new Set(drawings.map((drawing) => drawing.name));
  let index = 1;
  let candidate = `Drawing ${index}`;
  while (existing.has(candidate)) {
    index += 1;
    candidate = `Drawing ${index}`;
  }
  return candidate;
}

export function isRenderablePythonGraphicsOutput(
  node: GraphNode,
  graphicsOutput: GraphicsArtifact | null | undefined
): graphicsOutput is GraphicsArtifact {
  return node.config.runtime === 'python_process' &&
    isRenderableGraphicsArtifact(graphicsOutput);
}

export function createsCycle(
  nodes: GraphNode[],
  sourceNodeId: string,
  targetNodeId: string,
  connections: Connection[]
): boolean {
  if (sourceNodeId === targetNodeId) {
    return true;
  }

  const adjacency = new Map<string, string[]>();
  for (const node of nodes) {
    adjacency.set(node.id, []);
  }

  for (const connection of connections) {
    if (isPresentationArrowConnection(connection)) {
      continue;
    }
    const next = adjacency.get(connection.sourceNodeId);
    if (next) {
      next.push(connection.targetNodeId);
    }
  }

  const stack = [targetNodeId];
  const visited = new Set<string>();

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || visited.has(current)) {
      continue;
    }

    if (current === sourceNodeId) {
      return true;
    }

    visited.add(current);
    const nextNodes = adjacency.get(current) || [];
    for (const next of nextNodes) {
      if (!visited.has(next)) {
        stack.push(next);
      }
    }
  }

  return false;
}
