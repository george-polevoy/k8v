# k8v Refactor Tracker

Last updated: March 7, 2026.

This tracker breaks refactor work into small, independent tasks so we can ship incrementally.

## Working Rules

1. Do one task at a time.
2. Keep each task behavior-preserving unless explicitly noted.
3. Add or run relevant tests before marking a task `DONE`.
4. Update docs (`FUNCTIONALITY.md`, `TEST_CASES.md`) only when behavior or coverage changes.
5. Treat large source files as a default factoring signal: `>1000` LOC enters the queue and `>1500` LOC is urgent unless there is a clear justification.
6. After a slice is verified and committed, continue directly to the next queued slice unless blocked by unrelated failures or explicit user reprioritization.

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

### T-004 LOC Delta (before vs current)

| File | Before LOC | Current LOC | Delta |
| --- | ---: | ---: | ---: |
| `packages/frontend/src/components/NodePanel.tsx` | 2049 | 2000 | -49 |
| `packages/frontend/src/components/Canvas.tsx` | 4317 | 4267 | -50 |
| `packages/frontend/src/utils/numericInput.ts` | 0 | 59 | +59 |
| **Net** | **6366** | **6326** | **-40** |

### T-005 LOC Delta (before vs current)

| File | Before LOC | Current LOC | Delta |
| --- | ---: | ---: | ---: |
| `packages/frontend/src/components/Canvas.tsx` | 4267 | 4207 | -60 |
| `packages/frontend/src/utils/canvasHelpers.ts` | 0 | 70 | +70 |
| `packages/frontend/tests/canvasHelpers.test.ts` | 0 | 60 | +60 |
| **Net** | **4267** | **4337** | **+70** |

### T-006 LOC Delta (before vs current)

| File | Before LOC | Current LOC | Delta |
| --- | ---: | ---: | ---: |
| `packages/frontend/src/components/Canvas.tsx` | 4207 | 4192 | -15 |
| `packages/frontend/src/utils/canvasInteractions.ts` | 0 | 184 | +184 |
| `packages/frontend/tests/canvasInteractions.test.ts` | 0 | 193 | +193 |
| **Net** | **4207** | **4569** | **+362** |

### T-007 LOC Delta (before vs current)

| File | Before LOC | Current LOC | Delta |
| --- | ---: | ---: | ---: |
| `packages/frontend/src/components/Canvas.tsx` | 4192 | 3729 | -463 |
| `packages/frontend/src/utils/canvasTextureCache.ts` | 0 | 191 | +191 |
| `packages/frontend/src/utils/canvasEffects.ts` | 0 | 370 | +370 |
| `packages/frontend/src/utils/canvasRenderLifecycle.ts` | 0 | 79 | +79 |
| `packages/frontend/src/utils/canvasNodeRender.ts` | 0 | 232 | +232 |
| `packages/frontend/src/utils/canvasViewportFit.ts` | 0 | 95 | +95 |
| `packages/frontend/tests/canvasTextureCache.test.ts` | 0 | 80 | +80 |
| `packages/frontend/tests/canvasEffects.test.ts` | 0 | 176 | +176 |
| `packages/frontend/tests/canvasRenderLifecycle.test.ts` | 0 | 97 | +97 |
| `packages/frontend/tests/canvasNodeRender.test.ts` | 0 | 185 | +185 |
| `packages/frontend/tests/canvasViewportFit.test.ts` | 0 | 84 | +84 |
| `packages/frontend/tests/e2e/panelAccordion.test.ts` | 174 | 190 | +16 |
| `packages/frontend/tests/e2e/nodePanelDraftStability.test.ts` | 143 | 88 | -55 |
| **Net** | **4509** | **5596** | **+1087** |

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

### T-010 LOC Delta (before vs current)

| File | Before LOC | Current LOC | Delta |
| --- | ---: | ---: | ---: |
| `packages/frontend/src/components/NodePanel.tsx` | 2000 | 1576 | -424 |
| `packages/frontend/src/components/GraphPanel.tsx` | 1422 | 1000 | -422 |
| `packages/frontend/src/components/useGraphManagementState.ts` | 0 | 205 | +205 |
| `packages/frontend/src/components/GraphManagementControls.tsx` | 0 | 229 | +229 |
| `packages/frontend/src/components/PythonEnvironmentSection.tsx` | 0 | 168 | +168 |
| **Net** | **3422** | **3178** | **-244** |

