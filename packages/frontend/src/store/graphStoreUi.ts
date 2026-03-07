import { normalizeHexColor } from '../utils/color';
import { DEFAULT_DRAWING_COLOR } from './graphStoreState';
import type {
  NodeGraphicsComputationDebug,
  PencilColor,
  PencilThickness,
} from './graphStoreTypes';

interface GraphStoreUiState {
  selectedNodeId: string | null;
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

export function createGraphStoreUiController({
  getState,
  setState,
}: CreateGraphStoreUiControllerParams) {
  return {
    selectNode(nodeId: string | null): void {
      if (getState().selectedNodeId === nodeId && getState().selectedDrawingId === null) {
        return;
      }

      setState({
        selectedNodeId: nodeId,
        selectedDrawingId: null,
        selectedNodeGraphicsDebug: null,
      });
    },

    selectDrawing(drawingId: string | null): void {
      if (getState().selectedDrawingId === drawingId && getState().selectedNodeId === null) {
        return;
      }

      setState({
        selectedDrawingId: drawingId,
        selectedNodeId: null,
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
