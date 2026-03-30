# k8v Functionality Inventory

This file tracks what is currently implemented in the codebase as of March 25, 2026.
Test-case coverage mapping for these features is maintained in `TEST_CASES.md`.

## Graph Lifecycle

- Load last opened graph from localStorage on startup.
- Fallback to latest stored graph when saved graph ID is stale.
- Auto-create a new graph when no graph exists.
- Persist graph edits through `POST /api/graphs/:id/commands`.
- Optimistic graph updates in frontend store to avoid UI snap-back during save.
- Graph command API uses monotonic `baseRevision`; stale clients receive `409` conflict instead of silently overwriting newer graph edits.
- Graph command API supports optional `?noRecompute=true` query flag to skip backend auto-recompute enqueue for that command batch.
- Connections-only command updates preserve existing node layout/projection metadata.
- Nodes-only command updates sync the active projection layout server-side, so node move/resize edits do not need to resend the full projection set.
- On graph update conflict (`409`), frontend reloads latest graph state and surfaces a non-fatal conflict message.
- Open sessions detect remote current-graph updates through graph events and runtime-state polling fallback, then reload the latest graph state automatically when no local save is pending.
- Frontend runtime-state polling backs off to a slower idle cadence when no backend work is active and ignores unchanged backend snapshots to avoid redundant UI churn.
- Graph behavior is directed (`source -> target`) and computed via dependency-aware topological ordering.
- Graph query API (`POST /api/graphs/:id/query`) supports lightweight field-projected overview responses, downstream BFS/DFS traversal, and starting-vertex discovery (nodes with no downstream/outgoing edges); connection projections always include `sourceNodeId` and `targetNodeId`.
- Graph panel graph management: select existing graph, create new graph, rename current graph, and delete current graph.
- Graph panel backend recompute worker setting: edit per-graph `recomputeConcurrency` (`1-32`).
- Graph panel camera management: select the current camera for this browser window, add cameras cloned from the current camera state, and remove non-default cameras.
- Graph panel projection management: select active 2D projection, add new projections, and remove non-default projections.
- New projections clone node coordinates, node card dimensions, and projection background from the currently selected projection.
- Graph stores per-projection node coordinates, node card dimensions, background settings, and active projection id; default projection is always present.
- Graph stores shared camera objects with viewport pan/zoom and floating window layout state; default camera is always present.
- Current camera selection is window-local per graph (scoped to the current browser tab/window rather than shared across all viewers).
- Graph command API rejects projection updates that remove all projections (at least one projection must remain).
- Graph command API normalizes camera updates so the default camera always remains present.
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
- Holding `Space` converts canvas drag into viewport panning, including when the pointer starts on a selected node or drawing instead of empty canvas.
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
- Non-annotation input slots are single-inbound; dragging a new edge onto an occupied input rewires that slot instead of storing duplicate inbound edges.
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
- All node cards support presentation-only connection arrows from any card edge, with persisted edge anchors and arrowheads indicating direction.
- Minimap/navigation assistant with click-to-center behavior.
- Current graph viewport pan/zoom state persists across browser refresh as part of the active camera.
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
- Floating toolbar and right sidebar window positions persist across browser refresh as part of the active camera.
- Floating window layouts are stored as nearest-edge padding ratios, so the same camera can reopen cleanly in different browser window sizes without layout hysteresis.
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
  - choose whether slider drags persist on release only or propagate while dragging
  - configure live-drag debounce in seconds for propagated slider updates
- Input rename/delete propagates to connections targeting that input.
- Toggle auto-recompute per node.
- Run selected node manually.
- Edit selected drawing name and delete selected drawing from node panel.
- Node panel shows selected-node graphics budget debug values (`maxPixels` inputs/selection) for projected graphics troubleshooting.
- Node panel supports annotation content editing (markdown + TeX/LaTeX), annotation card color controls, annotation font-size controls, and shared multi-selection annotation font color/font-size edits.
- Node panel summarizes multi-node selections as a set (`N selected (Name 1, Name 2, ...)`) instead of presenting a single-node identity.
- Shared node-card background and border color edits can be applied across the full selected node set from the node panel, and canvas cards render those persisted colors for both single- and multi-selected nodes.

## Node Status and Indicators

