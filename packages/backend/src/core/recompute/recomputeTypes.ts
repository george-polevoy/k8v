export interface BackendNodeExecutionState {
  isPending: boolean;
  isComputing: boolean;
  hasError: boolean;
  isStale: boolean;
  errorMessage: string | null;
  lastRunAt: number | null;
}

export interface GraphRecomputeStatus {
  graphId: string;
  statusVersion: number;
  cursor: string;
  queueLength: number;
  workerConcurrency: number;
  isSnapshot: boolean;
  changedResultNodeIds: string[];
  nodeStates: Record<string, BackendNodeExecutionState>;
}

export interface RecomputeTaskSummary {
  scheduledNodeIds: string[];
  completedNodeIds: string[];
}

export type RecomputeTaskType = 'graph_update' | 'manual_node' | 'manual_graph';

export interface RecomputeTask {
  type: RecomputeTaskType;
  rootNodeIds: string[];
  graphRevision?: number;
  recomputeVersion?: number;
  resolve: (summary: RecomputeTaskSummary) => void;
  reject: (error: Error) => void;
}

export interface GraphRuntimeState {
  isProcessing: boolean;
  currentCursor: number;
  nextCursor: number;
  statusVersion: number;
  queue: RecomputeTask[];
  activeTaskNodeIds: string[];
  activeTaskGraphRevision: number | null;
  nodeStates: Record<string, BackendNodeExecutionState>;
  nodeStateCursorByNodeId: Record<string, number>;
  nodeResultCursorByNodeId: Record<string, number>;
}

export interface NodeRunOutcome {
  nodeId: string;
  success: boolean;
}

export const DEFAULT_NODE_STATE: BackendNodeExecutionState = {
  isPending: false,
  isComputing: false,
  hasError: false,
  isStale: false,
  errorMessage: null,
  lastRunAt: null,
};
