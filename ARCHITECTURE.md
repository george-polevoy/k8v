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
- Delegates inline code execution to runtime implementations (`packages/backend/src/core/execution/`)
- Current default runtime: `JavaScriptVmRuntime` (Node `vm` sandbox with timeout)

#### Execution Engine (`packages/backend/src/core/execution/`)
- **Pluggable runtime architecture** for secure code execution
- Supports multiple runtimes: V8 isolates, WASM/WASI, containers
- Supports multiple languages: JavaScript, TypeScript, Python, etc.
- See [EXECUTION_ENGINE.md](./EXECUTION_ENGINE.md) for detailed design

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

Code execution security is addressed through the pluggable **Execution Engine** architecture.
See [EXECUTION_ENGINE.md](./EXECUTION_ENGINE.md) for detailed security design.

### Current Risk (To Be Resolved)
The current implementation uses Node `vm` as an intermediate runtime. It is safer than direct `eval()`, but still in-process and not sufficient as a production security boundary.

### Resolution Plan
1. **Phase 1**: Replace with `isolated-vm` (V8 isolates with memory/timeout limits)
2. **Phase 2**: Add WASM/WASI runtime for maximum isolation
3. **Phase 3**: Container-based execution for untrusted code

### Security Guarantees (Post-Implementation)
- No access to Node.js APIs, filesystem, or network
- Configurable memory limits (default: 128MB)
- Configurable execution timeout (default: 5 seconds)
- User authentication and authorization

## Related Documentation

- [EXECUTION_ENGINE.md](./EXECUTION_ENGINE.md) - Pluggable execution runtime architecture
- [OUTPUT_FEATURES.md](./OUTPUT_FEATURES.md) - Text and graphics output capabilities
- [PORT_NAMING.md](./PORT_NAMING.md) - Port naming conventions
- [EXAMPLES.md](./EXAMPLES.md) - Usage examples

## Future Enhancements

### Execution Engine
- [x] Design pluggable runtime architecture
- [ ] Implement V8 isolate runtime
- [ ] Implement WASM/WASI runtime
- [ ] Implement container runtime
- [ ] Add TypeScript transpilation
- [ ] Add Python language support

### Collaboration
- [ ] Real-time collaboration
- [ ] Version control for graphs
- [ ] Graph templates and sharing

### UI/UX
- [ ] Node marketplace/library browser
- [ ] Visual schema editor
- [ ] Performance optimization for large graphs
- [ ] Export/import functionality
