# k8v Test Case Inventory

This file maps implemented features (`FUNCTIONALITY.md`) to documented test cases.
Last reviewed: February 23, 2026.

## Coverage Legend

- `Automated`: Covered by committed test code in `packages/*/tests`.
- `Manual`: Covered by a documented manual regression case (not yet automated).
- `Gap`: No documented test case yet.

## Automated Test Cases

- `A-FE-01` `packages/frontend/tests/graphStore.test.ts`: `initializeGraph` recovers stale graph ID via `/api/graphs/latest`.
- `A-FE-02` `packages/frontend/tests/graphStore.test.ts`: `updateNodePosition` persists position without changing node version.
- `A-FE-03` `packages/frontend/tests/nodeFactory.test.ts`: inline node defaults to `javascript_vm`.
- `A-FE-04` `packages/frontend/tests/nodeFactory.test.ts`: inline node honors explicit runtime.
- `A-FE-05` `packages/frontend/tests/graphStore.test.ts`: auto-recompute keeps only latest undrained pending batch while compute is in flight.
- `A-FE-06` `packages/frontend/tests/graphStore.test.ts`: auto-recompute processes impacted nodes in upstream-to-downstream order.
- `A-FE-07` `packages/frontend/tests/graphStore.test.ts`: upstream compute error marks downstream nodes stale and skips downstream auto-recompute until upstream recovers.
- `A-FE-08` `packages/frontend/tests/nodeFactory.test.ts`: inline node stores explicit `pythonEnv` value.
- `A-FE-09` `packages/frontend/tests/graphStore.test.ts`: selecting a drawing clears node selection and vice versa.
- `A-FE-10` `packages/frontend/tests/graphStore.test.ts`: adding a drawing persists drawing payload through graph update.
- `A-FE-11` `packages/frontend/tests/canvasAnimation.test.ts`: canvas animation loop gate runs only when interaction/effect/error state requires redraw.
- `A-FE-12` `packages/frontend/tests/graphStore.test.ts`: `loadGraph` hydrates per-node graphics-output cache from persisted node results.
- `A-FE-13` `packages/frontend/tests/graphStore.test.ts`: `computeNode` updates per-node graphics-output cache from compute response.
- `A-FE-14` `packages/frontend/tests/graphStore.test.ts`: `computeGraph` clears stale cached graphics when latest result omits graphics output.
- `A-FE-15` `packages/frontend/tests/nodeFactory.test.ts`: numeric input node factory defaults (`value`, `min`, `max`, `step`) and node type.
- `A-BE-01` `packages/backend/tests/app.test.ts`: `POST /api/graphs` accepts runtime in node config.
- `A-BE-02` `packages/backend/tests/app.test.ts`: `POST /api/graphs` rejects malformed runtime config.
- `A-BE-03` `packages/backend/tests/app.test.ts`: `PUT /api/graphs/:id` rejects malformed runtime updates.
- `A-BE-04` `packages/backend/tests/app.test.ts`: compute returns clear error for unknown runtime.
- `A-BE-05` `packages/backend/tests/app.test.ts`: `POST /api/graphs` rejects cyclic graphs.
- `A-BE-06` `packages/backend/tests/app.test.ts`: `PUT /api/graphs/:id` rejects cycle-introducing connection updates.
- `A-BE-07` `packages/backend/tests/app.test.ts`: `PUT /api/graphs/:id` rejects updates on legacy cyclic graphs (strict DAG enforcement).
- `A-BE-08` `packages/backend/tests/GraphEngine.test.ts`: downstream recompute after upstream result changes.
- `A-BE-09` `packages/backend/tests/DataStore.test.ts`: versioned results are preserved for same node.
- `A-BE-10` `packages/backend/tests/NodeExecutor.test.ts`: default runtime selection.
- `A-BE-11` `packages/backend/tests/NodeExecutor.test.ts`: configured runtime selection.
- `A-BE-12` `packages/backend/tests/NodeExecutor.test.ts`: unknown runtime throws.
- `A-BE-13` `packages/backend/tests/JavaScriptVmRuntime.test.ts`: runtime captures outputs/text/graphics.
- `A-BE-14` `packages/backend/tests/JavaScriptVmRuntime.test.ts`: runtime captures thrown errors.
- `A-BE-15` `packages/backend/tests/JavaScriptVmRuntime.test.ts`: runtime timeout enforcement.
- `A-BE-16` `packages/backend/tests/PythonProcessRuntime.test.ts`: Python runtime captures outputs/text/graphics.
- `A-BE-17` `packages/backend/tests/PythonProcessRuntime.test.ts`: Python runtime captures execution errors.
- `A-BE-18` `packages/backend/tests/PythonProcessRuntime.test.ts`: Python runtime timeout enforcement.
- `A-BE-19` `packages/backend/tests/NodeExecutor.test.ts`: NodeExecutor executes inline nodes with `python_process` runtime.
- `A-BE-20` `packages/backend/tests/app.test.ts`: graph API accepts `python_process` runtime in node config.
- `A-BE-21` `packages/backend/tests/app.test.ts`: graph API accepts graph-level python env definitions and node `pythonEnv` references.
- `A-BE-22` `packages/backend/tests/app.test.ts`: graph API rejects duplicate graph-level python env names.
- `A-BE-23` `packages/backend/tests/app.test.ts`: graph API rejects node `pythonEnv` references that are missing from graph env list.
- `A-BE-24` `packages/backend/tests/app.test.ts`: graph API rejects node `pythonEnv` on non-`python_process` runtime.
- `A-BE-25` `packages/backend/tests/NodeExecutor.test.ts`: NodeExecutor passes graph-level env `pythonPath`/`cwd` to Python runtime request.
- `A-BE-26` `packages/backend/tests/NodeExecutor.test.ts`: NodeExecutor rejects unknown node `pythonEnv` references at execution time.
- `A-BE-27` `packages/backend/tests/NodeExecutor.test.ts`: NodeExecutor rejects `pythonEnv` usage on non-`python_process` runtime.
- `A-BE-28` `packages/backend/tests/PythonProcessRuntime.test.ts`: Python runtime honors request-level `pythonBin` and `cwd`.
- `A-BE-29` `packages/backend/tests/PythonProcessRuntime.test.ts`: Python runtime converts bytes passed to `outputGraphics` into PNG data URLs.
- `A-BE-30` `packages/backend/tests/PythonProcessRuntime.test.ts`: Python runtime accepts raw PNG base64 via `outputPng`.
- `A-BE-31` `packages/backend/tests/app.test.ts`: graph API accepts persisted drawings payload.
- `A-BE-32` `packages/backend/tests/app.test.ts`: graph API rejects duplicate drawing ids.
- `A-BE-33` `packages/backend/tests/app.test.ts`: graph API rejects duplicate path ids within a drawing.
- `A-BE-34` `packages/backend/tests/NodeExecutor.test.ts`: NodeExecutor computes `numeric_input` outputs with normalized `min`/`max`/`step`/`value`.
- `A-BE-35` `packages/backend/tests/app.test.ts`: graph API accepts `numeric_input` nodes and compute returns numeric output.

