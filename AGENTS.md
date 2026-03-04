# k8v Agent Guidelines

This file provides project context and working rules for coding assistants on `k8v`.

## Project Overview

k8v is a flow-based visual programming tool with:
- React frontend (Pixi.js canvas renderer)
- Node.js backend (Express API)
- SQLite for persistence
- Pluggable execution engine (in development)

## Key Documentation

Before making significant changes, review the relevant docs:
- `ARCHITECTURE.md` - overall system design
- `EXECUTION_ENGINE.md` - execution runtime architecture (important for code execution changes)
- `OUTPUT_FEATURES.md` - output display features
- `PORT_NAMING.md` - naming conventions for node ports
- `EXAMPLES.md` - usage examples
- `FUNCTIONALITY.md` - current implemented feature inventory
- `TEST_CASES.md` - feature-to-test coverage map (automated/manual/gaps)
- `BACKLOG.md` - prioritized implementation and coverage backlog

## Code Organization

```
packages/
|- backend/src/
|  |- core/
|  |  |- GraphEngine.ts
|  |  |- NodeExecutor.ts
|  |  |- DataStore.ts
|  |  `- execution/        # planned pluggable runtimes
|  `- types/
`- frontend/src/
   |- components/
   |- store/
   |- types.ts
   `- utils/
```

## Development Patterns

### Creating New Node Types
1. Add type to `packages/backend/src/types/index.ts` (`NodeType` enum)
2. Add type to `packages/frontend/src/types.ts` (`NodeType` enum)
3. Add execution logic in `packages/backend/src/core/NodeExecutor.ts`
4. Update `packages/frontend/src/utils/nodeFactory.ts` if needed

### Adding New Runtime (Execution Engine)
1. Create runtime implementation in `packages/backend/src/core/execution/`
2. Implement the `ExecutionRuntime` interface (see `EXECUTION_ENGINE.md`)
3. Register it in runtime factory/registry
4. Update `NodeExecutor` to use runtime selection

## Security Rules

User code should execute in sandboxed runtimes, not in-process eval.
- See `EXECUTION_ENGINE.md` for runtime abstraction
- Enforce timeout and memory limits
- Treat JavaScript as a regular guest language
- Preferred runtimes: containers and WASM/WASI

## Verification Commands

```bash
npm run lint
npm run test
npm run build
npm run dev
```

## Common Tasks

### Add a Feature
1. Read relevant docs first
2. Update docs when architecture or behavior changes
3. Implement with existing patterns
4. Build and verify

### Refactor
1. Check `ARCHITECTURE.md` constraints
2. Preserve abstraction boundaries
3. Update docs to match code changes

### Fix a Bug
1. Trace data flow from `ARCHITECTURE.md`
2. Identify affected backend/frontend boundaries
3. Add regression coverage where practical
4. For UI/interaction bugs, confirm the fix with a browser test (headless Playwright or equivalent) before closing

### Test Case Requests
When the user says: `test case: this should ...`
1. Treat it as a bug/regression signal and retest that behavior
2. Search for an existing test case that already covers the scenario
3. If coverage exists, run it and report whether it still passes
4. If coverage does not exist, add a corresponding test case, then run it
5. If behavior is broken, fix it and keep the new/updated test as regression coverage

### Feature Requests
When the user says: `feature: x should be working like y...`
1. Check whether the feature is tracked in project documentation (for example `FUNCTIONALITY.md`, `BACKLOG.md`, `README.md`, `ARCHITECTURE.md`)
2. Check whether the feature is covered by test cases
3. Check whether the feature is already implemented and working
4. Then start working on the feature immediately (do not stop at analysis)
5. Update documentation and tests as part of delivering the feature

## Assistant Expectations

1. Read relevant docs before broad changes
2. Keep docs aligned with architecture-level changes
3. Use node factory helpers for consistent node creation
4. Prefer existing patterns over one-off designs
5. Verify builds before claiming success
6. Do not introduce new unsafe code-execution paths
7. For explicit user test-case requests, always verify existing coverage first, add missing tests, and retest before closing
8. For explicit user feature requests, verify documentation and coverage status first, then implement right away
9. For bug fixes, always confirm behavior is fixed using a browser test when the bug affects UI/interaction
10. Do not switch context to a new feature/bugfix while previous work is uncommitted; commit (or explicitly resolve with the user) before starting the next task
11. After work is done and full verification has run successfully, commit the completed work
