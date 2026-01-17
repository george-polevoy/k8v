# k8v Architecture

## Overview

k8v is a flow-based modeling software that enables visual programming through an infinite canvas with graph-based data flow. Data flows through nodes in a directional graph, with deterministic computation and persistent storage.

## Core Components

### Backend

#### GraphEngine (`packages/backend/src/core/GraphEngine.ts`)
- Manages graph computation with deterministic recomputation
- Implements topological sorting for correct execution order
- Tracks dependencies and only recomputes when inputs or nodes change
- Handles circular dependency detection

#### DataStore (`packages/backend/src/core/DataStore.ts`)
- Persists computation results in structured format (JSON)
- Stores graph metadata in SQLite
- Manages library node manifests
- Serializes outputs and schemas separately for type inference

#### NodeExecutor (`packages/backend/src/core/NodeExecutor.ts`)
- Executes different node types (inline code, library, subgraph, external I/O)
- Infers data schemas from outputs
- **Note**: Currently uses `eval()` for inline code execution. In production, replace with a proper sandbox like `vm2` or `isolated-vm` for security.

### Frontend

#### Canvas (`packages/frontend/src/components/Canvas.tsx`)
- Infinite canvas using React Flow
- Visual node representation with input/output handles
- Drag-and-drop node positioning
- Connection creation between nodes

#### Graph Store (`packages/frontend/src/store/graphStore.ts`)
- Zustand state management for graph data
- API integration with backend
- Node and connection management

## Data Flow

1. **Node Creation**: User creates nodes on canvas with defined inputs/outputs
2. **Connection**: User connects node outputs to other node inputs
3. **Computation**: GraphEngine computes nodes in topological order
4. **Persistence**: Results are serialized and stored
5. **Recomputation**: Only recomputes when inputs or node code changes

## Node Types

### Inline Code Nodes
- Execute JavaScript code directly
- Access inputs via `inputs` object
- Set outputs via `outputs` object
- Example:
  ```javascript
  outputs.sum = inputs.a + inputs.b;
  outputs.product = inputs.a * inputs.b;
  ```

### Library Nodes
- Pre-built nodes with retrievable manifests
- Stored in library system
- Can be reused across graphs

### Subgraph Nodes
- Wrapped interlinked parts of a graph
- Can be used as reusable components
- External inputs/outputs define interface

### External Input/Output Nodes
- Define graph boundaries
- External inputs: data entry points
- External outputs: data exit points

## Schema Inference

The system automatically infers data schemas from node outputs:
- Primitive types: string, number, boolean, null
- Complex types: object, array
- Nested structures are supported

## Security Considerations

**Important**: The current implementation uses `eval()` for inline code execution, which is a security risk. For production use:

1. Replace with a proper sandbox:
   - `vm2` (Node.js VM wrapper)
   - `isolated-vm` (V8 isolates)
   - Docker containers for complete isolation

2. Implement code validation:
   - Syntax checking
   - Resource limits
   - Timeout mechanisms

3. Add user authentication and authorization

## Future Enhancements

- [ ] Proper code sandboxing
- [ ] Real-time collaboration
- [ ] Version control for graphs
- [ ] Node marketplace/library browser
- [ ] Visual schema editor
- [ ] Performance optimization for large graphs
- [ ] Export/import functionality
- [ ] Graph templates