## Manual Regression Test Cases

- `M-GRAPH-01`: On first launch with no existing graph, app auto-creates a graph and persists it.
- `M-GRAPH-02`: Graph changes persist optimistically without UI jump/snap-back.
- `M-GRAPH-03`: Node panel graph selector loads the selected graph and updates localStorage current graph ID.
- `M-GRAPH-04`: Node panel create-graph action creates and immediately switches to the new graph.
- `M-GRAPH-05`: Node panel rename-graph input persists graph name updates.
- `M-GRAPH-06`: Node panel shows current graph ID to avoid MCP/UI target mismatches.
- `M-GRAPH-07`: Node panel graph Python env editor add/edit/delete/save persists graph-level env definitions and reloads correctly.
- `M-CANVAS-01`: Wheel zoom in/out keeps pointer-focused zoom and smooth redraw.
- `M-CANVAS-02`: Shift/Alt + wheel performs directional scroll without zoom.
- `M-CANVAS-03`: Dragging empty space pans viewport.
- `M-CANVAS-04`: Dragging a node updates and persists node position (no snap-back after click).
- `M-CANVAS-05`: Hovering input/output connectors shows visual highlight.
- `M-CANVAS-06`: Drag output connector to compatible input creates connection line.
- `M-CANVAS-07`: Clicking an edge selects it, `Delete`/`Backspace` removes it.
- `M-CANVAS-08`: Clicking a node selects it, `Delete`/`Backspace` removes it.
- `M-CANVAS-09`: Frontend blocks self-loop and cycle-causing edge creation.
- `M-CANVAS-10`: Minimap click recenters viewport only when clicking minimap (no regular-canvas jump).
- `M-CANVAS-11`: Canvas text remains sharp across zoom levels with antialiasing enabled.
- `M-CANVAS-12`: Selecting a node does not reset canvas viewport (no zoom/pan jump).
- `M-CANVAS-13`: Pencil mode draws freehand strokes on canvas while pan/select interactions are suppressed.
- `M-CANVAS-14`: Pencil color selector applies white/green/red stroke colors.
- `M-CANVAS-15`: Pencil thickness selector applies hairline (1px), 3px, and 9px stroke widths.
- `M-CANVAS-16`: Drawing objects are explicitly created, selectable by handle/title, and can be moved by dragging handle.
- `M-CANVAS-17`: While draw mode is enabled, paths are added to the currently selected drawing object.
- `M-CANVAS-18`: Deleting selected drawing removes all persisted paths and handle from canvas.
- `M-CANVAS-19`: Canvas redraw loop idles when no interactions/effects are active and resumes on the next interaction or status animation trigger.
- `M-CANVAS-20`: `python_process` node graphics output projects below the node card with no in-card frame/padding.
- `M-CANVAS-21`: `numeric_input` node shows an in-card slider; dragging the slider updates and persists the node output value.
- `M-PANEL-01`: Edit node display name and verify card title updates.
- `M-PANEL-02`: Add input port and verify rendered connector/label.
- `M-PANEL-03`: Rename input port and verify inbound connection target port updates.
- `M-PANEL-04`: Reorder input ports and verify layout reflects new order.
- `M-PANEL-05`: Delete input port and verify inbound connections to that port are removed.
- `M-PANEL-06`: Toggle auto-recompute and verify node indicator color change.
- `M-PANEL-07`: Edit inline code, verify draft is stable while typing, and persist on blur.
- `M-PANEL-08`: For a `python_process` node, selecting a graph-level Python env in node panel persists and is used on compute.
- `M-PANEL-09`: Selecting a drawing allows rename/delete operations from node panel.
- `M-PANEL-10`: For a `numeric_input` node, editing `min`/`max`/`step` in node panel updates slider behavior and persisted output value bounds.
- `M-STATUS-01`: Running compute shows amber indicator while executing.
- `M-STATUS-02`: Runtime error shows red indicator and error message in node panel.
- `M-STATUS-03`: Auto-recompute enabled and healthy shows green indicator.
- `M-STATUS-04`: Upstream error marks downstream nodes stale with brown indicator.
- `M-STATUS-05`: Node in error state emits subtle black smoke near the card status light.
- `M-COMPUTE-01`: Manual run of selected node from node panel updates output panel.
- `M-COMPUTE-02`: Graph compute from toolbar updates all downstream outputs.
- `M-COMPUTE-03`: Output panel refresh recovers from persistence lag without manual reload.
- `M-VALID-01`: API rejects connection with missing source/target node references.
- `M-VALID-02`: API rejects cycle on graph create/update and allows non-connection edits on legacy cyclic graph.
- `M-MCP-01`: `graph_screenshot_region` captures the exact requested world rectangle into the requested fixed bitmap dimensions.
- `M-MCP-02`: MCP screenshot renderer page contains only graph content (no app side panels/toolbars).
- `M-MCP-03`: MCP screenshot overlay node numbers are unique per graph and stable across repeated captures.
- `M-MCP-04`: MCP graph-edit tools (add/move/rename/code/input/connection/delete) persist through backend and are reflected by `graph_get`.
- `M-MCP-05`: MCP drawing tools can create/move/rename/delete drawings and append drawing paths that appear in `graph_get`.
- `M-MCP-06`: MCP screenshot renderer includes persisted drawing paths and drawing handle labels.
- `M-MCP-07`: MCP Python env tools can add/edit/delete graph env definitions, and env renames/deletes keep node `pythonEnv` references consistent.

