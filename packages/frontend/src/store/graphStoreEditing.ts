import type {
  Connection,
  DrawingPath,
  Graph,
  GraphDrawing,
  GraphNode,
  Position,
} from '../types';
import {
  DEFAULT_GRAPH_PROJECTION_ID,
  withNodeCardSizeInProjection,
  withNodePositionInProjection,
} from '../utils/projections';

interface GraphStoreEditingState {
  graph: Graph | null;
  selectedDrawingId: string | null;
  updateGraph: (graph: Partial<Graph>) => Promise<void>;
}

type GraphStoreEditingSetState = (partial: Pick<GraphStoreEditingState, 'selectedDrawingId'>) => void;

interface CreateGraphEditingControllerParams {
  getState: () => GraphStoreEditingState;
  setState: GraphStoreEditingSetState;
}

export function createGraphEditingController({
  getState,
  setState,
}: CreateGraphEditingControllerParams) {
  const persistGraphEdit = (buildNextGraph: (graph: Graph) => Graph | null): void => {
    const { graph, updateGraph } = getState();
    if (!graph) {
      return;
    }

    const nextGraph = buildNextGraph(graph);
    if (!nextGraph) {
      return;
    }

    void updateGraph(nextGraph);
  };

  const withUpdatedAt = <T extends Graph>(graph: T): T => ({
    ...graph,
    updatedAt: Date.now(),
  });

  return {
    addNode(node: GraphNode): void {
      persistGraphEdit((graph) =>
        withUpdatedAt({
          ...graph,
          nodes: [...graph.nodes, node],
        })
      );
    },

    updateNode(nodeId: string, updates: Partial<GraphNode>): void {
      persistGraphEdit((graph) =>
        withUpdatedAt({
          ...graph,
          nodes: graph.nodes.map((node) =>
            node.id === nodeId ? { ...node, ...updates, version: Date.now().toString() } : node
          ),
        })
      );
    },

    updateNodePosition(nodeId: string, position: Position): void {
      persistGraphEdit((graph) => {
        const activeProjectionId = graph.activeProjectionId ?? DEFAULT_GRAPH_PROJECTION_ID;
        return withUpdatedAt({
          ...graph,
          nodes: graph.nodes.map((node) =>
            node.id === nodeId ? { ...node, position } : node
          ),
          projections: (graph.projections ?? []).map((projection) =>
            projection.id === activeProjectionId
              ? withNodePositionInProjection(projection, nodeId, position)
              : projection
          ),
        });
      });
    },

    updateNodeCardSize(nodeId: string, width: number, height: number): void {
      persistGraphEdit((graph) => {
        const activeProjectionId = graph.activeProjectionId ?? DEFAULT_GRAPH_PROJECTION_ID;
        return withUpdatedAt({
          ...graph,
          nodes: graph.nodes.map((node) => {
            if (node.id !== nodeId) {
              return node;
            }

            return {
              ...node,
              config: {
                ...node.config,
                config: {
                  ...(node.config.config ?? {}),
                  cardWidth: width,
                  cardHeight: height,
                },
              },
            };
          }),
          projections: (graph.projections ?? []).map((projection) =>
            projection.id === activeProjectionId
              ? withNodeCardSizeInProjection(projection, nodeId, { width, height })
              : projection
          ),
        });
      });
    },

    deleteNode(nodeId: string): void {
      persistGraphEdit((graph) =>
        withUpdatedAt({
          ...graph,
          nodes: graph.nodes.filter((node) => node.id !== nodeId),
          connections: graph.connections.filter(
            (connection) => connection.sourceNodeId !== nodeId && connection.targetNodeId !== nodeId
          ),
        })
      );
    },

    addConnection(connection: Connection): void {
      persistGraphEdit((graph) =>
        withUpdatedAt({
          ...graph,
          connections: [...graph.connections, connection],
        })
      );
    },

    deleteConnection(connectionId: string): void {
      persistGraphEdit((graph) =>
        withUpdatedAt({
          ...graph,
          connections: graph.connections.filter((connection) => connection.id !== connectionId),
        })
      );
    },

    deleteConnections(connectionIds: string[]): void {
      persistGraphEdit((graph) => {
        const connectionIdSet = new Set(connectionIds);
        const validConnections = graph.connections.filter((connection) => connectionIdSet.has(connection.id));

        if (validConnections.length === 0) {
          console.warn('No valid connections found to delete:', connectionIds);
          return null;
        }

        if (validConnections.length !== connectionIds.length) {
          console.warn(
            `Some connection IDs were not found. Requested: ${connectionIds.length}, Found: ${validConnections.length}`
          );
        }

        return withUpdatedAt({
          ...graph,
          connections: graph.connections.filter((connection) => !connectionIdSet.has(connection.id)),
        });
      });
    },

    addDrawing(drawing: GraphDrawing): void {
      persistGraphEdit((graph) =>
        withUpdatedAt({
          ...graph,
          drawings: [...(graph.drawings ?? []), drawing],
        })
      );
    },

    updateDrawing(drawingId: string, updates: Partial<GraphDrawing>): void {
      persistGraphEdit((graph) =>
        withUpdatedAt({
          ...graph,
          drawings: (graph.drawings ?? []).map((drawing) =>
            drawing.id === drawingId
              ? {
                  ...drawing,
                  ...updates,
                }
              : drawing
          ),
        })
      );
    },

    updateDrawingPosition(drawingId: string, position: Position): void {
      persistGraphEdit((graph) =>
        withUpdatedAt({
          ...graph,
          drawings: (graph.drawings ?? []).map((drawing) =>
            drawing.id === drawingId
              ? {
                  ...drawing,
                  position,
                }
              : drawing
          ),
        })
      );
    },

    deleteDrawing(drawingId: string): void {
      const { selectedDrawingId } = getState();
      if (selectedDrawingId === drawingId) {
        setState({ selectedDrawingId: null });
      }

      persistGraphEdit((graph) =>
        withUpdatedAt({
          ...graph,
          drawings: (graph.drawings ?? []).filter((drawing) => drawing.id !== drawingId),
        })
      );
    },

    addDrawingPath(drawingId: string, path: DrawingPath): void {
      persistGraphEdit((graph) =>
        withUpdatedAt({
          ...graph,
          drawings: (graph.drawings ?? []).map((drawing) =>
            drawing.id === drawingId
              ? {
                  ...drawing,
                  paths: [...drawing.paths, path],
                }
              : drawing
          ),
        })
      );
    },
  };
}