### T-011 LOC Delta (before vs current)

| File | Before LOC | Current LOC | Delta |
| --- | ---: | ---: | ---: |
| `packages/frontend/src/store/graphStore.ts` | 1348 | 910 | -438 |
| `packages/frontend/src/store/graphStorePersistence.ts` | 0 | 210 | +210 |
| `packages/frontend/src/store/graphStoreTypes.ts` | 0 | 44 | +44 |
| `packages/frontend/src/store/graphStoreState.ts` | 0 | 229 | +229 |
| `packages/frontend/src/store/graphApi.ts` | 0 | 49 | +49 |
| `packages/frontend/src/store/graphLocalStorage.ts` | 0 | 36 | +36 |
| `packages/frontend/src/store/recomputeStatusPolling.ts` | 0 | 76 | +76 |
| `packages/frontend/src/App.tsx` | 74 | 94 | +20 |
| `packages/frontend/tests/graphStore.test.ts` | 1483 | 1551 | +68 |
| `packages/frontend/tests/e2e/nodePanelDraftStability.test.ts` | 88 | 97 | +9 |
| `packages/frontend/tests/e2e/support/browser.ts` | 56 | 75 | +19 |
| **Net** | **3049** | **3371** | **+322** |

## Current Hotspots

| ID | Area | Current LOC | Why Refactor |
| --- | --- | ---: | --- |
| R-001 | `packages/frontend/src/components/Canvas.tsx` | 3808 | Still owns Pixi lifecycle, render passes, interactions, overlays, minimap, and MCP screenshot bridge behavior in one component. |
| R-002 | `packages/mcp-server/src/index.ts` | 3759 | Entry point is carrying DTOs, graph-edit orchestration, screenshot rendering, retry/state helpers, and tool registration. |
| R-003 | `packages/frontend/src/components/NodePanel.tsx` | 1576 | Reduced by T-010, but it still mixes node editing, drawing editing, diagnostics, and an embedded graph-management entry point. |
| R-004 | `packages/frontend/src/store/graphStore.ts` | 910 | Reduced by T-011 phase 2, but compute, selection, drawing, and remaining graph-edit actions still live in one Zustand store file. |
| R-005 | `packages/backend/src/app.ts` | 1260 | Express transport is still mixed with graph normalization, validation, projection behavior, and query traversal logic. |
| R-006 | `packages/frontend/src/components/GraphPanel.tsx` | 1000 | Shared graph-admin scaffolding is extracted, but graph-specific settings still need section-level decomposition. |

## Large Test Watchlist

| Area | Current LOC | Why Watch |
| --- | ---: | --- |
| `packages/backend/tests/app.test.ts` | 2146 | Backend route/service extraction in T-012 should let this split by route domain instead of one oversized integration file. |
| `packages/frontend/tests/graphStore.test.ts` | 1551 | Store decomposition in T-011 should let this split by slice/service and keep failures easier to localize. |

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
Status: DONE

Scope:
- Move duplicated numeric config helpers into shared util.
- Reuse from `NodePanel.tsx` and `Canvas.tsx`.

Out of scope:
- numeric behavior changes

Verification:
- Existing numeric input tests pass
- `npm run lint`

Delivered:
- Added `packages/frontend/src/utils/numericInput.ts` with shared helpers:
  - `normalizeNumericInputConfig`
  - `snapNumericInputValue`
  - `formatNumericInputValue`
- Refactored `NodePanel.tsx` to remove duplicated numeric config helper definitions and reuse shared normalization helper.
- Refactored `Canvas.tsx` to remove duplicated numeric helper definitions/interfaces and reuse shared formatting/normalization/snap helpers.
- Preserved existing behavior and kept `Canvas.tsx` local `toFiniteNumber` helper for unrelated card-size fallback logic.

