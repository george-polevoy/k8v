# k8v Refactor Tracker

Last updated: March 4, 2026.

This tracker breaks refactor work into small, independent tasks so we can ship incrementally.

## Working Rules

1. Do one task at a time.
2. Keep each task behavior-preserving unless explicitly noted.
3. Add or run relevant tests before marking a task `DONE`.
4. Update docs (`FUNCTIONALITY.md`, `TEST_CASES.md`) only when behavior or coverage changes.

## LOC Tracking

Baseline snapshot was taken from `HEAD` before refactor edits in this branch/worktree.

### T-001 LOC Delta (before vs current)

| File | Before LOC | Current LOC | Delta |
| --- | ---: | ---: | ---: |
| `packages/frontend/src/components/NodePanel.tsx` | 2093 | 2079 | -14 |
| `packages/frontend/src/components/GraphPanel.tsx` | 1475 | 1461 | -14 |
| `packages/frontend/src/utils/panelGraphHelpers.ts` | 0 | 16 | +16 |
| **Net** | **3568** | **3556** | **-12** |

### T-002 LOC Delta (before vs current)

| File | Before LOC | Current LOC | Delta |
| --- | ---: | ---: | ---: |
| `packages/frontend/src/components/NodePanel.tsx` | 2079 | 2040 | -39 |
| `packages/frontend/src/components/GraphPanel.tsx` | 1461 | 1422 | -39 |
| `packages/frontend/src/utils/panelPythonEnvHelpers.ts` | 0 | 121 | +121 |
| `packages/frontend/tests/panelPythonEnvHelpers.test.ts` | 0 | 105 | +105 |
| **Net** | **3540** | **3688** | **+148** |

### T-003 LOC Delta (before vs current)

| File | Before LOC | Current LOC | Delta |
| --- | ---: | ---: | ---: |
| `packages/frontend/src/components/NodePanel.tsx` | 2040 | 2049 | +9 |
| `packages/frontend/tests/e2e/nodePanelDraftStability.test.ts` | 0 | 143 | +143 |
| **Net** | **2040** | **2192** | **+152** |

### T-008 LOC Delta (before vs current)

| File | Before LOC | Current LOC | Delta |
| --- | ---: | ---: | ---: |
| `packages/mcp-server/src/index.ts` | 4149 | 4379 | +230 |
| `packages/mcp-server/tests/screenshotParity.test.ts` | 0 | 193 | +193 |
| **Net** | **4149** | **4572** | **+423** |

### T-009 LOC Delta (before vs current)

| File | Before LOC | Current LOC | Delta |
| --- | ---: | ---: | ---: |
| `packages/frontend/src/components/Canvas.tsx` | 4318 | 4317 | -1 |
| `packages/frontend/src/utils/canvasBackground.ts` | 77 | 24 | -53 |
| `packages/frontend/src/utils/connectionStroke.ts` | 103 | 19 | -84 |
| `packages/mcp-server/src/index.ts` | 4149 | 4289 | +140 |
| `packages/shared/src/*` + `packages/shared/package.json` | 0 | 280 | +280 |
| **Net** | **8647** | **8929** | **+282** |

## Current Hotspots

| ID | Area | Current State | Why Refactor |
| --- | --- | --- | --- |
| R-001 | `packages/frontend/src/components/Canvas.tsx` | ~4318 lines | Monolithic: rendering, input handling, effects, minimap, and texture lifecycle are tightly coupled. |
| R-002 | `packages/frontend/src/components/NodePanel.tsx` | ~2079 lines | Mixed concerns: node editing + graph management + drawing controls in one component. |
| R-003 | `packages/frontend/src/components/GraphPanel.tsx` | ~1461 lines | Overlaps heavily with NodePanel graph-admin logic and UI patterns. |
| R-004 | Shared helpers duplicated | Multiple files | Repeated helper functions increase drift risk and maintenance cost. |
| R-005 | Node panel draft sync | `NodePanel.tsx` effects | Draft values can reset during unrelated graph updates. |
| R-006 | MCP screenshot renderer parity | `packages/mcp-server/src/index.ts` (`RENDERER_HTML`) | Screenshot renderer is a separate canvas implementation and can drift from user-visible frontend canvas. |

## Refactor Queue

### T-001 Extract shared panel graph helpers
Status: DONE

Scope:
- Create shared util(s) for:
  - graph option label formatting
  - next Python env name generation
- Replace duplicated local helpers in:
  - `NodePanel.tsx`
  - `GraphPanel.tsx`

Out of scope:
- UI structure changes
- behavior changes

Verification:
- `npm run lint`
- `npm run test -- packages/frontend/tests`
- `npm run build`
- `npm run test:e2e`

Current LOC result:
- `NodePanel.tsx`: `2093 -> 2079` (`-14`)
- `GraphPanel.tsx`: `1475 -> 1461` (`-14`)
- new shared util: `+16`
- net: `-12`

Verification result:
- `npm run lint`: pass
- `npm run test`: pass (`167` tests, `0` fail)
- `npm run build`: pass
- `npm run test:e2e`: pass (`22` tests, `0` fail)

### T-002 Extract shared Python env draft logic
Status: DONE

Scope:
- Extract Python env draft edit/validate/save logic used in both panels.
- Keep existing data model and validation messages.

Out of scope:
- backend/API changes

Verification:
- Existing frontend tests pass
- Manual check of Python env add/edit/delete/save in Graph panel

Delivered:
- Added shared Python env draft helpers in `packages/frontend/src/utils/panelPythonEnvHelpers.ts`:
  - draft field update/add/delete
  - draft normalization + validation with existing validation messages
  - save-plan construction that trims env data and clears invalid node `pythonEnv` references
