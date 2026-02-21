export interface NodeExecutionStateLike {
  hasError?: boolean;
}

export interface CanvasAnimationLoopState {
  hasActiveInteraction: boolean;
  hasErroredNodes: boolean;
  lightningPulseCount: number;
  nodeShockCount: number;
  smokePuffCount: number;
}

export function hasErroredNodeExecutionState(
  nodeExecutionStates: Record<string, NodeExecutionStateLike | undefined>
): boolean {
  for (const state of Object.values(nodeExecutionStates)) {
    if (state?.hasError) {
      return true;
    }
  }
  return false;
}

export function shouldKeepCanvasAnimationLoopRunning(state: CanvasAnimationLoopState): boolean {
  if (state.hasActiveInteraction) {
    return true;
  }

  if (state.hasErroredNodes) {
    return true;
  }

  if (state.lightningPulseCount > 0) {
    return true;
  }

  if (state.nodeShockCount > 0) {
    return true;
  }

  if (state.smokePuffCount > 0) {
    return true;
  }

  return false;
}