Verification result:
- `npm run lint`: pass
- `npm run test`: pass (`174` tests, `0` fail)
- `npm run build`: pass
- `npm run test:e2e`: pass (`23` tests, `0` fail)

### T-005 Canvas split phase 1: pure helpers
Status: DONE

Scope:
- Move pure helper functions from `Canvas.tsx` into focused utility modules.
- Keep runtime behavior unchanged.

Out of scope:
- interaction flow rewrites

Verification:
- Frontend tests pass
- Manual smoke test for canvas load/zoom/pan/connect

Delivered:
- Added `packages/frontend/src/utils/canvasHelpers.ts` with extracted pure helper functions:
  - `clamp`
  - `easeInOutCubic`
  - `snapToPixel`
  - `makePortKey` / `parsePortKey`
  - `interpolateCanvasBackground`
- Refactored `Canvas.tsx` to import these helpers and removed duplicated inline helper definitions.
- Added unit coverage in `packages/frontend/tests/canvasHelpers.test.ts` for helper behavior (clamping, easing, pixel snapping, port-key round-trip/parsing, and background interpolation mode/color behavior).

Verification result:
- `npm run lint`: pass
- `npm run test`: pass (`180` tests, `0` fail)
- `npm run build`: pass
- `npm run test:e2e`: pass (`23` tests, `0` fail)

### T-006 Canvas split phase 2: interaction handlers
Status: DONE

Scope:
- Extract pointer/keyboard/wheel handlers into a dedicated module or hook.
- Keep current UX behavior and shortcuts.

Out of scope:
- feature additions

Verification:
- Relevant e2e tests pass (wheel navigation, slider drag, drag stability, etc.)

Delivered:
- Added `packages/frontend/src/utils/canvasInteractions.ts` with extracted interaction helpers for:
  - pointer drag threshold + snapped drag/pan position computation
  - node resize draft computation for pointer-driven card resizing
  - wheel interaction planning (modifier pan, trackpad pan, zoom anchor/scale)
  - keyboard delete-shortcut editable-target guard
- Refactored `Canvas.tsx` interaction handlers (`pointermove`, `wheel`, `keydown`) to use shared interaction helpers while preserving existing behavior.
- Added unit coverage in `packages/frontend/tests/canvasInteractions.test.ts` for drag threshold, drag/pan math, resize math, wheel planning, and keyboard shortcut-guard behavior.

Verification result:
- `npm run lint`: pass
- `npm run test`: pass (`189` tests, `0` fail)
- `npm run build`: pass
- `npm run test:e2e`: pass (`23` tests, `0` fail) on rerun; first full-suite run had one transient timeout in `panelAccordion.test.ts`, then passed in isolation and on full-suite rerun

### T-007 Canvas split phase 3: rendering/effects lifecycle
Status: DONE

Scope:
- Separate graph render pass, effect pass, and texture cache lifecycle.
- Preserve current animation and graphics behavior.

Out of scope:
- visual redesign

Verification:
- Existing graphics/projection tests pass
- Manual smoke for projections, graphics output, and minimap

Progress (completed slices):
- Extracted node-graphics texture cache lifecycle logic from `Canvas.tsx` into `packages/frontend/src/utils/canvasTextureCache.ts`:
  - cache retain/release
  - pending texture refresh scheduling
  - node texture binding promotion/rebinding
  - unused/clear-all cleanup
- Refactored `Canvas.tsx` to consume shared texture-cache helpers and reduced local lifecycle code.
- Added unit coverage in `packages/frontend/tests/canvasTextureCache.test.ts` for texture destroy/cleanup behavior.
- Hardened flaky e2e node-selection interactions in:
  - `packages/frontend/tests/e2e/panelAccordion.test.ts`
  - `packages/frontend/tests/e2e/nodePanelDraftStability.test.ts`
- Extracted effect-pass lifecycle logic from `Canvas.tsx` into `packages/frontend/src/utils/canvasEffects.ts`:
  - queueing helpers for lightning pulses and node shocks
  - smoke/lightning/shock effect simulation + draw pass
  - effect-state update/cleanup return contract
