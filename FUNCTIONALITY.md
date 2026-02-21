# k8v Functionality Inventory

This file tracks what is currently implemented in the codebase as of February 21, 2026.
Test-case coverage mapping for these features is maintained in `TEST_CASES.md`.

## Graph Lifecycle

- Load last opened graph from localStorage on startup.
- Fallback to latest stored graph when saved graph ID is stale.
- Auto-create a new graph when no graph exists.
- Persist graph edits through `PUT /api/graphs/:id`.
- Optimistic graph updates in frontend store to avoid UI snap-back during save.
- Graph behavior is directed (`source -> target`) and computed via dependency-aware topological ordering.

## Canvas and Interaction

- Pixi.js canvas renderer for nodes and connectors.
- Mouse wheel zoom.
- Shift/Alt wheel directional scroll.
- Drag-to-pan on empty canvas.
- Drag-to-move nodes with persisted positions.
- Edge rendering with Bezier curves.
- Edge hit-testing and selection.
- Delete selected edge with `Delete`/`Backspace`.
- Delete selected node with `Delete`/`Backspace`.
- Connector hover highlighting.
- Drag from output port to input port to create connection.
- Frontend cycle-prevention during connection creation.
- Minimap/navigation assistant with click-to-center behavior.

## Node Editing (Node Panel)

- Edit node display name (card title).
- Edit inline-code runtime (currently JavaScript VM).
- Edit inline-code source with local draft state and persist on blur.
- Input port management:
  - add input
  - rename input
  - reorder input
  - delete input
- Input rename/delete propagates to connections targeting that input.
- Toggle auto-recompute per node.
- Run selected node manually.

## Node Status and Indicators

- Per-node execution state tracked in frontend store.
- Card status light:
  - red: last compute errored
  - amber: computing now
  - green: auto-recompute enabled and no current error
  - gray: default/idle
- Node panel shows execution error text when available.

## Computation and Outputs

- Compute entire graph from toolbar.
- Compute single selected node from node panel.
- Deterministic recomputation in backend based on node version + dependency result timestamps.
- Persist outputs, inferred schema, text output, and graphics output.
- Output panel shows text and graphics result for selected node.
- Output refresh retries after compute to account for persistence lag.

## Auto-Recompute Behavior

- On graph updates, frontend computes impacted downstream nodes.
- Nodes with auto-recompute enabled are automatically recomputed when upstream nodes change.
- Recompute triggers run after successful graph persistence.
- Auto-recompute uses a single pending batch slot; while recompute is in flight, new graph updates replace the undrained pending batch with the latest impacted nodes.
- Auto-recompute processes impacted nodes in upstream-to-downstream order.

## Validation and Safety

- Backend request validation via Zod.
- Graph validation checks missing node references in connections.
- Graph cycle rejection for new graphs (`POST`).
- Graph cycle rejection for all graph updates (`PUT`), including non-connection edits.

## Runtime and Execution Engine

- NodeExecutor supports inline code, library, subgraph, external input, external output node types.
- Default inline runtime: JavaScript VM runtime (`javascript_vm`).
- Pluggable runtime architecture is in place for future runtimes.

## Debugging and Tooling

- Playwright-based canvas snapshot script for headless visual debugging.
- Backend/frontend build and test scripts wired at workspace root.
