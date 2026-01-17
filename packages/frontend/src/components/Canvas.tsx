import React, { useCallback } from 'react';
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
import { v4 as uuidv4 } from 'uuid';

const nodeTypes = {
  custom: CustomNode,
};

function Canvas() {
  const { graph, addConnection, isLoading, error } = useGraphStore();

  // Convert graph nodes to ReactFlow nodes
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  // Sync with graph store
  React.useEffect(() => {
    if (!graph) return;

    const reactFlowNodes: Node[] = graph.nodes.map((node) => ({
      id: node.id,
      type: 'custom',
      position: node.position,
      data: { node },
    }));

    const reactFlowEdges: Edge[] = graph.connections.map((conn) => ({
      id: conn.id,
      source: conn.sourceNodeId,
      target: conn.targetNodeId,
      sourceHandle: conn.sourcePort,
      targetHandle: conn.targetPort,
    }));

    setNodes(reactFlowNodes);
    setEdges(reactFlowEdges);
  }, [graph, setNodes, setEdges]);

  const onConnect = useCallback(
    (params: Connection) => {
      if (!params.source || !params.target || !params.sourceHandle || !params.targetHandle) {
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
      // Update positions in graph store
      if (graph) {
        changes.forEach((change: any) => {
          if (change.type === 'position' && change.position) {
            useGraphStore.getState().updateNode(change.id, {
              position: change.position,
            });
          } else if (change.type === 'select' && change.selected) {
            useGraphStore.getState().selectNode(change.id);
          } else if (change.type === 'select' && !change.selected) {
            useGraphStore.getState().selectNode(null);
          } else if (change.type === 'remove') {
            // Handle node deletion
            useGraphStore.getState().deleteNode(change.id);
            // Clear selection if deleted node was selected
            const currentSelected = useGraphStore.getState().selectedNodeId;
            if (currentSelected === change.id) {
              useGraphStore.getState().selectNode(null);
            }
          }
        });
      }
    },
    [onNodesChange, graph]
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

  if (isLoading) {
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
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={(event, node) => {
          useGraphStore.getState().selectNode(node.id);
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
    </div>
  );
}

export default Canvas;
