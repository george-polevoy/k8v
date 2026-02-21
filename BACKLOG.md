# k8v Backlog

Backlog is organized top-down by delivery order. Work should be pulled from the highest-priority open item first.

## Workflow

1. Pick the next `IN PROGRESS` or top `TODO` item.
2. Implement with tests or reproducible verification.
3. Update `FUNCTIONALITY.md` when behavior changes.
4. Mark item `DONE` with a short verification note.

## Current Sprint

### B-001 Canvas Refactor and Interaction Parity
Status: DONE

- Replace ReactFlow canvas with Pixi.js renderer.
- Support zoom, pan, scroll, connector drag-create, edge selection/deletion, minimap click-to-center.
- Verification:
  - headless Playwright interaction runs
  - `npm run test`
  - `npm run build`

### B-002 Node Panel Editing Capabilities
Status: DONE

- Add card name editing.
- Add input management in node panel: add, rename, reorder, delete.
- Keep graph connections consistent for input rename/delete.
- Verification:
  - manual/Playwright interaction checks
  - `npm run test`

### B-003 Node Recompute Toggle and Status Indicators
Status: DONE

- Add per-node auto-recompute toggle.
- Trigger auto-recompute on downstream impacted nodes after upstream graph changes.
- Add node card status light (error/computing/auto-recompute/idle).
- Show node error state in node panel.
- Verification:
  - headless browser scenario checks for create, drag persistence, edge/node deletion
  - `npm run test`

## Next Priority

### B-004 Port Editing Expansion (Outputs)
Status: TODO

- Add output port editing in node panel with connection-safe rename/delete behavior.
- Add ordering controls for output ports.
- Add schema type editing for ports.

### B-005 Compute Observability
Status: IN PROGRESS

- Add per-node compute history view (timestamp, status, duration).
- Distinguish runtime error vs transport/API error in UI.
- Provide clear stale-result vs fresh-result indicator. (DONE: downstream stale state + brown indicator on upstream error propagation)
- Add visual error-state cue for fast scanning. (DONE: subtle black smoke emission from errored nodes)

### B-006 Canvas UX Quality
Status: IN PROGRESS

- Add marquee node selection and multi-select operations.
- Add keyboard shortcuts reference and discoverability.
- Add optional edge reroute handles.
- Add pencil freehand annotations with limited style presets. (DONE: white/green/red and hairline/3px/9px options in toolbar)

### B-007 Automated UI Regression Coverage
Status: TODO

- Add Playwright e2e coverage for canvas navigation: zoom, pan, minimap click-to-center.
- Add Playwright e2e coverage for connection workflows: hover cue, drag-create, select/delete.
- Add Playwright e2e coverage for node panel editing: rename node, add/rename/reorder/delete inputs.
- Add automated checks for auto-recompute toggle and status indicator transitions.
- Add backend API test for missing-node-reference connection validation.

### B-008 MCP Agent Editing + Screenshot API
Status: IN PROGRESS

- Expose graph-editing operations via MCP for agent-driven node and connection changes. (DONE)
- Provide internal Playwright screenshot rendering endpoint for fixed rectangle captures. (DONE)
- Overlay stable unique concise node numbers in screenshots for OCR/agent targeting. (DONE)
- Add automated MCP integration tests for graph edit operations and screenshot size/region assertions.

### B-009 Python Backend Runtime
Status: DONE

- Add backend `python_process` execution runtime for inline nodes. (DONE)
- Wire runtime registry so NodeExecutor resolves Python runtime by id. (DONE)
- Add runtime selection options in frontend node creation and node panel runtime selector. (DONE)
- Add backend regression tests for python runtime execution, errors, timeout, and API acceptance. (DONE)
