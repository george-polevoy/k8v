import { useEffect, type MutableRefObject } from 'react';
import type { NodeExecutionState } from '../store/graphStore';

const FALLBACK_NODE_EXECUTION_STATE: NodeExecutionState = {
  isPending: false,
  isComputing: false,
  hasError: false,
  isStale: false,
  errorMessage: null,
  lastRunAt: null,
};

interface UseCanvasExecutionEffectsParams {
  nodeExecutionStates: Record<string, NodeExecutionState>;
  nodeGraphicsOutputs: Record<string, unknown>;
  previousNodeExecutionStatesRef: MutableRefObject<Record<string, NodeExecutionState>>;
  renderGraphRef: MutableRefObject<() => void>;
  enqueueLightningForNodeInputs: (nodeId: string) => void;
  enqueueNodeShock: (nodeId: string) => void;
}

export function useCanvasExecutionEffects({
  nodeExecutionStates,
  nodeGraphicsOutputs,
  previousNodeExecutionStatesRef,
  renderGraphRef,
  enqueueLightningForNodeInputs,
  enqueueNodeShock,
}: UseCanvasExecutionEffectsParams): void {
  useEffect(() => {
    const previous = previousNodeExecutionStatesRef.current;
    const current = nodeExecutionStates;

    for (const [nodeId, state] of Object.entries(current)) {
      const previousState = previous[nodeId] ?? FALLBACK_NODE_EXECUTION_STATE;

      if (!previousState.isComputing && state.isComputing) {
        enqueueLightningForNodeInputs(nodeId);
      }

      if (previousState.isComputing && !state.isComputing && !state.hasError) {
        enqueueNodeShock(nodeId);
      }
    }

    previousNodeExecutionStatesRef.current = current;
    renderGraphRef.current();
  }, [
    enqueueLightningForNodeInputs,
    enqueueNodeShock,
    nodeExecutionStates,
    previousNodeExecutionStatesRef,
    renderGraphRef,
  ]);

  useEffect(() => {
    void nodeGraphicsOutputs;
    renderGraphRef.current();
  }, [nodeGraphicsOutputs, renderGraphRef]);
}
