import type {
  Connection,
  DrawingPath,
  Graph,
  GraphCommand,
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
  submitGraphCommands: (commands: GraphCommand[]) => Promise<void>;
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
  const persistGraphEdit = (buildCommands: (graph: Graph) => GraphCommand[] | null): void => {
    const { graph, submitGraphCommands } = getState();
    if (!graph) {
      return;
    }

    const commands = buildCommands(graph);
    if (!commands || commands.length === 0) {
      return;
    }

    void submitGraphCommands(commands);
  };

  return {
    addNode(node: GraphNode): void {
      persistGraphEdit((graph) =>
        [{
          kind: 'replace_nodes',
          nodes: [...graph.nodes, node],
        }]
      );
    },

    updateNode(nodeId: string, updates: Partial<GraphNode>): void {
      persistGraphEdit((graph) =>
        [{
          kind: 'replace_nodes',
          nodes: graph.nodes.map((node) =>
            node.id === nodeId ? { ...node, ...updates, version: Date.now().toString() } : node
          ),
        }]
      );
    },

    updateNodePosition(nodeId: string, position: Position): void {
      persistGraphEdit((graph) => [{
        kind: 'replace_nodes',
        nodes: graph.nodes.map((node) =>
          node.id === nodeId ? { ...node, position } : node
        ),
      }]);
    },

    updateNodeCardSize(nodeId: string, width: number, height: number): void {
      persistGraphEdit((graph) => [{
        kind: 'replace_nodes',
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
      }]);
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
        [
          {
            kind: 'replace_nodes',
            nodes: graph.nodes.filter((node) => node.id !== nodeId),
          },
          {
            kind: 'replace_connections',
            connections: graph.connections.filter(
              (connection) => connection.sourceNodeId !== nodeId && connection.targetNodeId !== nodeId
            ),
          },
        ]
      );
    },

    addConnection(connection: Connection): void {
      persistGraphEdit((graph) => {
        const result = applyConnectionSet(graph.nodes, graph.connections, connection);
        if (!result.changed) {
          return null;
        }

        return [{
          kind: 'replace_connections',
          connections: result.connections,
        }];
      });
    },

    deleteConnection(connectionId: string): void {
      persistGraphEdit((graph) =>
        [{
          kind: 'replace_connections',
          connections: graph.connections.filter((connection) => connection.id !== connectionId),
        }]
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

        return [{
          kind: 'replace_connections',
          connections: graph.connections.filter((connection) => !connectionIdSet.has(connection.id)),
        }];
      });
    },

    addDrawing(drawing: GraphDrawing): void {
      persistGraphEdit((graph) =>
        [{
          kind: 'replace_drawings',
          drawings: [...(graph.drawings ?? []), drawing],
        }]
      );
    },

    updateDrawing(drawingId: string, updates: Partial<GraphDrawing>): void {
      persistGraphEdit((graph) =>
        [{
          kind: 'replace_drawings',
          drawings: (graph.drawings ?? []).map((drawing) =>
            drawing.id === drawingId
              ? {
                  ...drawing,
                  ...updates,
                }
              : drawing
          ),
        }]
      );
    },

    updateDrawingPosition(drawingId: string, position: Position): void {
      persistGraphEdit((graph) =>
        [{
          kind: 'replace_drawings',
          drawings: (graph.drawings ?? []).map((drawing) =>
            drawing.id === drawingId
              ? {
                  ...drawing,
                  position,
                }
              : drawing
          ),
        }]
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

      persistGraphEdit((graph) => [{
        kind: 'replace_drawings',
        drawings: (graph.drawings ?? []).filter((drawing) => drawing.id !== drawingId),
      }]);
    },

    addDrawingPath(drawingId: string, path: DrawingPath): void {
      persistGraphEdit((graph) =>
        [{
          kind: 'replace_drawings',
          drawings: (graph.drawings ?? []).map((drawing) =>
            drawing.id === drawingId
              ? {
                  ...drawing,
                  paths: [...drawing.paths, path],
                }
              : drawing
          ),
        }]
      );
    },
  };
}
