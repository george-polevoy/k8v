import { normalizeHexColor } from '../utils/color';
import { DEFAULT_DRAWING_COLOR } from '../types';
import type {
  NodeGraphicsComputationDebug,
  PencilColor,
  PencilThickness,
} from './graphStoreTypes';

interface GraphStoreUiState {
  selectedCameraId: string | null;
  selectedNodeId: string | null;
  selectedNodeIds: string[];
  selectedDrawingId: string | null;
  selectedNodeGraphicsDebug: NodeGraphicsComputationDebug | null;
  drawingCreateRequestId: number;
  drawingEnabled: boolean;
  drawingColor: PencilColor;
  drawingThickness: PencilThickness;
}

type GraphStoreUiSetState = (
  partial:
    | Partial<GraphStoreUiState>
    | ((state: GraphStoreUiState) => Partial<GraphStoreUiState>)
) => void;

interface CreateGraphStoreUiControllerParams {
  getState: () => GraphStoreUiState;
  setState: GraphStoreUiSetState;
}

function resolveNodeSelectionState(nodeIds: string[]) {
  const normalizedNodeIds = Array.from(new Set(nodeIds));
  return {
    selectedNodeId: normalizedNodeIds.length === 1 ? normalizedNodeIds[0] : null,
    selectedNodeIds: normalizedNodeIds,
    selectedDrawingId: null,
    selectedNodeGraphicsDebug: null,
  };
}

export function createGraphStoreUiController({
  getState,
  setState,
}: CreateGraphStoreUiControllerParams) {
  return {
    selectCamera(cameraId: string | null): void {
      const normalizedCameraId = cameraId && cameraId.trim() ? cameraId : null;
      const state = getState();
      if (state.selectedCameraId === normalizedCameraId) {
        return;
      }

      setState({ selectedCameraId: normalizedCameraId });
    },

    selectNode(nodeId: string | null): void {
      const nextNodeIds = nodeId ? [nodeId] : [];
      const state = getState();
      if (
        state.selectedDrawingId === null &&
        state.selectedNodeId === nodeId &&
        state.selectedNodeIds.length === nextNodeIds.length &&
        state.selectedNodeIds.every((selectedNodeId) => nextNodeIds.includes(selectedNodeId))
      ) {
        return;
      }

      setState(resolveNodeSelectionState(nextNodeIds));
    },

    setNodeSelection(nodeIds: string[]): void {
      const normalizedNodeIds = Array.from(new Set(nodeIds));
      const state = getState();
      if (
        state.selectedDrawingId === null &&
        state.selectedNodeIds.length === normalizedNodeIds.length &&
        state.selectedNodeIds.every((nodeId) => normalizedNodeIds.includes(nodeId))
      ) {
        return;
      }

      setState(resolveNodeSelectionState(normalizedNodeIds));
    },

    toggleNodeSelection(nodeId: string): void {
      const state = getState();
      const isSelected = state.selectedNodeIds.includes(nodeId);
      const nextNodeIds = isSelected
        ? state.selectedNodeIds.filter((candidateNodeId) => candidateNodeId !== nodeId)
        : [...state.selectedNodeIds, nodeId];
      setState(resolveNodeSelectionState(nextNodeIds));
    },

    selectDrawing(drawingId: string | null): void {
      const state = getState();
      if (
        state.selectedDrawingId === drawingId &&
        state.selectedNodeId === null &&
        state.selectedNodeIds.length === 0
      ) {
        return;
      }

      setState({
        selectedDrawingId: drawingId,
        selectedNodeId: null,
        selectedNodeIds: [],
        selectedNodeGraphicsDebug: null,
      });
    },

    setSelectedNodeGraphicsDebug(debug: NodeGraphicsComputationDebug | null): void {
      setState({ selectedNodeGraphicsDebug: debug });
    },

    requestCreateDrawing(): void {
      setState((state) => ({
        drawingCreateRequestId: state.drawingCreateRequestId + 1,
      }));
    },

    setDrawingEnabled(enabled: boolean): void {
      setState({ drawingEnabled: enabled });
    },

    setDrawingColor(color: PencilColor): void {
      setState({ drawingColor: normalizeHexColor(color, DEFAULT_DRAWING_COLOR) });
    },

    setDrawingThickness(thickness: PencilThickness): void {
      setState({ drawingThickness: thickness });
    },
  };
}
