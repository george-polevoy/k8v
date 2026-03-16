import type { GraphEvent } from '../types/index.js';

type Listener = (event: GraphEvent) => void;

export class GraphEventBroker {
  private readonly listenersByGraphId = new Map<string, Set<Listener>>();

  subscribe(graphId: string, listener: Listener): () => void {
    const listeners = this.listenersByGraphId.get(graphId) ?? new Set<Listener>();
    listeners.add(listener);
    this.listenersByGraphId.set(graphId, listeners);

    return () => {
      const current = this.listenersByGraphId.get(graphId);
      if (!current) {
        return;
      }
      current.delete(listener);
      if (current.size === 0) {
        this.listenersByGraphId.delete(graphId);
      }
    };
  }

  publish(event: GraphEvent): void {
    for (const listener of this.listenersByGraphId.get(event.graphId) ?? []) {
      listener(event);
    }
  }
}
