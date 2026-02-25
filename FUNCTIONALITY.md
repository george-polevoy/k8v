# k8v Functionality Inventory

This file tracks what is currently implemented in the codebase as of February 23, 2026.
Test-case coverage mapping for these features is maintained in `TEST_CASES.md`.

## Graph Lifecycle

- Load last opened graph from localStorage on startup.
- Fallback to latest stored graph when saved graph ID is stale.
- Auto-create a new graph when no graph exists.
- Persist graph edits through `PUT /api/graphs/:id`.
- Optimistic graph updates in frontend store to avoid UI snap-back during save.
- Graph update API supports optimistic concurrency via `ifMatchUpdatedAt`; stale clients receive conflict instead of silently overwriting newer graph edits.
- On graph update conflict (`409`), frontend reloads latest graph state and surfaces a non-fatal conflict message.
- Graph behavior is directed (`source -> target`) and computed via dependency-aware topological ordering.
- Graph panel graph management: select existing graph, create new graph, rename current graph, and delete current graph.
- Graph panel projection management: select active 2D projection, add new projections, and remove non-default projections.
- New projections clone node coordinates, node card dimensions, and projection background from the currently selected projection.
- Graph stores per-projection node coordinates, node card dimensions, background settings, and active projection id; default projection is always present.
- Graph update API rejects projection updates that remove all projections (at least one projection must remain).
- Graph panel graph Python environment management: add/edit/delete/save named env definitions (`name`, `pythonPath`, `cwd`).
- Graph panel projection background management: choose `solid` or `gradient` mode and set base color via reusable color-selection dialog for the active projection.
- Current graph ID is shown in graph panel for explicit graph-target confirmation.

## Canvas and Interaction

- Pixi.js canvas renderer for nodes and connectors.
- Canvas background supports per-projection `solid` color fill or base-color-driven `gradient` rendering.
- Pixi canvas redraw loop is demand-driven: ticker wakes on interaction/state changes and auto-pauses when there are no active interactions or effects.
- Mouse wheel zoom.
- Pinch zoom (trackpad gesture) keeps pointer-focused zoom with higher sensitivity than mouse wheel.
- Two-finger trackpad scroll pans viewport.
- Shift + wheel scrolls horizontally; Alt + wheel scrolls vertically.
- Drag-to-pan on empty canvas.
- Drag-to-move nodes with persisted positions.
- Node position persistence is projection-aware: moving a node updates coordinates only for the active projection.
- Node card resize persistence is projection-aware: resizing updates dimensions only for the active projection.
- Switching active projection animates node position, card dimensions, and background transition instead of hard switching.
- Graphics mip/offscreen reload decisions are deferred until projection transition animation completes to avoid reload churn.
- Switching active projection applies that projection's stored node coordinates and card dimensions.
- Edge rendering with Bezier curves.
- Edge hit-testing and selection.
- Delete selected edge with `Delete`/`Backspace`.
- Delete selected node with `Delete`/`Backspace`.
- Connector hover highlighting.
- Drag from output port to input port to create connection.
- Frontend cycle-prevention during connection creation.
- `python_process` nodes project latest graphics outputs directly on canvas beneath the node card.
- Graphics mip-level selection is quality-biased: UI requests use a 2x pixel-budget multiplier before choosing the nearest stored mip level.
- `numeric_input` nodes render an in-card slider on canvas for direct value adjustment.
- Node cards can be resized directly on canvas via drag handle; resized width/height persists per node, with width capped at `3840` and height capped at `2160`.
- Minimap/navigation assistant with click-to-center behavior.
- Pencil draw mode on canvas (toggle from toolbar).
- Draw tool color is selected via reusable color-selection dialog (default `#ffffff`).
- Draw tool options: thickness `hairline (1px)`/`3px`/`9px`.
- Draw toolbar hint text wraps within the narrow panel without horizontal overflow.
- Drawings are persisted as graph-level drawing objects with named handles.
- Drawing paths are attached to a selected drawing object (not ephemeral canvas paint).
- Drawing handles are selectable, draggable (move drawing), and deletable.
- Drawing paths and handles are rendered in canvas and minimap.
- Right sidebar uses collapsible accordion panels for graph editing, node editing, output, and diagnostics.
- Selecting a node auto-expands the Node accordion panel.
- Diagnostics panel shows backend failure state with a red header indicator and user-readable error message.
- Canvas node card titles are ellipsized to prevent long names from overlapping the card layout.

## Node Editing (Node Panel)

