# k8v Test Case Inventory

This file maps implemented features (`FUNCTIONALITY.md`) to documented test cases.
Last reviewed: March 11, 2026.

## Coverage Legend

- `Automated`: Covered by committed test code in `packages/*/tests`.
- `Manual`: Covered by a documented manual regression case (not yet automated).
- `Gap`: No documented test case yet.

## Automated Test Cases

- `A-E2E-01` `packages/frontend/tests/e2e/numericInputSlider.test.ts`: `numeric_input` slider drag maintains `ew-resize` cursor and persists dragged value.
- `A-E2E-02` `packages/frontend/tests/e2e/graphDeletion.test.ts`: graph deletion uses inline confirmation (no browser dialog) and removes target graph.
- `A-E2E-03` `packages/frontend/tests/e2e/panelAccordion.test.ts`: right sidebar panels behave as accordion and graph controls are rendered in graph panel.
- `A-E2E-04` `packages/frontend/tests/e2e/panelAccordion.test.ts`: selecting a node auto-expands the Node panel section in the accordion sidebar.
- `A-E2E-05` `packages/frontend/tests/e2e/nodeResize.test.ts`: dragging a selected node card resize handle updates and persists node `cardWidth`/`cardHeight`.
- `A-E2E-06` `packages/frontend/tests/e2e/diagnosticsPanel.test.ts`: diagnostics accordion title shows red alert while collapsed and panel shows a human-readable backend failure message.
- `A-E2E-07` `packages/frontend/tests/e2e/toolbarDrawingHint.test.ts`: draw-toolbar “Create/select drawing” hint wraps inside the narrow toolbar panel without horizontal overflow.
- `A-E2E-08` `packages/frontend/tests/e2e/graphConflictReload.test.ts`: graph panel reloads latest graph when a stale local save conflicts with a remote update (`409`).
- `A-E2E-09` `packages/frontend/tests/e2e/graphicsMipSelection.test.ts`: output graphics requests use sharper mip selection (`maxPixels` reflects 2x budget bias).
- `A-E2E-10` `packages/frontend/tests/e2e/canvasWheelNavigation.test.ts`: canvas wheel navigation keeps mouse-wheel zoom around cursor, applies stronger pinch zoom response, supports deep zoom-in/out range, maps modifier pan (`Shift` horizontal, `Alt` vertical), and keeps trackpad-style small-delta pan.
- `A-E2E-11` `packages/frontend/tests/e2e/graphRecomputeConcurrency.test.ts`: graph panel recompute worker setting persists graph-level concurrency and clamps values to the backend-supported max.
- `A-E2E-12` `packages/frontend/tests/e2e/graphExecutionTimeout.test.ts`: graph panel script timeout setting persists graph-level execution timeout and accepts large values (no max clamp).
- `A-E2E-13` `packages/frontend/tests/e2e/nodeDragReRenderStability.test.ts`: node drag remains visually stable while canvas rerenders during recompute-status polling, and dropped position persists.
- `A-E2E-14` `packages/frontend/tests/e2e/annotationCard.test.ts`: annotation card renders markdown + KaTeX math, persists left/top edge resize updates (size + position), stays selectable with fully transparent background fill, persists font-size updates in node panel, and preserves empty text state (no template fallback, no overlay render when cleared).
- `A-E2E-15` `packages/frontend/tests/e2e/inlineCodeOutputPortSync.test.ts`: editing inline-code source in the node panel updates inferred output port metadata on blur.
- `A-E2E-16` `packages/frontend/tests/e2e/connectionStroke.test.ts`: graph panel connection stroke controls persist foreground/background colors and preserve the required 2x background-to-foreground width ratio.
- `A-E2E-17` `packages/frontend/tests/e2e/floatingPanelsLayout.test.ts`: canvas remains full viewport while toolbar/sidebar floating windows stay draggable and inside viewport bounds across window resize.
- `A-E2E-18` `packages/frontend/tests/e2e/canvasOnlyScreenshotMode.test.ts`: `?canvasOnly=1` hides floating toolbar/sidebar windows and exposes the MCP screenshot bridge on the frontend canvas view.
- `A-E2E-19` `packages/frontend/tests/e2e/toolbarNodeCreationDialogLayering.test.ts`: clicking toolbar add-node opens a full-size creation dialog mounted outside the toolbar floating window.
- `A-E2E-20` `packages/frontend/tests/e2e/annotationConnectionArrows.test.ts`: annotation cards create persisted presentation-only arrows from arbitrary card edges to standard node ports and other annotation edges.
- `A-E2E-21` `packages/frontend/tests/e2e/canvasMultiSelection.test.ts`: empty-canvas drag marquee-selects nodes without panning, `Ctrl` toggle/additive selection works without opening the browser context menu, shared multi-selection move/resize persists, delete removes only the selected nodes, and `Space`-drag pans the viewport.
- `A-E2E-22` `packages/frontend/tests/e2e/nodePanelMultiSelectionColors.test.ts`: node panel summarizes multi-node selection as a named set and applies shared node-card background/border color changes across all selected nodes.
- `A-E2E-23` `packages/frontend/tests/e2e/canvasMultiSelection.test.ts`: `Alt`-dragging a selected node set duplicates the nodes, keeps the originals in place, leaves the duplicate set selected, and copies internal links between the duplicated nodes.
- `A-E2E-24` `packages/frontend/tests/e2e/toolbarColorDialogLayering.test.ts`: the pencil color dialog mounts outside the narrow toolbar floating window, keeps its full overlay size, and is centered in the viewport instead of being clipped inside the toolbar client area.
- `A-E2E-25` `packages/frontend/tests/e2e/backgroundColor.test.ts`: the shared color dialog supports hue-slider and saturation/value-palette selection and persists the exact chosen graph background color.
- `A-E2E-26` `packages/frontend/tests/e2e/inlineInputConnectionReplacement.test.ts`: dragging a new edge onto an occupied inline input replaces the previous inbound edge instead of persisting duplicate inbound connections.
- `A-FE-01` `packages/frontend/tests/graphStore.test.ts`: `initializeGraph` recovers stale graph ID via `/api/graphs/latest`.
- `A-FE-02` `packages/frontend/tests/graphStore.test.ts`: `updateNodePosition` persists position without changing node version.
- `A-FE-03` `packages/frontend/tests/nodeFactory.test.ts`: inline node defaults to `javascript_vm`.
- `A-FE-04` `packages/frontend/tests/nodeFactory.test.ts`: inline node honors explicit runtime.
- `A-FE-05` `packages/frontend/tests/graphStore.test.ts`: graph updates do not trigger frontend auto-recompute requests.
- `A-FE-06` `packages/frontend/tests/graphStore.test.ts`: `computeNode` sends a backend recompute request for only the selected node.
- `A-FE-07` `packages/frontend/tests/graphStore.test.ts`: `computeGraph` sends a single backend recompute request.
- `A-FE-08` `packages/frontend/tests/nodeFactory.test.ts`: inline node stores explicit `pythonEnv` value.
- `A-FE-09` `packages/frontend/tests/graphStore.test.ts`: selecting a drawing clears node selection and vice versa.
- `A-FE-10` `packages/frontend/tests/graphStore.test.ts`: adding a drawing persists drawing payload through graph update.
- `A-FE-11` `packages/frontend/tests/canvasAnimation.test.ts`: canvas animation loop gate runs only when interaction/effect/error state requires redraw.
- `A-FE-12` `packages/frontend/tests/graphStore.test.ts`: `loadGraph` hydrates per-node graphics-output cache from persisted node results.
- `A-FE-13` `packages/frontend/tests/graphStore.test.ts`: `computeNode` updates per-node graphics-output cache from compute response.
- `A-FE-14` `packages/frontend/tests/graphStore.test.ts`: `computeGraph` clears stale cached graphics when latest result omits graphics output.
- `A-FE-15` `packages/frontend/tests/nodeFactory.test.ts`: numeric input node factory defaults (`value`, `min`, `max`, `step`) and node type.
- `A-FE-16` `packages/frontend/tests/graphStore.test.ts`: `deleteGraph` removes graph summaries and loads fallback graph when deleting current graph.
- `A-FE-17` `packages/frontend/tests/textLayout.test.ts`: title truncation helper ellipsizes long text to fit bounded width.
- `A-FE-18` `packages/frontend/tests/diagnostics.test.ts`: diagnostics formatter converts technical backend error strings into user-readable messages.
- `A-FE-19` `packages/frontend/tests/canvasBackground.test.ts`: canvas background normalization applies safe defaults and deterministic gradient stop derivation.
- `A-FE-20` `packages/frontend/tests/color.test.ts`: drawing color normalization supports hex values, legacy names, and fallback conversion.
- `A-FE-21` `packages/frontend/tests/projections.test.ts`: projection utilities normalize default projection state and apply projection coordinates to nodes.
- `A-FE-22` `packages/frontend/tests/graphStore.test.ts`: `updateNodePosition` writes node coordinates to the active projection map.
- `A-FE-23` `packages/frontend/tests/graphStore.test.ts`: `updateNodeCardSize` writes node card dimensions to the active projection map.
- `A-FE-24` `packages/frontend/tests/graphStore.test.ts`: on `409` graph-update conflict, frontend reloads latest graph state and surfaces a conflict message.
- `A-FE-25` `packages/frontend/tests/projections.test.ts`: projection normalization preserves oversized fallback node card dimensions (no fixed max cap).
- `A-FE-26` `packages/frontend/tests/wheelNavigation.test.ts`: wheel navigation helpers keep pinch/mouse-wheel zoom behavior, pan for trackpad two-finger scroll, and map modifier scrolling (`Shift` horizontal, `Alt` vertical).
- `A-FE-27` `packages/frontend/tests/graphStore.test.ts`: `loadGraph` normalizes missing graph `executionTimeoutMs` to the 30-second default.
- `A-FE-28` `packages/frontend/tests/nodeFactory.test.ts`: annotation node factory defaults (`text`, `backgroundColor`, `borderColor`, `fontColor`, `fontSize`) and node type.
- `A-FE-29` `packages/frontend/tests/connectionStroke.test.ts`: connection-stroke normalization enforces defaults, 2x width ratio, and foreground/background brightness separation.
- `A-FE-30` `packages/frontend/tests/annotationConnections.test.ts`: annotation connection helpers normalize edge anchors, snap arbitrary edge hits, and identify annotation-linked presentation edges.
- `A-FE-31` `packages/frontend/tests/graphStoreEditing.test.ts`: node multi-selection state preserves selected node IDs across set/toggle flows and reconciles remaining selection when a selected node is deleted.
- `A-FE-32` `packages/frontend/tests/nodeCardAppearance.test.ts`: node card appearance helpers normalize default/custom background and border colors for generic nodes while preserving annotation-specific color config.
- `A-FE-33` `packages/frontend/tests/connectionArrows.test.ts`: connection arrowhead sizing keeps the background arrow as outline padding around the foreground arrow instead of scaling the whole triangle with background stroke width.
- `A-FE-34` `packages/frontend/tests/selectionDuplication.test.ts`: selected-node duplication clones node metadata/config, remaps internal connections, copies projection state, and clears stale compute timestamps on the duplicates.
- `A-FE-35` `packages/frontend/tests/color.test.ts`: RGB/HSV color conversion helpers preserve canonical hues, handle grayscale zero-saturation colors, and round-trip hue/value choices back to RGB channels.
- `A-FE-36` `packages/frontend/tests/graphStorePersistence.test.ts`: `loadGraph` normalizes duplicate inbound edges on the same input slot down to the last persisted connection.
- `A-FE-37` `packages/frontend/tests/graphStoreEditing.test.ts`: `addConnection` rewires an occupied target input instead of appending a second inbound edge.
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
- `A-BE-36` `packages/backend/tests/app.test.ts`: `DELETE /api/graphs/:id` deletes existing graphs and returns 404 for missing graphs.
- `A-BE-37` `packages/backend/tests/app.test.ts`: `PUT /api/graphs/:id` accepts graph updates with payloads larger than 100KB (large drawings + node additions).
- `A-BE-38` `packages/backend/tests/app.test.ts`: graph API applies default canvas background settings and persists canvas background updates.
- `A-BE-39` `packages/backend/tests/app.test.ts`: graph API normalizes drawing path colors to hex format.
- `A-BE-40` `packages/backend/tests/app.test.ts`: `POST /api/graphs` initializes default projection metadata when omitted.
- `A-BE-41` `packages/backend/tests/app.test.ts`: `PUT /api/graphs/:id` switches active projection and applies that projection's node coordinates.
- `A-BE-42` `packages/backend/tests/app.test.ts`: switching `activeProjectionId` updates graph canvas background to the selected projection background.
- `A-BE-43` `packages/backend/tests/app.test.ts`: `PUT /api/graphs/:id` rejects updates that attempt to remove all projections.
- `A-BE-44` `packages/backend/tests/app.test.ts`: `PUT /api/graphs/:id` rejects stale `ifMatchUpdatedAt` writes with `409` conflict and current timestamp metadata.
- `A-BE-45` `packages/backend/tests/app.test.ts`: `POST /api/graphs` preserves oversized fallback node card dimensions (no fixed max cap).
- `A-BE-46` `packages/backend/tests/app.test.ts`: `PUT /api/graphs/:id` bumps versions for nodes whose inbound connections changed so stale input-missing errors recompute without manual node edits.
- `A-BE-47` `packages/backend/tests/app.test.ts`: recompute status endpoint reports graph-level worker concurrency and reflects updates.
- `A-BE-48` `packages/backend/tests/app.test.ts`: graph updates enqueue backend recompute for all impacted descendants and expose pending status through recompute-status polling.
- `A-BE-49` `packages/backend/tests/app.test.ts`: `POST /api/graphs` applies default graph execution timeout (`executionTimeoutMs = 30000`).
- `A-BE-50` `packages/backend/tests/app.test.ts`: `PUT /api/graphs/:id` persists graph execution timeout updates and accepts large values (no max cap).
- `A-BE-51` `packages/backend/tests/NodeExecutor.test.ts`: NodeExecutor forwards graph-level `executionTimeoutMs` to runtime requests and defaults to 30 seconds when absent.
- `A-BE-52` `packages/backend/tests/app.test.ts`: annotation nodes are accepted by graph API and rejected as non-executable for node-targeted compute calls.
- `A-BE-53` `packages/backend/tests/NodeExecutor.test.ts`: NodeExecutor treats annotation nodes as non-computing no-op outputs and does not invoke runtimes.
- `A-BE-54` `packages/backend/tests/PythonProcessRuntime.test.ts`: Python runtime retries once after timeout and only reports timeout after retry attempts are exhausted.
- `A-BE-55` `packages/backend/tests/app.test.ts`: `PUT /api/graphs/:id?noRecompute=true` applies connection updates without enqueueing backend recompute work.
- `A-BE-56` `packages/backend/tests/app.test.ts`: connections-only `PUT /api/graphs/:id` updates preserve node positions/card sizes and projection metadata.
- `A-BE-57` `packages/backend/tests/app.test.ts`: `POST /api/graphs` applies default graph-level connection stroke settings.
- `A-BE-58` `packages/backend/tests/app.test.ts`: `PUT /api/graphs/:id` persists graph-level connection stroke updates while normalizing 2x width ratio and brightness separation.
- `A-BE-59` `packages/backend/tests/app.test.ts`: `POST /api/graphs/:id/query` `overview` returns lightweight default field projections (`id`/`name` for nodes and mandatory `sourceNodeId`/`targetNodeId` plus port names for connections).
- `A-BE-60` `packages/backend/tests/app.test.ts`: `POST /api/graphs/:id/query` `traverse_bfs` supports depth-limited downstream traversal and returns only requested fields.
- `A-BE-61` `packages/backend/tests/app.test.ts`: `POST /api/graphs/:id/query` `traverse_dfs` enforces max-node-limited downstream traversal and returns only requested fields.
- `A-BE-62` `packages/backend/tests/app.test.ts`: `POST /api/graphs/:id/query` `starting_vertices` returns only nodes without downstream/outgoing connections.
- `A-BE-63` `packages/backend/tests/app.test.ts`: `POST /api/graphs/:id/query` rejects traversal requests whose `startNodeIds` are missing from the graph.
- `A-BE-64` `packages/backend/tests/app.test.ts`: `POST /api/graphs/:id/query` always includes `sourceNodeId`/`targetNodeId` in connections even when `connectionFields` omits them.
- `A-BE-65` `packages/backend/tests/app.test.ts`: annotation-linked connections round-trip persisted edge anchors and are excluded from DAG validation.
- `A-BE-66` `packages/backend/tests/GraphEngine.test.ts`: GraphEngine ignores annotation-linked cycles when computing executable nodes.
- `A-BE-67` `packages/backend/tests/app.test.ts`: `POST /api/graphs/:id/query` traverses annotation-linked nodes and can project annotation `sourceAnchor`/`targetAnchor` fields for those links.
- `A-BE-68` `packages/backend/tests/app.test.ts`: `PUT /api/graphs/:id` rejects connection updates that would leave multiple inbound edges on one target input slot.
- `A-MCP-01` `packages/mcp-server/tests/graphEdits.test.ts`: MCP projection cloning (`graph_projection_add`) preserves oversized fallback node card dimensions (no fixed max cap).
- `A-MCP-02` `packages/mcp-server/tests/graphEdits.test.ts`: MCP `connection_set` bulk operation atomically replaces inbound wiring for a target input and removes duplicates.
- `A-MCP-03` `packages/mcp-server/tests/graphEdits.test.ts`: MCP connection filtering helper narrows connection lists by node + target port.
- `A-MCP-04` `packages/mcp-server/tests/graphEdits.test.ts`: MCP `node_set_code` infers output ports from updated code, supports explicit `outputNames`, and preserves connected legacy output ports.
- `A-MCP-05` `packages/mcp-server/tests/graphEdits.test.ts`: MCP `graph_query` schema validates BFS requests, accepts annotation anchor connection fields, and enforces required `maxNodes` for DFS requests.
- `A-MCP-06` `packages/mcp-server/tests/screenshotParity.test.ts`: MCP frontend screenshot function output matches direct frontend canvas capture for identical graph/region inputs.
- `A-MCP-07` `packages/mcp-server/tests/screenshotParity.test.ts`: MCP frontend screenshot function respects requested bitmap dimensions.
- `A-MCP-08` `packages/mcp-server/tests/screenshotParity.test.ts`: MCP frontend screenshot function works when loading graph data from backend (no override payload).
- `A-MCP-09` `packages/mcp-server/tests/graphEdits.test.ts`: MCP bulk-edit operations create and update annotation nodes with persisted text/color/font-size config.
- `A-MCP-10` `packages/mcp-server/tests/graphEdits.test.ts`: MCP annotation connection edits preserve source/target anchors and `connection_set` rewires one annotation anchor slot without removing unrelated annotation links.