- Refactored `Canvas.tsx` to use shared effects helpers (`enqueueLightningPulse`, `enqueueNodeShock`, `runCanvasEffectsPass`) and removed now-dead local effect helpers.
- Added unit coverage in `packages/frontend/tests/canvasEffects.test.ts` for:
  - lightning/shock dedup queueing behavior
  - smoke emission + stale timestamp cleanup
  - smoke particle cap trimming behavior
- Extracted graph render lifecycle helpers into `packages/frontend/src/utils/canvasRenderLifecycle.ts`:
  - projection-transition frame resolution/expiration
  - render-layer child cleanup/destruction
  - stale node draft map pruning
- Refactored `Canvas.tsx` render pass to consume `clearRenderLayerChildren`, `resolveProjectionTransitionFrame`, and `pruneNodeDraftMaps` in place of inline lifecycle logic.
- Added unit coverage in `packages/frontend/tests/canvasRenderLifecycle.test.ts` for:
  - layer cleanup destroy semantics
  - projection transition frame resolution for mismatch/in-progress/completed states
  - stale node draft map pruning
- Extracted node render/projection planning helpers into `packages/frontend/src/utils/canvasNodeRender.ts`:
  - node render target resolution (node position vs drag state vs draft position)
  - projection transition interpolation for node frame position/size
  - projected graphics mip/load planning gated by viewport intersection and transition-reload rules
- Refactored `Canvas.tsx` node render loop to consume `resolveNodeRenderFrame` and `resolveGraphicsProjectionPlan` instead of inline math/viewport planning logic.
- Added unit coverage in `packages/frontend/tests/canvasNodeRender.test.ts` for:
  - render target fallback precedence and drag override behavior
  - transition interpolation/clamping behavior
  - projected graphics mip/debug planning + transition-load gating behavior
- Extracted viewport fit world-bounds/transform planning into `packages/frontend/src/utils/canvasViewportFit.ts`:
  - graph world-bounds aggregation for node boxes + projected graphics + drawing paths
  - viewport fit transform resolution (scale clamp + centered position)
- Refactored `Canvas.tsx` `fitViewportToGraph` to consume `resolveGraphWorldBounds` and `resolveViewportFitTransform` instead of inline bounds/fit math.
- Added unit coverage in `packages/frontend/tests/canvasViewportFit.test.ts` for:
  - empty-graph bounds handling
  - node+drawing bounds aggregation behavior
  - viewport-fit centering and scale capping behavior

Verification result (latest):
- `npm run lint`: pass
- `npm run test`: pass (`211` tests, `0` fail)
- `npm run build`: pass
- `npm run test:e2e`: pass (`23` tests, `0` fail)

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

### T-010 Extract shared graph-management controller and sections
Status: DONE

Scope:
- Extract shared graph-admin state/actions used by `NodePanel.tsx` and `GraphPanel.tsx`.
- Extract shared graph-management UI sections while preserving existing `data-testid` hooks and behavior.

Out of scope:
- Moving graph-wide controls fully out of `NodePanel.tsx`
- Splitting graph-specific projection/background/connection-stroke sections yet
- Backend/API changes

Delivered:
- Added `packages/frontend/src/components/useGraphManagementState.ts` to centralize:
  - graph select/create/delete/rename flow
  - shared in-flight/delete-confirm state
  - graph-level Python environment draft/edit/save flow
- Added `packages/frontend/src/components/GraphManagementControls.tsx` for shared graph selection, rename, create, and delete-confirm UI.
- Added `packages/frontend/src/components/PythonEnvironmentSection.tsx` for shared graph-level Python environment editing UI.
- Refactored `NodePanel.tsx` to consume the shared graph-management hook and extracted sections instead of carrying its own duplicate graph-admin code.
- Refactored `GraphPanel.tsx` to consume the same shared hook/sections, while composing graph-specific controls into the shared scaffold via `afterRename` and `afterCreate` slots.

