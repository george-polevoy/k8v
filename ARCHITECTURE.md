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

#### RecomputeManager (`packages/backend/src/core/RecomputeManager.ts`)
- Owns backend-driven recomputation scheduling for graph updates and manual recompute requests
- Computes impacted downstream chains and marks all queued descendants as pending before execution
- Executes recompute batches through a graph-level configurable worker queue (`recomputeConcurrency`)
- Exposes `/api/graphs/:id/recompute-status` state for frontend polling
- Graph updates can bypass enqueueing update-driven recompute via `PUT /api/graphs/:id?noRecompute=true`

#### DataStore (`packages/backend/src/core/DataStore.ts`)
- Persists computation results in structured format (JSON)
- Stores graph metadata in SQLite
- Manages library node manifests
- Serializes outputs and schemas separately for type inference
- Persists graphics as id-addressable artifacts with PNG mip-map levels and metadata-only compute responses

#### NodeExecutor (`packages/backend/src/core/NodeExecutor.ts`)
- Executes different node types (inline code, library, subgraph, external I/O)
- Infers data schemas from outputs
- Delegates inline code execution to runtime implementations (`packages/backend/src/core/execution/`)
- Current default runtime: `JavaScriptVmRuntime` (Node `vm` sandbox with timeout)
- Additional runtime: `PythonProcessRuntime` (`python_process`) via spawned `python3` process with timeout
- Resolves graph-scoped named Python environments (`name`, `pythonPath`, `cwd`) for per-node Python execution when `node.config.pythonEnv` is set
- Uses graph-level `executionTimeoutMs` for inline runtime timeouts (default: 30 seconds)

#### Execution Engine (`packages/backend/src/core/execution/`)
- **Pluggable runtime architecture** for secure code execution
- Supports multiple runtimes: V8 isolates, WASM/WASI, containers
- Supports multiple languages: JavaScript, TypeScript, Python, etc.
- See [EXECUTION_ENGINE.md](./EXECUTION_ENGINE.md) for detailed design

#### MCP Server (`packages/mcp-server/src/index.ts`)
- Exposes graph-editing operations for agent clients over MCP stdio transport
- Delegates graph mutations to existing backend REST API (`/api/graphs/*`)
- Supports ordered `bulk_edit` graph mutations applied sequentially and persisted in a single graph update
- Provides connection-inspection and deterministic per-input rewiring tools (`connections_list`, `connection_set`/`connection_replace`)
- Uses connection-only graph update payloads for connection tools to avoid touching node position/card-size/projection fields
- Provides internal Playwright-based screenshot rendering for agents
- Uses the frontend app in a `canvasOnly` mode (floating tool windows hidden) so screenshots use the same Pixi canvas rendering path as users
- Screenshot API accepts explicit world rectangle coordinates and fixed bitmap dimensions

### Frontend

#### Canvas (`packages/frontend/src/components/Canvas.tsx`)
- Infinite canvas rendered with Pixi.js
- Viewport navigation supports mouse-wheel zoom, pinch zoom, two-finger trackpad pan, wheel scroll (modifier), and drag-to-pan
- Visual node and edge rendering from graph store state
- Persistent drawing-object layer (named handles + stored freehand paths) rendered in Pixi viewport
- Drag-and-drop node positioning with persisted coordinates
- Node status indicators (error/computing/stale/auto-recompute/idle)
- Error-state smoke animation rendered as part of the Pixi effects layer
- Pixi ticker is demand-driven and pauses when there are no active interactions/effects to render

#### Graph Store (`packages/frontend/src/store/graphStore.ts`)
- Zustand state management for graph data
- API integration with backend
- Node and connection management
- Persistent drawing object management (create/select/rename/move/delete/path append)
- Optimistic persistence for graph edits
- Node execution state tracking (pending/computing/error/stale/last-run)
- Backend recompute-status polling for execution updates

## Data Flow

1. **Node Creation**: User creates nodes on canvas with defined inputs/outputs
2. **Connection**: User connects node outputs to other node inputs
3. **Computation**: GraphEngine computes nodes in topological order
4. **Persistence**: Results are serialized and stored
5. **Recomputation**: Backend recompute manager detects impacted chains, schedules queued work, and publishes node execution state updates

## Directed Graph Semantics

- Graph edges are directed from `sourceNodeId/sourcePort` (producer) to `targetNodeId/targetPort` (consumer).
- Computation dependencies follow edge direction: a node depends on all nodes with incoming edges to it.
- Runtime computation uses topological ordering so dependencies are computed before dependents.
- Backend recompute queue processing follows upstream-to-downstream topological order.
- Graph updates can enqueue all impacted auto-recompute descendants as pending before execution starts.
- When an upstream node is errored, backend recompute skips affected downstream nodes and marks them stale.
- Circular dependencies are rejected for new graphs and all graph updates.

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
- Configurable execution timeout (default: 30 seconds)
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
