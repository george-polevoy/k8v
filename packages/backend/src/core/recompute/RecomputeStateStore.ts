import { Graph } from '../../types/index.js';
import {
  BackendNodeExecutionState,
  DEFAULT_NODE_STATE,
  GraphRuntimeState,
} from './recomputeTypes.js';

export class RecomputeStateStore {
  private readonly graphStates = new Map<string, GraphRuntimeState>();

  getOrCreateGraphState(graphId: string): GraphRuntimeState {
    const existing = this.graphStates.get(graphId);
    if (existing) {
      return existing;
    }

    const created: GraphRuntimeState = {
      isProcessing: false,
      statusVersion: 0,
      queue: [],
      activeTaskNodeIds: [],
      activeTaskGraphRevision: null,
      nodeStates: {},
    };

    this.graphStates.set(graphId, created);
    return created;
  }

  dropGraphState(graphId: string): void {
    this.graphStates.delete(graphId);
  }

  synchronizeNodeStates(graph: Graph, state: GraphRuntimeState): void {
    const nextStates: Record<string, BackendNodeExecutionState> = {};

    for (const node of graph.nodes) {
      nextStates[node.id] = {
        ...DEFAULT_NODE_STATE,
        ...(state.nodeStates[node.id] ?? {}),
      };
    }

    const previousNodeIds = Object.keys(state.nodeStates);
    const nextNodeIds = Object.keys(nextStates);

    const changedShape =
      previousNodeIds.length !== nextNodeIds.length ||
      previousNodeIds.some((nodeId) => !(nodeId in nextStates));

    if (changedShape) {
      state.nodeStates = nextStates;
      state.statusVersion += 1;
      return;
    }

    state.nodeStates = nextStates;
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
    return true;
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
}