## Manual Regression Test Cases

- `M-GRAPH-01`: On first launch with no existing graph, app auto-creates a graph and persists it.
- `M-GRAPH-02`: Graph changes persist optimistically without UI jump/snap-back.
- `M-GRAPH-03`: Graph panel graph selector loads the selected graph and updates localStorage current graph ID.
- `M-GRAPH-04`: Graph panel create-graph action creates and immediately switches to the new graph.
- `M-GRAPH-05`: Graph panel rename-graph input persists graph name updates.
- `M-GRAPH-06`: Graph panel shows current graph ID to avoid MCP/UI target mismatches.
- `M-GRAPH-07`: Graph panel Python env editor add/edit/delete/save persists graph-level env definitions and reloads correctly.
- `M-GRAPH-08`: Graph panel delete-graph action removes the selected graph and automatically switches to latest remaining graph (or creates a new graph if none remain).
- `M-GRAPH-09`: Graph panel projection background controls persist mode (`solid`/`gradient`) and selected base color for the active projection.
- `M-GRAPH-10`: Graph panel projection controls can add a new projection cloned from current active coordinates/card sizes/background and switch active projection.
- `M-GRAPH-11`: Graph panel projection controls can remove the active non-default projection, while always keeping at least one projection.
- `M-GRAPH-12`: Graph panel connection-stroke controls persist per-graph foreground/background colors and 2x width ratio.
- `M-CANVAS-01`: Wheel zoom in/out keeps pointer-focused zoom and smooth redraw.
- `M-CANVAS-02`: Shift + wheel scrolls horizontally and Alt + wheel scrolls vertically without zoom.
- `M-CANVAS-03`: Holding `Space` while dragging empty space pans viewport.
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
- `M-CANVAS-14`: Pencil color-selection dialog applies chosen draw color (default `#ffffff`) to new strokes.
- `M-CANVAS-15`: Pencil thickness selector applies hairline (1px), 3px, and 9px stroke widths.
- `M-CANVAS-16`: Drawing objects are explicitly created, selectable by handle/title, and can be moved by dragging handle.
- `M-CANVAS-17`: While draw mode is enabled, paths are added to the currently selected drawing object.
- `M-CANVAS-18`: Deleting selected drawing removes all persisted paths and handle from canvas.
- `M-CANVAS-19`: Canvas redraw loop idles when no interactions/effects are active and resumes on the next interaction or status animation trigger.
- `M-CANVAS-20`: `python_process` node graphics output projects below the node card with no in-card frame/padding.
- `M-CANVAS-21`: `numeric_input` node shows an in-card slider; dragging the slider updates and persists the node output value.
- `M-CANVAS-22`: Selected node card resize handle can resize the card on canvas and the new size persists.
- `M-CANVAS-23`: Switching active projection animates node positions/card dimensions/background and does not hard-switch instantly.
- `M-CANVAS-24`: While projection-switch animation is running, projected graphics textures are not reloaded; mip/offscreen reload/disposal resumes after animation completes.
- `M-CANVAS-25`: Two-finger trackpad scroll pans the viewport while pinch zoom and mouse-wheel zoom still zoom in/out.
- `M-CANVAS-26`: Annotation cards render markdown text + TeX/LaTeX math on canvas and support all-side resize handles.
- `M-CANVAS-27`: Connection lines stay visible across mixed bright/dark canvas backgrounds via dual layered strokes.
- `M-CANVAS-28`: Annotation cards can draw incoming/outgoing arrows from any card edge without affecting executable graph behavior.
- `M-CANVAS-29`: Empty-canvas drag marquee-selects nodes and does not pan the viewport when `Space` is not held.
- `M-CANVAS-30`: Multi-selected nodes can be `Ctrl`-toggled/additively marquee-selected, moved/resized together, and deleted together.
- `M-CANVAS-31`: `Alt`-dragging a selected node set leaves the originals in place, drags duplicated nodes, and preserves internal links between the duplicated nodes.
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
- `M-PANEL-11`: Right sidebar panels (Graph, Node, Output) are collapsible in accordion behavior (opening one collapses the others).
- `M-PANEL-12`: Selecting a node from canvas auto-expands the Node panel in the right sidebar accordion.
- `M-PANEL-13`: Diagnostics panel title shows red status when a backend failure exists and the panel body shows a user-readable failure message.
- `M-PANEL-14`: Node panel graphics budget debug shows selected-node `maxPixels` computation inputs/results (viewport scale, estimated/stable maxPixels, selected level, request URL).
- `M-PANEL-15`: Annotation node panel edits markdown/body colors + font size and persists canvas note appearance.
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
- `M-MCP-02`: MCP screenshot renderer uses frontend `canvasOnly` mode and hides floating tool/sidebar windows.
- `M-MCP-04`: MCP graph-edit tools (add/move/rename/code/input/connection/delete) persist through backend and are reflected by `graph_get`.
- `M-MCP-05`: MCP drawing tools can create/move/rename/delete drawings and append drawing paths that appear in `graph_get`.
- `M-MCP-06`: MCP screenshot renderer includes persisted drawing paths and drawing handle labels.
- `M-MCP-07`: MCP Python env tools can add/edit/delete graph env definitions, and env renames/deletes keep node `pythonEnv` references consistent.
- `M-MCP-08`: MCP projection tools can add a projection (cloned from active projection coordinates/card sizes/background by default) and switch active projection state.
- `M-MCP-09`: MCP `bulk_edit` applies ordered graph-edit operations sequentially and persists the final graph state.
- `M-MCP-10`: MCP numeric-input creation tools (`node_add_numeric_input` and `bulk_edit` `node_add_numeric_input`) persist slider nodes that round-trip through `graph_get`.
- `M-MCP-11`: MCP `connections_list` and `connection_set`/`connection_replace` can inspect and atomically rewire one target input without duplicate inbound edges.

