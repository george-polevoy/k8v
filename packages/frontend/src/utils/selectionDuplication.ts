import type {
  Connection,
  ConnectionAnchor,
  DataSchema,
  Graph,
  GraphNode,
  NodeConfig,
  NodeMetadata,
  PortDefinition,
  Position,
  ProjectionNodeCardSize,
} from '../types';
import { DEFAULT_GRAPH_PROJECTION_ID } from '../types';

interface DuplicateNodeSelectionInGraphParams {
  graph: Graph;
  selectedNodeIds: string[];
  duplicatedNodePositions?: ReadonlyMap<string, Position>;
  createId?: () => string;
  now?: () => number;
}

interface DuplicateNodeSelectionInGraphResult {
  graph: Graph;
  duplicatedNodeIds: string[];
  sourceToDuplicateNodeId: Map<string, string>;
}

function clonePosition(position: Position): Position {
  return {
    x: position.x,
    y: position.y,
  };
}

function cloneConnectionAnchor(anchor?: ConnectionAnchor): ConnectionAnchor | undefined {
  if (!anchor) {
    return undefined;
  }

  return {
    side: anchor.side,
    offset: anchor.offset,
  };
}

function cloneDataSchema(schema: DataSchema): DataSchema {
  return {
    type: schema.type,
    properties: schema.properties
      ? Object.fromEntries(
          Object.entries(schema.properties).map(([key, value]) => [key, cloneDataSchema(value)])
        )
      : undefined,
    items: schema.items ? cloneDataSchema(schema.items) : undefined,
    required: schema.required ? [...schema.required] : undefined,
  };
}

function clonePortDefinition(port: PortDefinition): PortDefinition {
  return {
    name: port.name,
    schema: cloneDataSchema(port.schema),
    description: port.description,
  };
}

function cloneNodeMetadata(metadata: NodeMetadata): NodeMetadata {
  return {
    name: metadata.name,
    description: metadata.description,
    inputs: metadata.inputs.map(clonePortDefinition),
    outputs: metadata.outputs.map(clonePortDefinition),
    category: metadata.category,
    version: metadata.version,
  };
}

function cloneUnknownValue<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => cloneUnknownValue(item)) as T;
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, cloneUnknownValue(item)])
    ) as T;
  }

  return value;
}

function cloneNodeConfig(config: NodeConfig): NodeConfig {
  return {
    type: config.type,
    code: config.code,
    subgraphId: config.subgraphId,
    runtime: config.runtime,
    pythonEnv: config.pythonEnv,
    config: cloneUnknownValue(config.config),
  };
}

function cloneProjectionNodeCardSize(size: ProjectionNodeCardSize): ProjectionNodeCardSize {
  return {
    width: size.width,
    height: size.height,
  };
}

function cloneNode(
  node: GraphNode,
  duplicateNodeId: string,
  duplicatePosition: Position,
  versionSeed: number,
  index: number
): GraphNode {
  return {
    ...node,
    id: duplicateNodeId,
    position: clonePosition(duplicatePosition),
    metadata: cloneNodeMetadata(node.metadata),
    config: cloneNodeConfig(node.config),
    version: `${versionSeed}-${index}`,
    lastComputed: undefined,
  };
}

export function duplicateNodeSelectionInGraph({
  graph,
  selectedNodeIds,
  duplicatedNodePositions,
  createId = () => crypto.randomUUID(),
  now = () => Date.now(),
}: DuplicateNodeSelectionInGraphParams): DuplicateNodeSelectionInGraphResult {
  const versionSeed = now();
  const uniqueSelectedNodeIds = Array.from(new Set(selectedNodeIds));
  const selectedNodeIdSet = new Set(uniqueSelectedNodeIds);
  const selectedNodes = graph.nodes.filter((node) => selectedNodeIdSet.has(node.id));
  const sourceToDuplicateNodeId = new Map<string, string>();
  const duplicatedNodes: GraphNode[] = [];

  for (const [index, node] of selectedNodes.entries()) {
    const duplicateNodeId = createId();
    sourceToDuplicateNodeId.set(node.id, duplicateNodeId);
    duplicatedNodes.push(
      cloneNode(
        node,
        duplicateNodeId,
        duplicatedNodePositions?.get(node.id) ?? node.position,
        versionSeed,
        index
      )
    );
  }

  const duplicatedConnections: Connection[] = graph.connections.flatMap((connection) => {
    const duplicateSourceNodeId = sourceToDuplicateNodeId.get(connection.sourceNodeId);
    const duplicateTargetNodeId = sourceToDuplicateNodeId.get(connection.targetNodeId);
    if (!duplicateSourceNodeId || !duplicateTargetNodeId) {
      return [];
    }

    return [{
      id: createId(),
      sourceNodeId: duplicateSourceNodeId,
      sourcePort: connection.sourcePort,
      sourceAnchor: cloneConnectionAnchor(connection.sourceAnchor),
      targetNodeId: duplicateTargetNodeId,
      targetPort: connection.targetPort,
      targetAnchor: cloneConnectionAnchor(connection.targetAnchor),
    }];
  });

  const activeProjectionId = graph.activeProjectionId ?? DEFAULT_GRAPH_PROJECTION_ID;
  const nextProjections = (graph.projections ?? []).map((projection) => {
    const nextNodePositions = { ...projection.nodePositions };
    const nextNodeCardSizes = { ...projection.nodeCardSizes };

    for (const node of selectedNodes) {
      const duplicateNodeId = sourceToDuplicateNodeId.get(node.id);
      if (!duplicateNodeId) {
        continue;
      }

      const projectedPosition = projection.nodePositions[node.id];
      if (projectedPosition) {
        nextNodePositions[duplicateNodeId] = projection.id === activeProjectionId &&
          duplicatedNodePositions?.has(node.id)
          ? clonePosition(duplicatedNodePositions.get(node.id) as Position)
          : clonePosition(projectedPosition);
      } else if (projection.id === activeProjectionId && duplicatedNodePositions?.has(node.id)) {
        nextNodePositions[duplicateNodeId] = clonePosition(duplicatedNodePositions.get(node.id) as Position);
      }

      const projectedCardSize = projection.nodeCardSizes[node.id];
      if (projectedCardSize) {
        nextNodeCardSizes[duplicateNodeId] = cloneProjectionNodeCardSize(projectedCardSize);
      }
    }

    return {
      ...projection,
      nodePositions: nextNodePositions,
      nodeCardSizes: nextNodeCardSizes,
    };
  });

  return {
    graph: {
      ...graph,
      nodes: [...graph.nodes, ...duplicatedNodes],
      connections: [...graph.connections, ...duplicatedConnections],
      projections: nextProjections,
      updatedAt: versionSeed,
    },
    duplicatedNodeIds: duplicatedNodes.map((node) => node.id),
    sourceToDuplicateNodeId,
  };
}