Verification result:
- `npm run lint`: pass
- `npm run test`: pass on rerun (`211` tests, `0` fail); first full run had one transient timeout in `packages/mcp-server/tests/screenshotParity.test.ts`, then passed in isolation and on full-suite rerun
- `npm run build`: pass
- Targeted frontend e2e: pass (`6` tests, `0` fail)
  - `tests/e2e/nodePanelDraftStability.test.ts`
  - `tests/e2e/diagnosticsPanel.test.ts`
  - `tests/e2e/graphDeletion.test.ts`
  - `tests/e2e/graphConflictReload.test.ts`
- `tests/e2e/panelAccordion.test.ts`
- `npm run test:e2e`: currently hangs in `tests/e2e/annotationCard.test.ts` after its first two tests complete; this appears unrelated to T-010 and should be tracked separately

### T-011 Split graphStore: support modules and persistence controller
Status: IN PROGRESS

Scope:
- Extract non-Zustand responsibilities out of `packages/frontend/src/store/graphStore.ts`.
- Keep the store API and UI behavior unchanged.

Out of scope:
- Full store-slice decomposition in this task
- Canvas architectural changes

Delivered so far:
- Added `packages/frontend/src/store/graphStoreTypes.ts` for exported store-facing types.
- Added `packages/frontend/src/store/graphStoreState.ts` for pure graph normalization and execution-state helpers.
- Added `packages/frontend/src/store/graphApi.ts` for backend REST access.
- Added `packages/frontend/src/store/graphLocalStorage.ts` for current-graph persistence.
- Added `packages/frontend/src/store/recomputeStatusPolling.ts` for recompute-status polling/backoff orchestration.
- Refactored `packages/frontend/src/store/graphStore.ts` to consume those modules instead of owning those concerns inline.
- Added `packages/frontend/src/store/graphStorePersistence.ts` for optimistic graph persistence, conflict reload, and selection reconciliation helpers.
- Refactored `packages/frontend/src/store/graphStore.ts` to delegate `updateGraph` to the persistence controller and to reuse shared graph-state patch builders for graph load/create flows.
- Exposed a browser-test `window.__k8vGraphStore` handle in `packages/frontend/src/App.tsx` so e2e coverage can access the live app store instance without dynamic module-import ambiguity.
- Updated browser test support in `packages/frontend/tests/e2e/support/browser.ts` and `packages/frontend/tests/e2e/nodePanelDraftStability.test.ts` to wait on user-visible graph readiness and use the live store handle.
- Added a regression case in `packages/frontend/tests/graphStore.test.ts` that verifies out-of-order optimistic update responses cannot overwrite the latest persisted graph state.

Remaining inside T-011:
- Split the remaining Zustand store body into narrower graph/edit/selection/compute slices or slice-like modules.
- Revisit `packages/frontend/tests/graphStore.test.ts` splitting once the store boundaries stabilize.

Verification result (latest):
- `npm run lint`: pass
- `npx tsx --test packages/frontend/tests/graphStore.test.ts`: pass (`21` tests, `0` fail)
- `npm run test`: pass (`212` tests, `0` fail)
- `npm run build`: pass
- Targeted frontend e2e: pass (`6` tests, `0` fail)
  - `tests/e2e/nodePanelDraftStability.test.ts`
  - `tests/e2e/diagnosticsPanel.test.ts`
  - `tests/e2e/graphDeletion.test.ts`
  - `tests/e2e/graphConflictReload.test.ts`
  - `tests/e2e/panelAccordion.test.ts`

## Current Focus

Queue reopened after the March 7, 2026 size/architecture review.

Current status:
- `DONE`: `T-010` shared graph-management controller and sections
- `IN PROGRESS`: `T-011` split `packages/frontend/src/store/graphStore.ts`
  - phase 1 complete: API client, current-graph storage, recompute polling, and pure state helpers extracted
  - phase 2 complete: optimistic persistence/conflict handling extracted into `graphStorePersistence.ts`
  - next inside T-011: split the remaining store body by domain and start breaking up `graphStore.test.ts`
- `FOLLOWING`: `T-012` extract graph services/routes from `packages/backend/src/app.ts`
- `FOLLOWING`: `T-013` modularize `packages/mcp-server/src/index.ts` by tool domain and shared contracts
- `FOLLOWING`: `T-014` continue the Canvas architectural split with lifecycle, interaction, renderer, and MCP-bridge hooks
