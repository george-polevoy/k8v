import { randomUUID } from 'node:crypto';
import { Graph } from '../../types/index.js';
import {
  BackendNodeExecutionState,
  DEFAULT_NODE_STATE,
  GraphRecomputeStatus,
  GraphRuntimeState,
} from './recomputeTypes.js';

export class RecomputeStateStore {
  private readonly runtimeInstanceId = randomUUID();
  private readonly graphStates = new Map<string, GraphRuntimeState>();

  getOrCreateGraphState(graphId: string): GraphRuntimeState {
    const existing = this.graphStates.get(graphId);
    if (existing) {
      return existing;
    }

    const created: GraphRuntimeState = {
      isProcessing: false,
      currentCursor: 0,
      nextCursor: 1,
      statusVersion: 0,
      queue: [],
      activeTaskNodeIds: [],
      activeTaskGraphRevision: null,
      nodeStates: {},
      nodeStateCursorByNodeId: {},
      nodeResultCursorByNodeId: {},
    };

    this.graphStates.set(graphId, created);
    return created;
  }

  dropGraphState(graphId: string): void {
    this.graphStates.delete(graphId);
  }

  synchronizeNodeStates(graph: Graph, state: GraphRuntimeState): void {
    const nextStates: Record<string, BackendNodeExecutionState> = {};
    const nextStateCursors: Record<string, number> = {};
    const nextResultCursors: Record<string, number> = {};

    for (const node of graph.nodes) {
      nextStates[node.id] = {
        ...DEFAULT_NODE_STATE,
        ...(state.nodeStates[node.id] ?? {}),
      };
      nextStateCursors[node.id] = state.nodeStateCursorByNodeId[node.id] ?? 0;
      nextResultCursors[node.id] = state.nodeResultCursorByNodeId[node.id] ?? 0;
    }

    const previousNodeIds = Object.keys(state.nodeStates);
    const nextNodeIds = Object.keys(nextStates);

    const changedShape =
      previousNodeIds.length !== nextNodeIds.length ||
      previousNodeIds.some((nodeId) => !(nodeId in nextStates));

    if (changedShape) {
      state.nodeStates = nextStates;
      state.nodeStateCursorByNodeId = nextStateCursors;
      state.nodeResultCursorByNodeId = nextResultCursors;
      state.statusVersion += 1;
      return;
    }

    state.nodeStates = nextStates;
    state.nodeStateCursorByNodeId = nextStateCursors;
    state.nodeResultCursorByNodeId = nextResultCursors;
  }

  patchNodeState(
    state: GraphRuntimeState,
    nodeId: string,
    patch: Partial<BackendNodeExecutionState>
  ): boolean {
    const previousState = state.nodeStates[nodeId] ?? { ...DEFAULT_NODE_STATE };
    const nextState: BackendNodeExecutionState = {
      ...previousState,
      ...patch,
    };

    const changed =
      previousState.isPending !== nextState.isPending ||
      previousState.isComputing !== nextState.isComputing ||
      previousState.hasError !== nextState.hasError ||
      previousState.isStale !== nextState.isStale ||
      previousState.errorMessage !== nextState.errorMessage ||
      previousState.lastRunAt !== nextState.lastRunAt;

    if (!changed) {
      return false;
    }

    state.nodeStates[nodeId] = nextState;
    state.statusVersion += 1;
    state.nodeStateCursorByNodeId[nodeId] = this.advanceCursor(state);
    return true;
  }

  markResultUpdated(state: GraphRuntimeState, nodeId: string): void {
    state.nodeResultCursorByNodeId[nodeId] = this.advanceCursor(state);
  }

  markNodesPending(state: GraphRuntimeState, nodeIds: string[]): string[] {
    const changedNodeIds: string[] = [];
    for (const nodeId of nodeIds) {
      if (this.patchNodeState(state, nodeId, {
        isPending: true,
        isComputing: false,
        hasError: false,
        isStale: false,
        errorMessage: null,
      })) {
        changedNodeIds.push(nodeId);
      }
    }
    return changedNodeIds;
  }

  buildRuntimeStatus(
    graph: Graph,
    state: GraphRuntimeState,
    queueLength: number,
    workerConcurrency: number,
    sinceCursor?: string
  ): GraphRecomputeStatus {
    const cursor = this.formatCursor(state.currentCursor);
    const parsedSinceCursor = this.parseCursor(sinceCursor);
    const shouldReturnSnapshot =
      parsedSinceCursor === null ||
      parsedSinceCursor > state.currentCursor;

    if (shouldReturnSnapshot) {
      return {
        graphId: graph.id,
        statusVersion: state.statusVersion,
        cursor,
        queueLength,
        workerConcurrency,
        isSnapshot: true,
        changedResultNodeIds: graph.nodes.map((node) => node.id),
        nodeStates: { ...state.nodeStates },
      };
    }

    const changedStateNodeIds = graph.nodes
      .map((node) => node.id)
      .filter((nodeId) => (state.nodeStateCursorByNodeId[nodeId] ?? 0) > parsedSinceCursor);
    const changedResultNodeIds = graph.nodes
      .map((node) => node.id)
      .filter((nodeId) => (state.nodeResultCursorByNodeId[nodeId] ?? 0) > parsedSinceCursor);

    return {
      graphId: graph.id,
      statusVersion: state.statusVersion,
      cursor,
      queueLength,
      workerConcurrency,
      isSnapshot: false,
      changedResultNodeIds,
      nodeStates: Object.fromEntries(
        changedStateNodeIds.map((nodeId) => [nodeId, state.nodeStates[nodeId] ?? DEFAULT_NODE_STATE])
      ),
    };
  }

  private advanceCursor(state: GraphRuntimeState): number {
    const cursor = state.nextCursor;
    state.nextCursor += 1;
    state.currentCursor = cursor;
    return cursor;
  }

  private formatCursor(cursor: number): string {
    return `${this.runtimeInstanceId}:${cursor}`;
  }

  private parseCursor(cursor: string | undefined): number | null {
    if (typeof cursor !== 'string') {
      return null;
    }

    const trimmed = cursor.trim();
    if (!trimmed) {
      return null;
    }

    const [instanceId, rawCursor, ...rest] = trimmed.split(':');
    if (
      rest.length > 0 ||
      instanceId !== this.runtimeInstanceId ||
      typeof rawCursor !== 'string'
    ) {
      return null;
    }

    const parsedCursor = Number.parseInt(rawCursor, 10);
    if (!Number.isSafeInteger(parsedCursor) || parsedCursor < 0) {
      return null;
    }

    return parsedCursor;
  }
}