## Feature Coverage Map

| Feature (from `FUNCTIONALITY.md`) | Test Cases | Coverage |
| --- | --- | --- |
| Load last opened graph from localStorage on startup | `A-FE-01` | Automated |
| Fallback to latest stored graph when saved graph ID is stale | `A-FE-01` | Automated |
| Auto-create a new graph when no graph exists | `M-GRAPH-01` | Manual |
| Persist graph edits through `PUT /api/graphs/:id` | `A-FE-02` | Automated |
| Optimistic graph updates to avoid UI snap-back during save | `M-GRAPH-02` | Manual |
| Node panel graph selection | `M-GRAPH-03` | Manual |
| Node panel graph creation | `M-GRAPH-04` | Manual |
| Node panel graph rename | `M-GRAPH-05` | Manual |
| Node panel graph Python env management | `M-GRAPH-07` | Manual |
| Current graph ID visibility in UI | `M-GRAPH-06` | Manual |
| Pixi.js canvas renderer for nodes/connectors | `M-CANVAS-11` | Manual |
| Pixi canvas redraw loop is demand-driven and idles when no interactions/effects are active | `A-FE-11`, `M-CANVAS-19` | Automated + Manual |
| Mouse wheel zoom | `M-CANVAS-01` | Manual |
| Shift/Alt wheel directional scroll | `M-CANVAS-02` | Manual |
| Drag-to-pan on empty canvas | `M-CANVAS-03` | Manual |
| Drag-to-move nodes with persisted positions | `A-FE-02`, `M-CANVAS-04` | Automated + Manual |
| Edge rendering with Bezier curves | `M-CANVAS-07` | Manual |
| Edge hit-testing and selection | `M-CANVAS-07` | Manual |
| Delete selected edge with `Delete`/`Backspace` | `M-CANVAS-07` | Manual |
| Delete selected node with `Delete`/`Backspace` | `M-CANVAS-08` | Manual |
| Connector hover highlighting | `M-CANVAS-05` | Manual |
| Drag output to input to create connection | `M-CANVAS-06` | Manual |
| Frontend cycle-prevention during connection creation | `M-CANVAS-09` | Manual |
| Canvas projects `python_process` graphics outputs below node cards (no in-card frame/padding) | `A-FE-12`, `A-FE-13`, `A-FE-14`, `M-CANVAS-20` | Automated + Manual |
| Canvas `numeric_input` nodes render interactive in-card slider controls | `M-CANVAS-21` | Manual |
| Minimap/navigation assistant click-to-center | `M-CANVAS-10` | Manual |
| Node selection keeps viewport stable (no jump/reset) | `M-CANVAS-12` | Manual |
| Canvas pencil draw mode | `M-CANVAS-13` | Manual |
| Canvas pencil color selection (white/green/red) | `M-CANVAS-14` | Manual |
| Canvas pencil thickness selection (1/3/9 px) | `M-CANVAS-15` | Manual |
| Persistent drawing objects (create/select/move/delete) | `A-FE-09`, `A-FE-10`, `A-BE-31`, `A-BE-32`, `A-BE-33`, `M-CANVAS-16`, `M-CANVAS-17`, `M-CANVAS-18` | Automated + Manual |
| Edit node display name | `M-PANEL-01` | Manual |
| Edit runtime for inline-code node | `A-FE-03`, `A-FE-04`, `A-BE-01` | Automated |
| Edit inline-code node `pythonEnv` binding | `A-FE-08`, `A-BE-21`, `M-PANEL-08` | Automated + Manual |
| Edit selected drawing metadata (name/delete) | `M-PANEL-09`, `M-CANVAS-18` | Manual |
| Edit inline-code source with stable local draft and save-on-blur | `M-PANEL-07` | Manual |
| Input management: add/rename/reorder/delete | `M-PANEL-02`, `M-PANEL-03`, `M-PANEL-04`, `M-PANEL-05` | Manual |
| Numeric input settings (`value`, `min`, `max`, `step`) | `A-FE-15`, `M-PANEL-10`, `M-CANVAS-21` | Automated + Manual |
| Input rename/delete propagation to connections | `M-PANEL-03`, `M-PANEL-05` | Manual |
| Toggle auto-recompute per node | `M-PANEL-06` | Manual |
| Run selected node manually | `M-COMPUTE-01` | Manual |
| Per-node execution state in store | `A-FE-07`, `M-STATUS-01`, `M-STATUS-02`, `M-STATUS-03`, `M-STATUS-04` | Automated + Manual |
| Card status light (red/amber/brown/green/gray) | `M-STATUS-01`, `M-STATUS-02`, `M-STATUS-03`, `M-STATUS-04` | Manual |
| Node panel execution error text | `M-STATUS-02` | Manual |
| Error-state smoke effect on node cards | `M-STATUS-05` | Manual |
| Compute entire graph from toolbar | `M-COMPUTE-02` | Manual |
| Compute single selected node from node panel | `M-COMPUTE-01` | Manual |
| Deterministic recomputation by node version + deps timestamps | `A-BE-08` | Automated |
| Persist outputs/schema/text/graphics | `A-BE-09`, `A-BE-13` | Automated |
| Output panel shows text/graphics for selected node | `M-COMPUTE-01` | Manual |
| Cached frontend node graphics outputs hydrate from persisted results and refresh on compute | `A-FE-12`, `A-FE-13`, `A-FE-14` | Automated |
| Output refresh retry after compute (persistence lag) | `M-COMPUTE-03` | Manual |
| Auto-recompute downstream nodes on graph updates | `A-FE-05`, `A-FE-06`, `M-PANEL-06`, `M-COMPUTE-02` | Automated + Manual |
| Auto-recompute triggers after successful persistence | `A-FE-05`, `M-COMPUTE-02` | Automated + Manual |
| Auto-recompute coalesces undrained updates to latest pending batch | `A-FE-05` | Automated |
| Auto-recompute execution order is upstream to downstream | `A-FE-06` | Automated |
| Auto-recompute marks downstream stale when upstream errors and skips affected downstream runs | `A-FE-07`, `M-STATUS-04` | Automated + Manual |
| Backend request validation via Zod | `A-BE-02`, `A-BE-03` | Automated |
| Graph python env names are unique | `A-BE-22` | Automated |
| MCP graph Python env management | `M-MCP-07` | Manual |
| Node `pythonEnv` references are valid and runtime-compatible | `A-BE-23`, `A-BE-24`, `A-BE-26`, `A-BE-27` | Automated |
| Validate missing node references in connections | `M-VALID-01` | Manual |
| Reject cycles on `POST` | `A-BE-05` | Automated |
| Reject cycle-introducing connection changes on `PUT` | `A-BE-06` | Automated |
| Reject updates on legacy cyclic graphs | `A-BE-07` | Automated |
| NodeExecutor supports inline/library/subgraph/external/numeric I/O | `A-BE-10`, `A-BE-11`, `A-BE-12`, `A-BE-34`, `A-BE-35` | Automated |
| Default inline runtime `javascript_vm` | `A-FE-03`, `A-BE-10` | Automated |
| Python inline runtime `python_process` | `A-BE-16`, `A-BE-17`, `A-BE-18`, `A-BE-19`, `A-BE-20`, `A-BE-21`, `A-BE-25`, `A-BE-28`, `A-BE-29`, `A-BE-30` | Automated |
| Pluggable runtime architecture in place | `A-BE-10`, `A-BE-11`, `A-BE-12` | Automated |
| Playwright-based canvas snapshot script | `README.md` snapshot command + `packages/frontend/scripts/captureCanvasSnapshot.mjs` | Manual |
| MCP graph-edit API coverage | `M-MCP-04`, `M-MCP-07` | Manual |
| MCP drawing-edit API coverage | `M-MCP-05` | Manual |
| MCP internal rectangle screenshot (`graph_screenshot_region`) | `M-MCP-01`, `M-MCP-02`, `M-MCP-06` | Manual |
| MCP screenshot node-number overlay (stable unique identifiers) | `M-MCP-03` | Manual |

## Open Gaps

- No committed automated UI/e2e suite currently covers Pixi canvas interactions.
- No committed automated frontend tests yet for node panel input editing and auto-recompute UI workflows.
- Missing-node-reference API validation has documented manual case only (`M-VALID-01`) and should gain an automated backend test.
