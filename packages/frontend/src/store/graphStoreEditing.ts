import type {
  Connection,
  DrawingPath,
  Graph,
  GraphDrawing,
  GraphNode,
  Position,
} from '../types';
import { applyConnectionSet } from '../utils/connectionSlots';

interface GraphStoreEditingState {
  graph: Graph | null;
  selectedNodeId: string | null;
  selectedNodeIds: string[];
  selectedDrawingId: string | null;
  updateGraph: (graph: Partial<Graph>) => Promise<void>;
}

type GraphStoreEditingSetState = (
  partial: Pick<GraphStoreEditingState, 'selectedNodeId' | 'selectedNodeIds' | 'selectedDrawingId'>
) => void;

interface CreateGraphEditingControllerParams {
  getState: () => GraphStoreEditingState;
  setState: GraphStoreEditingSetState;
}

export function createGraphEditingController({
  getState,
  setState,
}: CreateGraphEditingControllerParams) {
  const persistGraphEdit = (buildUpdates: (graph: Graph) => Partial<Graph> | null): void => {
    const { graph, updateGraph } = getState();
    if (!graph) {
      return;
    }

    const updates = buildUpdates(graph);
    if (!updates) {
      return;
    }

    void updateGraph(updates);
  };

  return {
    addNode(node: GraphNode): void {
      persistGraphEdit((graph) =>
        ({
          nodes: [...graph.nodes, node],
        })
      );
    },

    updateNode(nodeId: string, updates: Partial<GraphNode>): void {
      persistGraphEdit((graph) =>
        ({
          nodes: graph.nodes.map((node) =>
            node.id === nodeId ? { ...node, ...updates, version: Date.now().toString() } : node
          ),
        })
      );
    },

    updateNodePosition(nodeId: string, position: Position): void {
      persistGraphEdit((graph) => ({
        nodes: graph.nodes.map((node) =>
          node.id === nodeId ? { ...node, position } : node
        ),
      }));
    },

    updateNodeCardSize(nodeId: string, width: number, height: number): void {
      persistGraphEdit((graph) => ({
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
      }));
    },

    deleteNode(nodeId: string): void {
      const { selectedNodeId, selectedNodeIds } = getState();
      if (selectedNodeIds.includes(nodeId)) {
        const remainingSelectedNodeIds = selectedNodeIds.filter((candidateNodeId) => candidateNodeId !== nodeId);
        setState({
          selectedNodeId: remainingSelectedNodeIds.length === 1 ? remainingSelectedNodeIds[0] : null,
          selectedNodeIds: remainingSelectedNodeIds,
          selectedDrawingId: selectedNodeId === nodeId ? null : getState().selectedDrawingId,
        });
      }

      persistGraphEdit((graph) =>
        ({
          nodes: graph.nodes.filter((node) => node.id !== nodeId),
          connections: graph.connections.filter(
            (connection) => connection.sourceNodeId !== nodeId && connection.targetNodeId !== nodeId
          ),
        })
      );
    },

    addConnection(connection: Connection): void {
      persistGraphEdit((graph) => {
        const result = applyConnectionSet(graph.nodes, graph.connections, connection);
        if (!result.changed) {
          return null;
        }

        return {
          connections: result.connections,
        };
      });
    },

    deleteConnection(connectionId: string): void {
      persistGraphEdit((graph) =>
        ({
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

        return {
          connections: graph.connections.filter((connection) => !connectionIdSet.has(connection.id)),
        };
      });
    },

    addDrawing(drawing: GraphDrawing): void {
      persistGraphEdit((graph) =>
        ({
          drawings: [...(graph.drawings ?? []), drawing],
        })
      );
    },

    updateDrawing(drawingId: string, updates: Partial<GraphDrawing>): void {
      persistGraphEdit((graph) =>
        ({
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
        ({
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
        setState({
          selectedNodeId: getState().selectedNodeId,
          selectedNodeIds: getState().selectedNodeIds,
          selectedDrawingId: null,
        });
      }

      persistGraphEdit((graph) => ({
        drawings: (graph.drawings ?? []).filter((drawing) => drawing.id !== drawingId),
      }));
    },

    addDrawingPath(drawingId: string, path: DrawingPath): void {
      persistGraphEdit((graph) =>
        ({
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
