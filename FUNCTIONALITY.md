# k8v Functionality Inventory

This file tracks what is currently implemented in the codebase as of March 3, 2026.
Test-case coverage mapping for these features is maintained in `TEST_CASES.md`.

## Graph Lifecycle

- Load last opened graph from localStorage on startup.
- Fallback to latest stored graph when saved graph ID is stale.
- Auto-create a new graph when no graph exists.
- Persist graph edits through `PUT /api/graphs/:id`.
- Optimistic graph updates in frontend store to avoid UI snap-back during save.
- Graph update API supports optimistic concurrency via `ifMatchUpdatedAt`; stale clients receive conflict instead of silently overwriting newer graph edits.
- Graph update API supports optional `?noRecompute=true` query flag to skip backend auto-recompute enqueue for that update.
- Graph update API preserves existing node layout/projection metadata when updates only provide `connections`.
- On graph update conflict (`409`), frontend reloads latest graph state and surfaces a non-fatal conflict message.
- Graph behavior is directed (`source -> target`) and computed via dependency-aware topological ordering.
- Graph query API (`POST /api/graphs/:id/query`) supports lightweight field-projected overview responses, downstream BFS/DFS traversal, and starting-vertex discovery (nodes with no downstream/outgoing edges); connection projections always include `sourceNodeId` and `targetNodeId`.
- Graph panel graph management: select existing graph, create new graph, rename current graph, and delete current graph.
- Graph panel backend recompute worker setting: edit per-graph `recomputeConcurrency` (`1-32`).
- Graph panel projection management: select active 2D projection, add new projections, and remove non-default projections.
- New projections clone node coordinates, node card dimensions, and projection background from the currently selected projection.
- Graph stores per-projection node coordinates, node card dimensions, background settings, and active projection id; default projection is always present.
- Graph update API rejects projection updates that remove all projections (at least one projection must remain).
- Graph panel graph Python environment management: add/edit/delete/save named env definitions (`name`, `pythonPath`, `cwd`).
- Graph panel projection background management: choose `solid` or `gradient` mode and set base color via reusable color-selection dialog for the active projection.
- Graph panel connection stroke management: configure per-graph foreground/background connector colors and widths (background width auto-locked to 2x foreground).
- Current graph ID is shown in graph panel for explicit graph-target confirmation.

## Canvas and Interaction

- Pixi.js canvas renderer for nodes and connectors.
- Canvas background supports per-projection `solid` color fill or base-color-driven `gradient` rendering.
- Pixi canvas redraw loop is demand-driven: ticker wakes on interaction/state changes and auto-pauses when there are no active interactions or effects.
- Mouse wheel zoom (up to 4x zoom-in and deep zoom-out).
- Pinch zoom (trackpad gesture) keeps pointer-focused zoom with higher sensitivity than mouse wheel.
- Two-finger trackpad scroll pans viewport.
- Shift + wheel scrolls horizontally; Alt + wheel scrolls vertically.
- Empty-canvas click-drag performs marquee node selection; holding `Space` converts empty-canvas drag into viewport panning.
- Canvas supports multi-node selection with marquee drag, `Ctrl`-click toggle, and additive `Ctrl`-drag marquee selection.
- Multi-selected nodes keep per-node selected styling, expose shared move/resize handles, and delete together.
- Alt-dragging a selected node set duplicates the selected nodes, keeps the originals in place, and copies any internal links between the duplicated nodes.
- Drag-to-move nodes with persisted positions.
- Node position persistence is projection-aware: moving a node updates coordinates only for the active projection.
- Node card resize persistence is projection-aware: resizing updates dimensions only for the active projection.
- Switching active projection animates node position, card dimensions, and background transition instead of hard switching.
- Graphics mip/offscreen reload decisions are deferred until projection transition animation completes to avoid reload churn.
- Switching active projection applies that projection's stored node coordinates and card dimensions.
- Edge rendering with Bezier curves.
- Connection lines render with dual layered strokes (background + foreground) to remain legible over mixed canvas backgrounds.
- Edge hit-testing and selection.
- Delete selected edge with `Delete`/`Backspace`.
- Delete selected node with `Delete`/`Backspace`.
- Connector hover highlighting.
- Drag from output port to input port to create connection.
- Frontend cycle-prevention during connection creation.
- `python_process` nodes project latest graphics outputs directly on canvas beneath the node card.
- Graphics mip-level selection is quality-biased: UI requests use a 2x pixel-budget multiplier before choosing the nearest stored mip level.
- `numeric_input` nodes render an in-card slider on canvas for direct value adjustment.
- Node cards can be resized directly on canvas via drag handle; resized width/height persists per node with minimum-size guards and no fixed maximum cap.
- `annotation` nodes render markdown note cards (including TeX/LaTeX math) directly on canvas via an HTML overlay synchronized to pan/zoom.
- Annotation cards display note content only (no card title) and render no overlay text when content is empty.
- New annotation cards are created with empty text content (no default template).
- `annotation` node cards support configurable background, border, and font colors.
- Annotation color controls support opacity (alpha) and use the shared color dialog used by drawing/canvas background workflows.
- `annotation` node cards support configurable font size.
- `annotation` node cards support all-side resize handles (north/south/east/west + corners) and persist updated size/position.
- `annotation` node cards support presentation-only connection arrows from any card edge, with persisted edge anchors and arrowheads indicating direction.
- Minimap/navigation assistant with click-to-center behavior.
- Pencil draw mode on canvas (toggle from toolbar).
- Draw tool color is selected via reusable color-selection dialog (default `#ffffff`).
- Draw tool options: thickness `hairline (1px)`/`3px`/`9px`.
- Draw toolbar hint text wraps within the narrow panel without horizontal overflow.
- Drawings are persisted as graph-level drawing objects with named handles.
- Drawing paths are attached to a selected drawing object (not ephemeral canvas paint).
- Drawing handles are selectable, draggable (move drawing), and deletable.
- Drawing paths and handles are rendered in canvas and minimap.
- Canvas fills the full viewport while UI chrome is rendered as floating overlays.
- Toolbar and right-side panel stack are draggable floating windows, so layout remains stable during window resizing.
- Shared color-selection dialogs render as viewport overlays outside floating toolbar/sidebar windows, so larger dialogs are not clipped by narrow panel client areas.
- Shared color-selection dialogs support rectangular saturation/value picking, linear hue selection, RGB sliders, preset swatches, and optional opacity control.
- Right sidebar uses collapsible accordion panels for graph editing, node editing, output, and diagnostics.
- Selecting a node auto-expands the Node accordion panel.
- Diagnostics panel shows backend failure state with a red header indicator and user-readable error message.
- Canvas node card titles are ellipsized to prevent long names from overlapping the card layout.