## Feature Coverage Map

| Feature (from `FUNCTIONALITY.md`) | Test Cases | Coverage |
| --- | --- | --- |
| Load last opened graph from localStorage on startup | `A-FE-01` | Automated |
| Fallback to latest stored graph when saved graph ID is stale | `A-FE-01` | Automated |
| Auto-create a new graph when no graph exists | `M-GRAPH-01` | Manual |
| Persist graph edits through `PUT /api/graphs/:id` | `A-FE-02`, `A-BE-37` | Automated |
| Optimistic graph updates to avoid UI snap-back during save | `M-GRAPH-02`, `A-FE-24`, `A-E2E-08` | Automated + Manual |
| Graph update conflict detection/reload (`ifMatchUpdatedAt` + `409`) | `A-BE-44`, `A-FE-24`, `A-E2E-08` | Automated |
| Graph query API supports lightweight field projection, BFS/DFS traversal, and starting-vertex discovery (connections always include source/target node ids) | `A-BE-59`, `A-BE-60`, `A-BE-61`, `A-BE-62`, `A-BE-63`, `A-BE-64` | Automated |
| Graph panel graph selection | `M-GRAPH-03` | Manual |
| Graph panel graph creation | `M-GRAPH-04` | Manual |
| Graph panel graph rename | `M-GRAPH-05` | Manual |
| Graph panel graph deletion with fallback graph selection | `A-FE-16`, `A-E2E-02`, `A-BE-36`, `M-GRAPH-08` | Automated + Manual |
| Graph panel projection management (add + select + remove active projection) | `M-GRAPH-10`, `M-GRAPH-11` | Manual |
| Graph updates reject removing all projections (at least one projection must remain) | `A-BE-43`, `M-GRAPH-11` | Automated + Manual |
| Connections-only graph updates preserve node layout/projection metadata | `A-BE-56` | Automated |
| New projection coordinates/card sizes/background clone from previously active projection | `A-FE-21`, `M-GRAPH-10`, `M-MCP-08` | Automated + Manual |
| Graph panel Python env management | `M-GRAPH-07` | Manual |
| Graph panel projection background management (`solid`/`gradient` + base color) | `A-BE-38`, `A-BE-42`, `A-FE-19`, `M-GRAPH-09`, `M-GRAPH-10` | Automated + Manual |
| Graph panel connection stroke management (per-graph colors + widths, 2x background ratio) | `A-BE-57`, `A-BE-58`, `A-FE-29`, `A-E2E-16`, `M-GRAPH-12` | Automated + Manual |
| Current graph ID visibility in UI | `M-GRAPH-06` | Manual |
| Right sidebar Graph/Node/Output/Diagnostics panels collapse as accordion | `A-E2E-03`, `M-PANEL-11` | Automated + Manual |
| Selecting a node auto-expands Node panel accordion section | `A-E2E-04`, `M-PANEL-12` | Automated + Manual |
| Canvas remains full viewport while toolbar/right sidebar render as draggable floating windows during resize | `A-E2E-17` | Automated |
| Toolbar add-node dialog layers outside the floating toolbar container (not clipped/embedded) | `A-E2E-19` | Automated |
| Shared color-selection dialogs layer outside floating windows and are not clipped by narrow panel client areas | `A-E2E-24` | Automated |
| Shared color-selection dialogs support hue, saturation/value, RGB, and optional opacity controls | `A-E2E-25`, `A-FE-35` | Automated |
| Frontend `canvasOnly` mode hides floating toolbar/sidebar windows and keeps MCP screenshot bridge available | `A-E2E-18`, `M-MCP-02` | Automated + Manual |
| Diagnostics panel surfaces backend failures with collapsed red status and human-readable message | `A-E2E-06`, `A-FE-18`, `M-PANEL-13` | Automated + Manual |
| Canvas node titles are ellipsized to fit card width and avoid overlap | `A-FE-17` | Automated |
| Canvas per-projection background rendering (solid or base-color-driven gradient) | `A-FE-19`, `A-BE-42`, `M-GRAPH-09`, `M-GRAPH-10` | Automated + Manual |
| Pixi.js canvas renderer for nodes/connectors | `M-CANVAS-11` | Manual |
| Pixi canvas redraw loop is demand-driven and idles when no interactions/effects are active | `A-FE-11`, `M-CANVAS-19` | Automated + Manual |
| Mouse wheel zoom | `A-E2E-10`, `M-CANVAS-01` | Automated + Manual |
| Pinch zoom | `A-E2E-10`, `M-CANVAS-25` | Automated + Manual |
| Two-finger trackpad scroll pans viewport | `A-E2E-10`, `A-FE-26`, `M-CANVAS-25` | Automated + Manual |
| Modifier wheel directional scroll (`Shift` horizontal, `Alt` vertical) | `A-E2E-10`, `A-FE-26`, `M-CANVAS-02` | Automated + Manual |
| Empty-canvas `Space`-drag pans viewport | `A-E2E-21`, `M-CANVAS-03` | Automated + Manual |
| Empty-canvas drag marquee-selects nodes without panning | `A-E2E-21`, `M-CANVAS-29` | Automated + Manual |
| Multi-node selection supports `Ctrl` toggle/additive marquee without browser context menu interference, shared move/resize, and delete | `A-E2E-21`, `A-FE-31`, `M-CANVAS-30` | Automated + Manual |
| Alt-dragging a selected node set duplicates the nodes, preserves their internal links, and keeps the duplicate set selected | `A-E2E-23`, `A-FE-34`, `M-CANVAS-31` | Automated + Manual |
| Shared node-card background/border colors can be edited across the full selected node set | `A-E2E-22`, `A-FE-32` | Automated |
| Drag-to-move nodes with persisted positions | `A-FE-02`, `A-FE-22`, `A-E2E-13`, `M-CANVAS-04` | Automated + Manual |
| Node positions are stored per active projection | `A-FE-22`, `A-BE-41`, `M-GRAPH-10`, `M-MCP-08` | Automated + Manual |
| Node card dimensions are stored per active projection | `A-FE-23`, `A-BE-41`, `M-GRAPH-10`, `M-MCP-08` | Automated + Manual |
| Node card size normalization preserves oversized values (no fixed max cap) | `A-FE-25`, `A-BE-45`, `A-MCP-01` | Automated |
| Edge rendering with Bezier curves and dual-layer visibility stroke | `A-FE-29`, `A-E2E-16`, `M-CANVAS-07`, `M-CANVAS-27` | Automated + Manual |
| Edge hit-testing and selection | `M-CANVAS-07` | Manual |
| Delete selected edge with `Delete`/`Backspace` | `M-CANVAS-07` | Manual |
| Delete selected node with `Delete`/`Backspace` | `M-CANVAS-08` | Manual |
| Connector hover highlighting | `M-CANVAS-05` | Manual |
| Drag output to input to create connection | `M-CANVAS-06` | Manual |
| Dragging a new edge onto an occupied input rewires that slot instead of persisting duplicate inbound edges | `A-E2E-26`, `A-FE-36`, `A-FE-37`, `M-MCP-11` | Automated + Manual |
| Frontend cycle-prevention during connection creation | `M-CANVAS-09` | Manual |
| Canvas projects `python_process` graphics outputs below node cards (no in-card frame/padding) | `A-FE-12`, `A-FE-13`, `A-FE-14`, `M-CANVAS-20` | Automated + Manual |
| Graphics mip selection favors sharper levels for a given viewport budget | `A-E2E-09` | Automated |
| Canvas `numeric_input` nodes render interactive in-card slider controls | `A-E2E-01`, `M-CANVAS-21` | Automated + Manual |
| Canvas node cards support drag-resize with persisted dimensions | `A-E2E-05`, `A-FE-23`, `M-CANVAS-22` | Automated + Manual |
| Annotation cards render markdown + TeX/LaTeX in a canvas-synced overlay | `A-E2E-14`, `M-CANVAS-26` | Automated + Manual |
| Annotation cards support all-side resize handles with persisted size/position | `A-E2E-14`, `M-CANVAS-26` | Automated + Manual |
| Annotation cards support presentation-only arrows from arbitrary card edges | `A-E2E-20`, `A-FE-30`, `A-FE-33`, `M-CANVAS-28` | Automated + Manual |
| Graph traversal/query includes annotation nodes and annotation-linked anchors | `A-BE-67`, `A-MCP-05` | Automated |
| Projection switch animates node layout/background and defers graphics reload decisions until transition end | `M-CANVAS-23`, `M-CANVAS-24` | Manual |
| Minimap/navigation assistant click-to-center | `M-CANVAS-10` | Manual |
| Node selection keeps viewport stable (no jump/reset) | `M-CANVAS-12` | Manual |
| Canvas pencil draw mode | `M-CANVAS-13` | Manual |
| Canvas pencil color selection via reusable color dialog (default white) | `A-FE-20`, `A-BE-39`, `M-CANVAS-14` | Automated + Manual |
| Canvas pencil thickness selection (1/3/9 px) | `M-CANVAS-15` | Manual |
| Draw-toolbar hint text wraps without horizontal overflow in the narrow toolbar panel | `A-E2E-07` | Automated |
| Persistent drawing objects (create/select/move/delete) | `A-FE-09`, `A-FE-10`, `A-BE-31`, `A-BE-32`, `A-BE-33`, `M-CANVAS-16`, `M-CANVAS-17`, `M-CANVAS-18` | Automated + Manual |
| Edit node display name | `M-PANEL-01` | Manual |
| Edit runtime for inline-code node | `A-FE-03`, `A-FE-04`, `A-BE-01` | Automated |
| Edit inline-code node `pythonEnv` binding | `A-FE-08`, `A-BE-21`, `M-PANEL-08` | Automated + Manual |
| Edit selected drawing metadata (name/delete) | `M-PANEL-09`, `M-CANVAS-18` | Manual |
| Edit inline-code source with stable local draft and save-on-blur | `A-E2E-15`, `M-PANEL-07` | Automated + Manual |
| Input management: add/rename/reorder/delete | `M-PANEL-02`, `M-PANEL-03`, `M-PANEL-04`, `M-PANEL-05` | Manual |
| Numeric input settings (`value`, `min`, `max`, `step`) | `A-FE-15`, `A-E2E-01`, `M-PANEL-10`, `M-CANVAS-21` | Automated + Manual |
| Annotation node editing (`markdown` content + note colors, including border/opacity via shared color dialog, plus font size) | `A-E2E-14`, `A-FE-28`, `M-PANEL-15` | Automated + Manual |
| Node panel summarizes multi-node selection as a set preview instead of a single node title | `A-E2E-22` | Automated |
| Input rename/delete propagation to connections | `M-PANEL-03`, `M-PANEL-05` | Manual |
| Toggle auto-recompute per node | `M-PANEL-06` | Manual |
| Run selected node manually | `M-COMPUTE-01` | Manual |
| Per-node execution state in store | `A-FE-06`, `A-FE-07`, `A-BE-48`, `M-STATUS-01`, `M-STATUS-02`, `M-STATUS-03`, `M-STATUS-04` | Automated + Manual |
| Card status light (red/amber/brown/green/gray) | `M-STATUS-01`, `M-STATUS-02`, `M-STATUS-03`, `M-STATUS-04` | Manual |
| Node panel execution error text | `M-STATUS-02` | Manual |
| Node panel graphics budget debug for selected projected-graphics node | `M-PANEL-14` | Manual |
| Error-state smoke effect on node cards | `M-STATUS-05` | Manual |
| Compute entire graph from toolbar | `M-COMPUTE-02` | Manual |
| Compute single selected node from node panel | `M-COMPUTE-01` | Manual |
| Deterministic recomputation by node version + deps timestamps | `A-BE-08` | Automated |
| Inbound connection topology updates invalidate affected target nodes for recomputation | `A-BE-46` | Automated |
| Persist outputs/schema/text/graphics | `A-BE-09`, `A-BE-13` | Automated |
| Output panel shows text/graphics for selected node | `M-COMPUTE-01` | Manual |
| Cached frontend node graphics outputs hydrate from persisted results and refresh on compute | `A-FE-12`, `A-FE-13`, `A-FE-14` | Automated |
| Output refresh retry after compute (persistence lag) | `M-COMPUTE-03` | Manual |
| Frontend graph updates do not run local auto-recompute chains | `A-FE-05` | Automated |
| Auto-recompute downstream nodes on graph updates (backend-driven) | `A-BE-48`, `M-PANEL-06`, `M-COMPUTE-02` | Automated + Manual |
| Graph update API optional recompute suppression (`PUT /api/graphs/:id?noRecompute=true`) | `A-BE-55` | Automated |
| Auto-recompute pending status includes impacted descendants | `A-BE-48`, `M-STATUS-01` | Automated + Manual |
| Graph-level recompute worker concurrency is configurable | `A-BE-47`, `A-E2E-11` | Automated |
| Auto-recompute execution order is upstream to downstream | `M-COMPUTE-02` | Manual |
| Auto-recompute marks downstream stale when upstream errors and skips affected downstream runs | `M-STATUS-04` | Manual |
| Backend request validation via Zod | `A-BE-02`, `A-BE-03` | Automated |
| Reject duplicate inbound connections on the same target slot | `A-BE-68`, `A-FE-36`, `A-FE-37`, `M-MCP-11` | Automated + Manual |
| Graph-level script execution timeout is configurable (default 30 seconds, no max cap) | `A-BE-49`, `A-BE-50`, `A-BE-51`, `A-E2E-12`, `A-FE-27` | Automated |
| Graph python env names are unique | `A-BE-22` | Automated |
| MCP graph Python env management | `M-MCP-07` | Manual |
| Node `pythonEnv` references are valid and runtime-compatible | `A-BE-23`, `A-BE-24`, `A-BE-26`, `A-BE-27` | Automated |
| Validate missing node references in connections | `M-VALID-01` | Manual |
| Reject cycles on `POST` | `A-BE-05` | Automated |
| Reject cycle-introducing connection changes on `PUT` | `A-BE-06` | Automated |
| Reject updates on legacy cyclic graphs | `A-BE-07` | Automated |
| NodeExecutor supports inline/library/subgraph/external/numeric I/O | `A-BE-10`, `A-BE-11`, `A-BE-12`, `A-BE-34`, `A-BE-35` | Automated |
| Annotation nodes are non-executable presentation nodes and annotation-linked edges stay out of DAG validation/execution | `A-BE-52`, `A-BE-53`, `A-BE-65`, `A-BE-66` | Automated |
| Default inline runtime `javascript_vm` | `A-FE-03`, `A-BE-10` | Automated |
| Python inline runtime `python_process` | `A-BE-16`, `A-BE-17`, `A-BE-18`, `A-BE-19`, `A-BE-20`, `A-BE-21`, `A-BE-25`, `A-BE-28`, `A-BE-29`, `A-BE-30` | Automated |
| Pluggable runtime architecture in place | `A-BE-10`, `A-BE-11`, `A-BE-12` | Automated |
| Playwright-based canvas snapshot script | `README.md` snapshot command + `packages/frontend/scripts/captureCanvasSnapshot.mjs` | Manual |
| MCP graph-query tool validation coverage | `A-MCP-05` | Automated |
| MCP graph-edit API coverage | `A-MCP-02`, `A-MCP-03`, `A-MCP-04`, `A-MCP-09`, `A-MCP-10`, `M-MCP-04`, `M-MCP-07`, `M-MCP-08`, `M-MCP-09`, `M-MCP-10`, `M-MCP-11` | Automated + Manual |
| MCP drawing-edit API coverage | `M-MCP-05` | Manual |
| MCP internal rectangle screenshot (`graph_screenshot_region`) | `M-MCP-01`, `M-MCP-02`, `M-MCP-06` | Manual |

