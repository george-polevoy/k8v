# k8v Test Case Inventory

This file maps implemented features (`FUNCTIONALITY.md`) to documented test cases.
Last reviewed: February 21, 2026.

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

## Manual Regression Test Cases

- `M-GRAPH-01`: On first launch with no existing graph, app auto-creates a graph and persists it.
- `M-GRAPH-02`: Graph changes persist optimistically without UI jump/snap-back.
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
- `M-PANEL-01`: Edit node display name and verify card title updates.
- `M-PANEL-02`: Add input port and verify rendered connector/label.
- `M-PANEL-03`: Rename input port and verify inbound connection target port updates.
- `M-PANEL-04`: Reorder input ports and verify layout reflects new order.
- `M-PANEL-05`: Delete input port and verify inbound connections to that port are removed.
- `M-PANEL-06`: Toggle auto-recompute and verify node indicator color change.
- `M-PANEL-07`: Edit inline code, verify draft is stable while typing, and persist on blur.
- `M-STATUS-01`: Running compute shows amber indicator while executing.
- `M-STATUS-02`: Runtime error shows red indicator and error message in node panel.
- `M-STATUS-03`: Auto-recompute enabled and healthy shows green indicator.
- `M-COMPUTE-01`: Manual run of selected node from node panel updates output panel.
- `M-COMPUTE-02`: Graph compute from toolbar updates all downstream outputs.
- `M-COMPUTE-03`: Output panel refresh recovers from persistence lag without manual reload.
- `M-VALID-01`: API rejects connection with missing source/target node references.
- `M-VALID-02`: API rejects cycle on graph create/update and allows non-connection edits on legacy cyclic graph.

## Feature Coverage Map

| Feature (from `FUNCTIONALITY.md`) | Test Cases | Coverage |
| --- | --- | --- |
| Load last opened graph from localStorage on startup | `A-FE-01` | Automated |
| Fallback to latest stored graph when saved graph ID is stale | `A-FE-01` | Automated |
| Auto-create a new graph when no graph exists | `M-GRAPH-01` | Manual |
| Persist graph edits through `PUT /api/graphs/:id` | `A-FE-02` | Automated |
| Optimistic graph updates to avoid UI snap-back during save | `M-GRAPH-02` | Manual |
| Pixi.js canvas renderer for nodes/connectors | `M-CANVAS-11` | Manual |
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
| Minimap/navigation assistant click-to-center | `M-CANVAS-10` | Manual |
| Node selection keeps viewport stable (no jump/reset) | `M-CANVAS-12` | Manual |
| Edit node display name | `M-PANEL-01` | Manual |
| Edit runtime for inline-code node | `A-FE-03`, `A-FE-04`, `A-BE-01` | Automated |
| Edit inline-code source with stable local draft and save-on-blur | `M-PANEL-07` | Manual |
| Input management: add/rename/reorder/delete | `M-PANEL-02`, `M-PANEL-03`, `M-PANEL-04`, `M-PANEL-05` | Manual |
| Input rename/delete propagation to connections | `M-PANEL-03`, `M-PANEL-05` | Manual |
| Toggle auto-recompute per node | `M-PANEL-06` | Manual |
| Run selected node manually | `M-COMPUTE-01` | Manual |
| Per-node execution state in store | `M-STATUS-01`, `M-STATUS-02`, `M-STATUS-03` | Manual |
| Card status light (red/amber/green/gray) | `M-STATUS-01`, `M-STATUS-02`, `M-STATUS-03` | Manual |
| Node panel execution error text | `M-STATUS-02` | Manual |
| Compute entire graph from toolbar | `M-COMPUTE-02` | Manual |
| Compute single selected node from node panel | `M-COMPUTE-01` | Manual |
| Deterministic recomputation by node version + deps timestamps | `A-BE-08` | Automated |
| Persist outputs/schema/text/graphics | `A-BE-09`, `A-BE-13` | Automated |
| Output panel shows text/graphics for selected node | `M-COMPUTE-01` | Manual |
| Output refresh retry after compute (persistence lag) | `M-COMPUTE-03` | Manual |
| Auto-recompute downstream nodes on graph updates | `A-FE-05`, `A-FE-06`, `M-PANEL-06`, `M-COMPUTE-02` | Automated + Manual |
| Auto-recompute triggers after successful persistence | `A-FE-05`, `M-COMPUTE-02` | Automated + Manual |
| Auto-recompute coalesces undrained updates to latest pending batch | `A-FE-05` | Automated |
| Auto-recompute execution order is upstream to downstream | `A-FE-06` | Automated |
| Backend request validation via Zod | `A-BE-02`, `A-BE-03` | Automated |
| Validate missing node references in connections | `M-VALID-01` | Manual |
| Reject cycles on `POST` | `A-BE-05` | Automated |
| Reject cycle-introducing connection changes on `PUT` | `A-BE-06` | Automated |
| Reject updates on legacy cyclic graphs | `A-BE-07` | Automated |
| NodeExecutor supports inline/library/subgraph/external I/O | `A-BE-10`, `A-BE-11`, `A-BE-12` | Partial Automated |
| Default inline runtime `javascript_vm` | `A-FE-03`, `A-BE-10` | Automated |
| Pluggable runtime architecture in place | `A-BE-10`, `A-BE-11`, `A-BE-12` | Automated |
| Playwright-based canvas snapshot script | `README.md` snapshot command + `packages/frontend/scripts/captureCanvasSnapshot.mjs` | Manual |

## Open Gaps

- No committed automated UI/e2e suite currently covers Pixi canvas interactions.
- No committed automated frontend tests yet for node panel input editing and auto-recompute UI workflows.
- Missing-node-reference API validation has documented manual case only (`M-VALID-01`) and should gain an automated backend test.
