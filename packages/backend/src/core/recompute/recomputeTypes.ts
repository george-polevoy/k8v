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
  queueLength: number;
  workerConcurrency: number;
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
  recomputeVersion?: number;
  resolve: (summary: RecomputeTaskSummary) => void;
  reject: (error: Error) => void;
}

export interface GraphRuntimeState {
  isProcessing: boolean;
  statusVersion: number;
  queue: RecomputeTask[];
  nodeStates: Record<string, BackendNodeExecutionState>;
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