- Per-node execution state tracked in frontend store from graph-scoped runtime-state snapshots and persisted node results.
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
- Backend invalidates target-node compute cache on inbound connection topology changes by bumping affected node versions on graph command mutations.
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
- When a new graph update arrives, pending graph-update recompute work is collapsed to the latest graph revision and rebuilt from the current graph-wide stale set; already-running work is not canceled.
- Backend recompute skips downstream execution when any upstream dependency is errored; skipped downstream nodes are marked stale until upstream errors are resolved.
- Frontend does not run recompute chains locally; it sends explicit compute commands and refreshes from `/api/graphs/:id/runtime-state` plus SSE events.

## Validation and Safety

- Backend request validation via Zod.
- Graph validation checks missing node references in connections.
- Graph validation rejects multiple inbound connections that target the same input slot (or the same annotation anchor slot).
- Graph validation enforces unique graph-level Python environment names.
- Graph validation enforces that node `pythonEnv` references exist and are only used with `python_process` runtime.
- Graph cycle rejection for new graphs (`POST`).
- Graph cycle rejection for all graph command updates, including non-connection edits.

## Runtime and Execution Engine

- NodeExecutor supports inline code, numeric input, and annotation node types.
- `annotation` nodes are presentation-only and excluded from backend recompute execution.
- Default inline runtime: JavaScript VM runtime (`javascript_vm`) retained as an interim runtime, not a production isolation boundary.
- Additional inline runtime: Python warm-service runtime (`python_process`) for backend execution.
- Graph-level script execution timeout (`executionTimeoutMs`) defaults to 30 seconds and is editable in graph settings.
- Graph-level Python environment list supports named entries with `name`, `pythonPath`, and `cwd`.
- Python runtime supports `inputs`, `outputs`, `print`/`log`, `outputGraphics`/`outputImage`, timeout, and error capture.
- Python runtime normalizes PNG outputs from bytes/base64 and provides `outputPng`/`outputPNG` helpers for image rendering.
- Python runtime accepts per-execution `pythonBin` and `cwd` overrides, enabling node-level env selection.
- Python execution reuses warm graph/env-scoped worker pools and sizes pool capacity from graph `recomputeConcurrency`.
- Pluggable runtime architecture is in place for future runtimes.
- Reusable library nodes are not implemented and are not currently triaged.
- Reusable subgraph packaging remains future roadmap work, not current functionality.
- External input/output boundary nodes are not implemented and are not currently triaged.

## Debugging and Tooling

- Playwright-based canvas snapshot script for headless visual debugging.
- Backend/frontend build and test scripts wired at workspace root.

## MCP and Agent API

- MCP server package at `packages/mcp-server` forwards agent requests to the backend REST API.
- `graph_create` is the only non-bulk mutator, creating an empty graph with defaults and no seeded nodes/connections.
- `bulk_edit` is the single graph mutation surface: it accepts ordered backend/domain `GraphCommand[]` (including compute commands) and applies them sequentially through the backend command service.
- `node_add_inline`, `node_add_numeric_input`, and `node_add_annotation` accept optional initial `cardWidth` and `cardHeight` values so agents can size cards before first render.
- MCP exposes transient wasm algo invocation via `algo_injection_run`, which accepts an absolute `wasmPath` plus optional `entrypoint` and `input`, and returns only `status` and `commandCount`.
- The backend validates the wasm module on each invocation using a fixed JSON wasm ABI (`memory`, `alloc`, and `run` by default) plus a fixed capability-based host API: `graph_get`, `graph_query`, and staged `bulk_edit`.
- Algo-hosted `bulk_edit` batches are staged during wasm execution and committed once on success; `compute_graph` and `compute_node` are rejected from inside the sandbox.
- The invoked wasm runs in an isolated child-process sandbox with no generic filesystem or outbound network access.
- Read/query helpers remain available: `graph_list`, `graph_get`, `graph_query` (`overview`, `traverse_bfs`, `traverse_dfs`, `starting_vertices`), and `connections_list`.
- MCP exposes discoverability resources/templates for command schemas, query schemas, annotation workflow examples, and wasm-invocation docs/examples.
- `graph_query` can project annotation-oriented fields such as `position`, `cardSize`, `annotationText`, and `config` for lightweight board inspection.
- Internal Playwright screenshot tool (`graph_screenshot_region`) renders a dedicated screenshot harness built from the frontend canvas renderer, avoids the interactive app shell, and captures fixed-size bitmaps from explicit world rectangles (`x`, `y`, `width`, `height`), including drawing paths and handles.