- Edit node display name (card title).
- Edit inline-code runtime (currently JavaScript VM).
- For `python_process` inline nodes, select a named graph-level Python environment (`pythonEnv`) or fall back to backend default Python.
- Edit inline-code source with local draft state and persist on blur.
- Input port management:
  - add input
  - rename input
  - reorder input
  - delete input
- Numeric input node settings:
  - edit slider `value`
  - edit slider `min`/`max`/`step`
- Input rename/delete propagates to connections targeting that input.
- Toggle auto-recompute per node.
- Run selected node manually.
- Edit selected drawing name and delete selected drawing from node panel.

## Node Status and Indicators

- Per-node execution state tracked in frontend store.
- Card status light:
  - red: last compute errored
  - amber: computing now
  - brown: stale because an upstream dependency is currently errored
  - green: auto-recompute enabled and no current error
  - gray: default/idle
- Node panel shows execution error text when available.
- Error nodes emit subtle black smoke from the status-light area on the canvas.

## Computation and Outputs

- Compute entire graph from toolbar.
- Compute single selected node from node panel.
- Deterministic recomputation in backend based on node version + dependency result timestamps.
- Backend invalidates target-node compute cache on inbound connection topology changes by bumping affected node versions on graph updates.
- Persist outputs, inferred schema, text output, and graphics output.
- Output panel shows text and graphics result for selected node.
- Canvas renders `python_process` node image outputs as raw projections below the card (no in-card frame/padding).
- Output refresh retries after compute to account for persistence lag.

## Auto-Recompute Behavior

- On graph updates, frontend computes impacted downstream nodes.
- Nodes with auto-recompute enabled are automatically recomputed when upstream nodes change.
- Recompute triggers run after successful graph persistence.
- Auto-recompute uses a single pending batch slot; while recompute is in flight, new graph updates replace the undrained pending batch with the latest impacted nodes.
- Auto-recompute processes impacted nodes in upstream-to-downstream order.
- Auto-recompute skips downstream execution when any upstream dependency is errored; skipped downstream nodes are marked stale until upstream errors are resolved.

## Validation and Safety

- Backend request validation via Zod.
- Graph validation checks missing node references in connections.
- Graph validation enforces unique graph-level Python environment names.
- Graph validation enforces that node `pythonEnv` references exist and are only used with `python_process` runtime.
- Graph cycle rejection for new graphs (`POST`).
- Graph cycle rejection for all graph updates (`PUT`), including non-connection edits.

## Runtime and Execution Engine

- NodeExecutor supports inline code, library, subgraph, external input, numeric input, external output node types.
- Default inline runtime: JavaScript VM runtime (`javascript_vm`).
- Additional inline runtime: Python subprocess runtime (`python_process`) for backend execution.
- Graph-level Python environment list supports named entries with `name`, `pythonPath`, and `cwd`.
- Python runtime supports `inputs`, `outputs`, `print`/`log`, `outputGraphics`/`outputImage`, timeout, and error capture.
- Python runtime normalizes PNG outputs from bytes/base64 and provides `outputPng`/`outputPNG` helpers for image rendering.
- Python runtime accepts per-execution `pythonBin` and `cwd` overrides, enabling node-level env selection.
- Pluggable runtime architecture is in place for future runtimes.

## Debugging and Tooling

- Playwright-based canvas snapshot script for headless visual debugging.
- Backend/frontend build and test scripts wired at workspace root.

## MCP and Agent API

- MCP server package at `packages/mcp-server`.
- MCP graph-edit tools for node creation (`node_add_inline`, `node_add_numeric_input`), moving, naming, code/runtime update, auto-recompute toggle, input port editing, connect/disconnect, delete, and compute.
- MCP graph-edit tools for projections: add a projection (cloned from current active coordinates/card sizes/background by default) and select active projection.
- MCP graph-edit tools for graph-level Python env management: add/edit/delete env definitions (`name`, `pythonPath`, `cwd`).
- MCP graph-edit tools for drawing objects: create, move, rename, delete, and append paths.
- MCP `bulk_edit` tool accepts an ordered array of graph-edit operations (including `node_add_numeric_input`) and applies them sequentially in one persisted graph update.
- Internal-only Playwright screenshot tool (`graph_screenshot_region`) renders graph content on a dedicated hidden page.
- Screenshot tool captures by explicit world rectangle (`x`, `y`, `width`, `height`) into fixed bitmap size (`width`, `height`).
- Screenshot render overlays stable concise per-graph node numbers (unique integers) for OCR/agent-friendly node identification.
- Screenshot render includes persisted drawing paths and drawing handles.