## Node Editing (Node Panel)

- Edit node display name (card title).
- Edit inline-code runtime (currently JavaScript VM).
- For `python_process` inline nodes, select a named graph-level Python environment (`pythonEnv`) or fall back to backend default Python.
- Edit inline-code source with local draft state and persist on blur.
- Inline-code source edits auto-sync inferred output ports; connected legacy output ports are preserved to avoid invalidating existing edges.
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
- Node panel shows selected-node graphics budget debug values (`maxPixels` inputs/selection) for projected graphics troubleshooting.
- Node panel supports annotation content editing (markdown + TeX/LaTeX), annotation card color controls, and annotation font-size controls.
- Node panel summarizes multi-node selections as a set (`N selected (Name 1, Name 2, ...)`) instead of presenting a single-node identity.
- Shared node-card background and border color edits can be applied across the full selected node set from the node panel, and canvas cards render those persisted colors for both single- and multi-selected nodes.

## Node Status and Indicators

- Per-node execution state tracked in frontend store from backend result hydration + backend recompute-status polling.
- Card status light:
  - red: last compute errored
  - amber: pending recompute or computing now
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

- On graph updates, backend detects impacted downstream chains.
- Nodes with auto-recompute enabled are automatically recomputed when upstream nodes change.
- Backend marks all impacted recompute nodes as pending before execution begins.
- Backend recompute queue processes nodes in upstream-to-downstream order.
- Backend recompute queue uses graph-level configurable worker concurrency (`recomputeConcurrency`).
- Backend recompute skips downstream execution when any upstream dependency is errored; skipped downstream nodes are marked stale until upstream errors are resolved.
- Frontend does not run recompute chains locally; it sends explicit recompute requests from buttons and polls `/api/graphs/:id/recompute-status` for updates.

## Validation and Safety

- Backend request validation via Zod.
- Graph validation checks missing node references in connections.
- Graph validation enforces unique graph-level Python environment names.
- Graph validation enforces that node `pythonEnv` references exist and are only used with `python_process` runtime.
- Graph cycle rejection for new graphs (`POST`).
- Graph cycle rejection for all graph updates (`PUT`), including non-connection edits.

## Runtime and Execution Engine

- NodeExecutor supports inline code, library, subgraph, external input, numeric input, external output node types.
- `annotation` nodes are presentation-only and excluded from backend recompute execution.
- Default inline runtime: JavaScript VM runtime (`javascript_vm`).
- Additional inline runtime: Python subprocess runtime (`python_process`) for backend execution.
- Graph-level script execution timeout (`executionTimeoutMs`) defaults to 30 seconds and is editable in graph settings.
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
- MCP graph-edit tools for node creation (`node_add_inline`, `node_add_numeric_input`, `node_add_annotation`), moving, naming, annotation content/style update, code/runtime update, auto-recompute toggle, input port editing, connect/disconnect, deterministic per-input rewiring (`connection_set` / `connection_replace`), delete, and compute.
- MCP `node_set_code` and bulk-edit `node_set_code` infer inline output ports from updated code and retain currently connected legacy outputs for connection-safe edits; optional `outputNames` allows explicit output-port schema updates for delegated helper-style code.
- MCP `node_set_annotation` and bulk-edit `node_set_annotation` update annotation text/colors/font size without raw whole-graph mutation.
- MCP `connections_list` tool lists edges for a graph with optional `nodeId`/`targetPort` filters.
- MCP `graph_query` tool delegates to backend graph-query operations (`overview`, `traverse_bfs`, `traverse_dfs`, `starting_vertices`) and returns only requested node/connection fields, including annotation nodes and optional `sourceAnchor`/`targetAnchor` link projection.
- MCP connection mutation tools (`connection_add`, `connection_delete`, `connection_set`, `connection_replace`) accept optional `noRecompute` to avoid backend auto-recompute enqueue and preserve annotation-link anchors on `__annotation__` endpoints.
- MCP graph-edit tools for projections: add a projection (cloned from current active coordinates/card sizes/background by default) and select active projection.
- MCP graph-edit tools for graph-level Python env management: add/edit/delete env definitions (`name`, `pythonPath`, `cwd`).
- MCP graph-edit tools for drawing objects: create, move, rename, delete, and append paths.
- MCP `bulk_edit` tool accepts an ordered array of graph-edit operations (including `node_add_numeric_input`, `node_add_annotation`, and annotation-aware connection edits) and applies them sequentially in one persisted graph update.
- Internal-only Playwright screenshot tool (`graph_screenshot_region`) renders through the frontend canvas in `canvasOnly` mode on a dedicated hidden page.
- Screenshot tool captures by explicit world rectangle (`x`, `y`, `width`, `height`) into fixed bitmap size (`width`, `height`).
- Screenshot render includes persisted drawing paths and drawing handles.
