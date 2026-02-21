import { useCallback, useState, useEffect } from 'react';
import ReactFlow, {
  Node,
  Edge,
  Background,
  Controls,
  MiniMap,
  Connection,
  useNodesState,
  useEdgesState,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { useGraphStore } from '../store/graphStore';
import { Connection as GraphConnection } from '../types';
import CustomNode from './CustomNode';
import InputNameDialog from './InputNameDialog';
import { v4 as uuidv4 } from 'uuid';

const nodeTypes = {
  custom: CustomNode,
};

function Canvas() {
  const graph = useGraphStore((state) => state.graph);
  const addConnection = useGraphStore((state) => state.addConnection);
  const updateNodePosition = useGraphStore((state) => state.updateNodePosition);
  const isLoading = useGraphStore((state) => state.isLoading);
  const error = useGraphStore((state) => state.error);

  // Convert graph nodes to ReactFlow nodes
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  // State for input name dialog
  const [pendingConnection, setPendingConnection] = useState<Connection | null>(null);
  const [showInputDialog, setShowInputDialog] = useState(false);

  // Sync with graph store
  useEffect(() => {
    if (!graph) return;

    setNodes((currentNodes) => {
      const currentById = new Map(currentNodes.map((node) => [node.id, node]));

      const nextNodes: Node[] = graph.nodes.map((node) => {
        const currentNode = currentById.get(node.id);
        const currentDataNode = currentNode?.data?.node;
        const canReuseDataNode =
          currentDataNode &&
          currentDataNode.id === node.id &&
          currentDataNode.version === node.version;

        return {
          id: node.id,
          type: 'custom',
          position: node.position,
          data: canReuseDataNode ? currentNode.data : { node },
          selected: currentNode?.selected,
          dragging: currentNode?.dragging,
        };
      });

      const unchanged =
        currentNodes.length === nextNodes.length &&
        currentNodes.every((node, index) => {
          const nextNode = nextNodes[index];
          if (!nextNode) return false;
          return (
            node.id === nextNode.id &&
            node.position.x === nextNode.position.x &&
            node.position.y === nextNode.position.y &&
            node.selected === nextNode.selected &&
            node.dragging === nextNode.dragging &&
            node.data === nextNode.data
          );
        });

      return unchanged ? currentNodes : nextNodes;
    });

    setEdges((currentEdges) => {
      const currentById = new Map(currentEdges.map((edge) => [edge.id, edge]));

      const nextEdges: Edge[] = graph.connections.map((conn) => {
        const currentEdge = currentById.get(conn.id);
        return {
          id: conn.id,
          source: conn.sourceNodeId,
          target: conn.targetNodeId,
          sourceHandle: conn.sourcePort,
          targetHandle: conn.targetPort,
          selected: currentEdge?.selected,
        };
      });

      const unchanged =
        currentEdges.length === nextEdges.length &&
        currentEdges.every((edge, index) => {
          const nextEdge = nextEdges[index];
          if (!nextEdge) return false;
          return (
            edge.id === nextEdge.id &&
            edge.source === nextEdge.source &&
            edge.target === nextEdge.target &&
            edge.sourceHandle === nextEdge.sourceHandle &&
            edge.targetHandle === nextEdge.targetHandle &&
            edge.selected === nextEdge.selected
          );
        });

      return unchanged ? currentEdges : nextEdges;
    });
  }, [graph, setNodes, setEdges]);

  const handleInputNameSubmit = useCallback(
    (inputName: string) => {
      if (!pendingConnection || !graph) return;

      const params = pendingConnection;
      const targetNode = graph.nodes.find(n => n.id === params.target);
      if (!targetNode) return;

      // Create connection with the new input name
      const connection: GraphConnection = {
        id: uuidv4(),
        sourceNodeId: params.source!,
        sourcePort: params.sourceHandle!,
        targetNodeId: params.target!,
        targetPort: inputName,
      };

      // Update both node metadata and connections in a single operation
      const newInput = {
        name: inputName,
        schema: { type: 'object' as const },
        description: 'Dynamically added input',
      };

      const updatedNodes = graph.nodes.map((node) =>
        node.id === params.target
          ? {
              ...node,
              metadata: {
                ...node.metadata,
                inputs: [
                  ...node.metadata.inputs,
                  newInput,
                ],
              },
              version: Date.now().toString(),
            }
          : node
      );

      const updatedGraph = {
        ...graph,
        nodes: updatedNodes,
        connections: [...graph.connections, connection],
        updatedAt: Date.now(),
      };

      useGraphStore.getState().updateGraph(updatedGraph as any);

      // Close dialog and clear pending connection
      setShowInputDialog(false);
      setPendingConnection(null);
    },
    [pendingConnection, graph]
  );

  const handleInputNameCancel = useCallback(() => {
    setShowInputDialog(false);
    setPendingConnection(null);
  }, []);

  const onConnect = useCallback(
    (params: Connection) => {
      if (!params.source || !params.target || !params.sourceHandle || !params.targetHandle) {
        return;
      }

      // Handle dynamic input creation for inline code nodes
      if (params.targetHandle === '__add_input__') {
        // Store the pending connection and show dialog
        setPendingConnection(params);
        setShowInputDialog(true);
        return;
      }

      // Check if connection already exists
      const existingConnections = graph?.connections || [];
      const alreadyExists = existingConnections.some(
        (conn) =>
          conn.sourceNodeId === params.source &&
          conn.sourcePort === params.sourceHandle &&
          conn.targetNodeId === params.target &&
          conn.targetPort === params.targetHandle
      );

      if (alreadyExists) {
        console.warn('Connection already exists, skipping');
        return;
      }

      const connection: GraphConnection = {
        id: uuidv4(), // Use UUID for unique IDs
        sourceNodeId: params.source,
        sourcePort: params.sourceHandle,
        targetNodeId: params.target,
        targetPort: params.targetHandle,
      };

      addConnection(connection);
    },
    [addConnection, graph]
  );

  const onNodesChangeLocal = useCallback(
    (changes: any) => {
      onNodesChange(changes);

      const selectedChange = [...changes]
        .reverse()
        .find((change: any) => change.type === 'select');

      if (selectedChange) {
        useGraphStore.getState().selectNode(selectedChange.selected ? selectedChange.id : null);
      }

      changes.forEach((change: any) => {
        if (change.type === 'remove') {
          // Handle node deletion
          useGraphStore.getState().deleteNode(change.id);
          // Clear selection if deleted node was selected
          const currentSelected = useGraphStore.getState().selectedNodeId;
          if (currentSelected === change.id) {
            useGraphStore.getState().selectNode(null);
          }
        }
      });
    },
    [onNodesChange]
  );

  // Handle node deletion (backup handler)
  const onNodesDelete = useCallback(
    (deleted: Node[]) => {
      if (graph) {
        deleted.forEach((node) => {
          useGraphStore.getState().deleteNode(node.id);
          // Clear selection if deleted node was selected
          const currentSelected = useGraphStore.getState().selectedNodeId;
          if (currentSelected === node.id) {
            useGraphStore.getState().selectNode(null);
          }
        });
      }
    },
    [graph]
  );

  // Handle edge changes (including deletion)
  const onEdgesChangeLocal = useCallback(
    (changes: any) => {
      onEdgesChange(changes);
      if (graph) {
        changes.forEach((change: any) => {
          if (change.type === 'remove') {
            // Handle edge deletion
            useGraphStore.getState().deleteConnection(change.id);
          }
        });
      }
    },
    [onEdgesChange, graph]
  );

  if (isLoading && !graph) {
    return (
      <div style={{ 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center', 
        height: '100%',
        flexDirection: 'column',
        gap: '16px'
      }}>
        <div>Loading...</div>
        {error && <div style={{ color: 'red', fontSize: '12px' }}>Error: {error}</div>}
      </div>
    );
  }

  if (!graph) {
    return (
      <div style={{ 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center', 
        height: '100%',
        flexDirection: 'column',
        gap: '16px'
      }}>
        <div>No graph loaded</div>
        {error && <div style={{ color: 'red', fontSize: '12px' }}>Error: {error}</div>}
        <button
          onClick={() => {
            useGraphStore.getState().createGraph('Untitled Graph');
          }}
          style={{
            padding: '8px 16px',
            background: '#2196F3',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
          }}
        >
          Create New Graph
        </button>
      </div>
    );
  }

  return (
    <div style={{ width: '100%', height: '100%' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChangeLocal}
        onNodesDelete={onNodesDelete}
        onEdgesChange={onEdgesChangeLocal}
        onConnect={onConnect}
        onNodeDragStop={(_event, node) => {
          updateNodePosition(node.id, node.position);
        }}
        onPaneClick={() => {
          useGraphStore.getState().selectNode(null);
        }}
        nodeTypes={nodeTypes}
        fitView
        deleteKeyCode={['Backspace', 'Delete']}
      >
        <Background />
        <Controls />
        <MiniMap />
      </ReactFlow>

      {/* Input name dialog */}
      {showInputDialog && pendingConnection && graph && (
        <InputNameDialog
          onSubmit={handleInputNameSubmit}
          onCancel={handleInputNameCancel}
          existingNames={
            graph.nodes
              .find(n => n.id === pendingConnection.target)
              ?.metadata.inputs.map(i => i.name) || []
          }
        />
      )}
    </div>
  );
}

export default Canvas;
