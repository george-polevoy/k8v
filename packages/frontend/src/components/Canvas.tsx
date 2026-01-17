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

const nodeTypes = {
  custom: CustomNode,
};

function Canvas() {
  const { graph, addConnection } = useGraphStore();

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

      const connection: GraphConnection = {
        id: `${params.source}-${params.sourceHandle}-${params.target}-${params.targetHandle}`,
        sourceNodeId: params.source,
        sourcePort: params.sourceHandle,
        targetNodeId: params.target,
        targetPort: params.targetHandle,
      };

      addConnection(connection);
    },
    [addConnection]
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

  if (!graph) {
    return <div>Loading...</div>;
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
