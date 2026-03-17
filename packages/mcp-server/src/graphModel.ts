import {
  normalizeCanvasBackground as normalizeSharedCanvasBackground,
} from '../../shared/src/canvasBackground.js';
import {
  normalizeGraphConnectionStroke,
} from '../../shared/src/connectionStroke.js';
import {
  materializeGraphProjectionState,
  normalizeDrawingColor,
  type CanvasBackground,
  type Connection,
  type ConnectionAnchor,
  type ConnectionAnchorSide,
  type DataSchema,
  type DrawingPath,
  type DrawingPoint,
  type Graph,
  type GraphConnectionStroke,
  type GraphDrawing,
  type GraphNode,
  type GraphProjection,
  type PortDefinition,
  type PythonEnvironment,
  type RuntimeId,
} from '../../domain/dist/index.js';

export {
  applyProjectionToNodes,
  cloneProjectionNodeCardSizes,
  cloneProjectionNodePositions,
  DEFAULT_GRAPH_PROJECTION_ID,
  DEFAULT_GRAPH_PROJECTION_NAME,
  materializeGraphProjectionState,
  NodeType,
  normalizeDrawingColor,
} from '../../domain/dist/index.js';

export type GraphConnectionStrokeSettings = GraphConnectionStroke;
export type {
  CanvasBackground,
  Connection,
  ConnectionAnchor,
  ConnectionAnchorSide,
  DataSchema,
  DrawingPath,
  DrawingPoint,
  Graph,
  GraphDrawing,
  GraphNode,
  GraphProjection,
  PortDefinition,
  PythonEnvironment,
  RuntimeId,
} from '../../domain/dist/index.js';

export interface RenderRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RenderBitmap {
  width: number;
  height: number;
}

export function normalizeCanvasBackground(background: CanvasBackground | undefined): CanvasBackground {
  return normalizeSharedCanvasBackground(background);
}

export function normalizeGraph(graph: Graph): Graph {
  const drawings = Array.isArray(graph.drawings) ? graph.drawings : [];
  const projectionState = materializeGraphProjectionState(
    graph.nodes,
    graph.projections,
    graph.activeProjectionId,
    graph.canvasBackground
  );

  return {
    ...graph,
    revision:
      typeof graph.revision === 'number' && Number.isFinite(graph.revision)
        ? Math.max(0, Math.trunc(graph.revision))
        : 0,
    nodes: projectionState.nodes,
    canvasBackground: projectionState.canvasBackground,
    connectionStroke: normalizeGraphConnectionStroke(graph.connectionStroke),
    projections: projectionState.projections,
    activeProjectionId: projectionState.activeProjectionId,
    cameras: Array.isArray(graph.cameras) ? graph.cameras : [],
    drawings: drawings.map((drawing) => ({
      ...drawing,
      paths: (drawing.paths ?? []).map((path) => ({
        ...path,
        color: normalizeDrawingColor(path.color, '#ffffff'),
      })),
    })),
    pythonEnvs: Array.isArray(graph.pythonEnvs) ? graph.pythonEnvs : [],
  };
}