- Refactored `NodePanel.tsx` and `GraphPanel.tsx` to reuse shared Python env draft/edit/commit helpers.
- Added unit coverage in `packages/frontend/tests/panelPythonEnvHelpers.test.ts` for:
  - draft update/add/delete behavior
  - trim + validation behavior
  - invalid node `pythonEnv` reference cleanup during save planning

Verification result:
- `npm run lint`: pass
- `npm run test`: pass (`174` tests, `0` fail)
- `npm run build`: pass
- `npm run test:e2e`: pass (`22` tests, `0` fail)

### T-003 Stabilize NodePanel drafts (prevent unintended resets)
Status: DONE

Scope:
- Narrow effect dependencies so node draft fields do not reset on unrelated graph updates.
- Add regression coverage for draft stability during background updates.

Out of scope:
- UI redesign

Verification:
- Add/extend frontend test(s) for draft persistence
- Run targeted e2e/manual check for node panel editing

Delivered:
- Updated `NodePanel.tsx` draft hydration effect to gate resets by selected-node identity/version changes, preventing local draft resets on unrelated graph updates.
- Added e2e regression coverage in `packages/frontend/tests/e2e/nodePanelDraftStability.test.ts`:
  - keeps a node-name draft in-progress
  - triggers an unrelated graph update in the background
  - verifies the draft value is preserved

Verification result:
- `npm run lint`: pass
- `npm run test`: pass (`174` tests, `0` fail)
- `npm run build`: pass
- `npm run test:e2e`: pass (`23` tests, `0` fail)

### T-004 Extract numeric input config utilities
Status: TODO

Scope:
- Move duplicated numeric config helpers into shared util.
- Reuse from `NodePanel.tsx` and `Canvas.tsx`.

Out of scope:
- numeric behavior changes

Verification:
- Existing numeric input tests pass
- `npm run lint`

### T-005 Canvas split phase 1: pure helpers
Status: TODO

Scope:
- Move pure helper functions from `Canvas.tsx` into focused utility modules.
- Keep runtime behavior unchanged.

Out of scope:
- interaction flow rewrites

Verification:
- Frontend tests pass
- Manual smoke test for canvas load/zoom/pan/connect

### T-006 Canvas split phase 2: interaction handlers
Status: TODO

Scope:
- Extract pointer/keyboard/wheel handlers into a dedicated module or hook.
- Keep current UX behavior and shortcuts.

Out of scope:
- feature additions

Verification:
- Relevant e2e tests pass (wheel navigation, slider drag, drag stability, etc.)

### T-007 Canvas split phase 3: rendering/effects lifecycle
Status: TODO

Scope:
- Separate graph render pass, effect pass, and texture cache lifecycle.
- Preserve current animation and graphics behavior.

Out of scope:
- visual redesign

Verification:
- Existing graphics/projection tests pass
- Manual smoke for projections, graphics output, and minimap

### T-008 MCP screenshot parity audit + regression tests
Status: DONE

Scope:
- Compare MCP `graph_screenshot_region` renderer output against frontend canvas for the same graph state.
- Add/extend tests that catch visual drift for core elements (background, connections, node geometry, annotations, drawings).

Out of scope:
- full renderer rewrite

Verification:
- MCP server tests pass
- New/updated screenshot parity test(s) pass

Delivered:
- `graph_screenshot_region` renderer now honors graph background mode/base color (`solid` or `gradient`) instead of a hardcoded gradient.
- Renderer now uses graph connection stroke colors/widths (foreground + background layers).
- Renderer now respects persisted node card width/height (`cardWidth`/`cardHeight`) rather than fixed node width.
- Added automated parity regression tests:
  - solid background color fidelity
  - connection stroke foreground/background rendering
  - persisted card width rendering

Verification result:
- `npm run lint`: pass
- `npm run test`: pass (`170` tests, `0` fail)
- `npm run build`: pass
- `npm run test:e2e`: pass (`22` tests, `0` fail)

### T-009 Reduce MCP renderer duplication
Status: DONE

Scope:
- Refactor duplicated rendering constants/logic between frontend canvas and MCP renderer into shared/reused definitions where practical.
- Prioritize high-drift areas first (background/stroke/card geometry).

Out of scope:
- changing tool contract for `graph_screenshot_region`

Verification:
- `npm run test`
- `npm run test:e2e`
- MCP screenshot regression/parity tests pass

Delivered:
- Added shared renderer utilities in `packages/shared/src/` for:
  - canvas background normalization + gradient stop derivation
  - graph connection stroke normalization
  - standard node card geometry constants + sizing helpers
- Frontend now reuses shared background/stroke logic (`canvasBackground.ts`, `connectionStroke.ts`) and shared node sizing primitives in `Canvas.tsx`.
- MCP server now reuses the same shared background/stroke/node geometry definitions for graph normalization and fallback card sizing.
- `RENDERER_HTML` now injects shared defaults (background, connection stroke, node geometry) and consumes precomputed `backgroundGradientStops` from normalized screenshot payload.
- `renderGraphRegionScreenshot` now normalizes renderer payload data once (background, stroke, and node `cardWidth`/`cardHeight`) before browser-side rendering.

Verification result:
- `npx tsx --test packages/mcp-server/tests/screenshotParity.test.ts`: pass (`3` tests, `0` fail)
- `npm run lint`: pass
- `npm run test`: pass (`170` tests, `0` fail)
- `npm run build`: pass
- `npm run test:e2e`: pass on rerun (`22` tests, `0` fail); first run had one transient failure in `inlineCodeOutputPortSync.test.ts`, then passed in isolation and full-suite rerun

## Current Focus

Next task to execute: `T-004 Extract numeric input config utilities`.