## Open Gaps

- Automated UI e2e coverage is currently limited to numeric slider drag/cursor behavior, graph deletion confirmation flow, sidebar accordion behaviors, node card resize, diagnostics error surfacing, draw-toolbar hint wrapping, conflict reload on stale local save, graphics mip-selection quality bias, wheel navigation behaviors, graph recompute concurrency setting persistence, graph execution timeout persistence, node-drag stability during polling rerenders, annotation markdown/TeX resize flows, annotation edge-arrow creation, inline-code output-port sync on source edit, graph connection-stroke settings persistence, floating-panel resize behavior, canvas-only screenshot mode, toolbar add-node dialog layering, shared color-dialog layering, shared hue/saturation-value color picking, canvas multi-selection/space-pan interactions, node-panel multi-selection shared color editing, selection Alt-drag duplication, and inline-input connection replacement (`A-E2E-01`, `A-E2E-02`, `A-E2E-03`, `A-E2E-04`, `A-E2E-05`, `A-E2E-06`, `A-E2E-07`, `A-E2E-08`, `A-E2E-09`, `A-E2E-10`, `A-E2E-11`, `A-E2E-12`, `A-E2E-13`, `A-E2E-14`, `A-E2E-15`, `A-E2E-16`, `A-E2E-17`, `A-E2E-18`, `A-E2E-19`, `A-E2E-20`, `A-E2E-21`, `A-E2E-22`, `A-E2E-23`, `A-E2E-24`, `A-E2E-25`, `A-E2E-26`).
- No committed automated frontend tests yet for node panel input editing and backend recompute-status polling UI workflows.
- Missing-node-reference API validation has documented manual case only (`M-VALID-01`) and should gain an automated backend test.
