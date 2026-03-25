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
- Delegates task planning and stale-state derivation to `packages/backend/src/core/recompute/`
- Computes impacted downstream chains and marks all queued descendants as pending before execution
- Executes recompute batches through a graph-level configurable worker queue (`recomputeConcurrency`)
- Uses an internal `RecomputeStateStore` to track node execution state snapshots exposed through graph runtime-state responses and SSE-triggered refreshes
- Graph command batches can bypass enqueueing update-driven recompute via `POST /api/graphs/:id/commands?noRecompute=true`

#### DataStore (`packages/backend/src/core/DataStore.ts`)
- Thin persistence facade over `packages/backend/src/core/storage/`
- Stores graph metadata through `GraphRepository`
- Persists computation results and schemas through `ComputationResultRepository`
- Persists graphics as id-addressable artifacts with PNG mip-map levels through `GraphicsArtifactStore`
- Centralizes schema-versioned SQLite bootstrap and version-scoped storage initialization through `DatabaseBootstrap`

#### GraphCommandService (`packages/backend/src/core/GraphCommandService.ts`)
- Owns graph mutation and compute policy for the command API (`POST /api/graphs/:id/commands`)
- Applies typed graph commands against a base graph revision and rejects stale writes with revision conflicts
- Normalizes graph persistence details after command batches (projection sync, camera normalization, connection-stroke normalization, node version bumps)
- Triggers update-driven recompute enqueueing after persisted command batches unless `noRecompute=true`
- Builds graph-scoped runtime-state snapshots returned by `GET /api/graphs/:id/runtime-state` and command responses

#### Graph Document Factory (`packages/backend/src/core/graphDocumentFactory.ts`)
- Normalizes and validates first-write graph documents for `POST /api/graphs`
- Applies graph defaults (projection, camera, timeout, drawing/env collections) before persistence

#### NodeExecutor (`packages/backend/src/core/NodeExecutor.ts`)
- Executes current node types (inline code, numeric input, annotation)
- Infers data schemas from outputs
- Delegates inline code execution to runtime implementations (`packages/backend/src/core/execution/`)
- Current default runtime: `JavaScriptVmRuntime` (Node `vm` sandbox with timeout, retained as an interim runtime rather than a production isolation boundary)
- Additional runtime: `PythonProcessRuntime` (`python_process`) via spawned `python3` process with timeout
- Resolves graph-scoped named Python environments (`name`, `pythonPath`, `cwd`) for per-node Python execution when `node.config.pythonEnv` is set
- Uses graph-level `executionTimeoutMs` for inline runtime timeouts (default: 30 seconds)

#### Execution Engine (`packages/backend/src/core/execution/`)
- **Pluggable runtime architecture** for secure code execution
- Supports multiple runtimes: V8 isolates, WASM/WASI, containers
- Supports multiple languages: JavaScript, TypeScript, Python, etc.
- See [EXECUTION_ENGINE.md](./EXECUTION_ENGINE.md) for detailed design

#### MCP Server (`packages/mcp-server/src/index.ts`)
- Exposes the agent-facing MCP transport backed by the backend REST API (`/api/graphs/*`)
- Allows agents to create empty graphs via `graph_create` and to mutate any existing graph through `bulk_edit`, which forwards ordered backend `GraphCommand[]`
- Adds dedicated graph-scoped wasm algo injection tools (`algo_injection_register`, `algo_injection_list`, `algo_injection_delete`, `algo_injection_run`) instead of overloading `bulk_edit` for binary/module management
- Removes MCP-local mutation registries/operation schemas so agents share the backend/domain `GraphCommand` language
- Keeps only read/query/runtime helpers: `graph_list`, `graph_get`, `graph_query`, `connections_list`, `graphics_get`, and `graph_screenshot_region`
- Publishes MCP resources/templates for command/query schema discovery and annotation workflow examples
- Publishes dedicated algo-injection docs/examples that describe the fixed wasm host API (`graph_get`, `graph_query`, staged `bulk_edit`)
- Renders internal screenshots through a dedicated screenshot harness page that reuses the frontend canvas renderer without booting the interactive app shell
- Screenshot API captures explicit world rectangles into fixed bitmap dimensions, reusing the shared frontend canvas render path while avoiding toolbar/sidebar/localStorage app boot concerns

#### Algo Injection Service (`packages/backend/src/core/AlgoInjectionService.ts`)
- Stores graph-scoped wasm module metadata on the graph document while keeping wasm bytes in a dedicated artifact store
- Validates wasm registration against the fixed JSON ABI (`memory`, `alloc`, `run` by default) and an allowlisted import namespace
- Invokes wasm modules in an isolated child process rather than directly on the HTTP handler path
- Exposes only capability-style host calls: `graph_get`, `graph_query`, and staged `bulk_edit`
- Rejects recompute commands during wasm-hosted `bulk_edit` and commits staged graph commands once after successful completion

### Frontend

#### Canvas (`packages/frontend/src/components/Canvas.tsx`)
- Infinite canvas rendered with Pixi.js
- Acts as a composition shell over extracted canvas modules (`canvasTypes`, `canvasGeometry`, `canvasGraphRules`, `canvasRendering`, viewport/runtime/interaction hooks)
- Viewport navigation supports mouse-wheel zoom, pinch zoom, two-finger trackpad pan, wheel scroll (modifier), and drag-to-pan
- Visual node and edge rendering from graph store state
- Any card can originate/terminate persisted presentation-only arrows from arbitrary edge anchors
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
- Optimistic persistence for graph edits through graph command batches
- Node execution state and latest node-result tracking (pending/computing/error/stale/last-run)
- Real-time graph/runtime sync through SSE with runtime-state polling fallback

## Data Flow

1. **Node Creation**: User creates nodes on canvas with defined inputs/outputs
2. **Connection**: User connects node outputs to other node inputs
3. **Computation**: GraphEngine computes nodes in topological order
4. **Persistence**: Results are serialized and stored
5. **Recomputation**: Backend recompute manager detects impacted chains, schedules queued work, and publishes runtime updates consumed through SSE and graph-scoped runtime-state snapshots

## Directed Graph Semantics

- Graph edges are directed from `sourceNodeId/sourcePort` (producer) to `targetNodeId/targetPort` (consumer).
- Non-annotation target inputs are single-source: rewiring an occupied input replaces its prior inbound edge instead of allowing multiple inbound computational edges on one input slot.
- Computation dependencies follow edge direction: a node depends on all nodes with incoming edges to it.
- Runtime computation uses topological ordering so dependencies are computed before dependents.
- Backend recompute queue processing follows upstream-to-downstream topological order.
- Connections using the presentation pseudo-port / edge anchors are presentation-only: they persist/render on canvas but are excluded from dependency ordering, recompute propagation, and cycle validation.
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

### Numeric Input Nodes
- Provide persisted scalar values directly from node configuration
- Useful for simple graph parameters and demos without additional boundary-node types

### Annotation Nodes
- Presentation-only note cards on the canvas
- Excluded from dependency ordering and backend execution

## Future Roadmap Notes

- Reusable library nodes are not implemented and are not currently triaged.
- Reusable subgraph packaging remains future roadmap work rather than a supported runtime feature.

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
