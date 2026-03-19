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

Meaning of "full verification":
- `npm run lint`, `npm run test`, and `npm run build` must all finish successfully.
- In plain language, that means all applicable automated checks and tests must complete and pass, not just a subset.
- Partial runs, hanging runs, or targeted-only runs do not count as full verification.
- The root `npm run test` command is expected to cover the full automated suite, including frontend e2e/browser tests.

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

### MCP Feature Testing
When testing MCP features:
1. Use Codex CLI as an external consumer of the MCP, not an in-repo agent session that already knows k8v internals
2. Before starting any external Codex run, execute `npm run codex:rate-limits -- --fail-above=50`
3. Do not start a new external agent test if that command reports over-budget for any visible Codex limit; pause and ask the user before using more capacity
4. Start a "new born" agent with a decent model (`gpt-5.4`) at `medium` reasoning effort
5. Run that agent in a fresh environment and in a directory that is not associated with this project
6. Use an isolated Codex config/home that exposes the MCP being tested without bringing along unrelated project context
7. Give explicit instructions that the agent must use MCP features only and must not use shell commands, inspect local files, inspect source code, inspect runtime internals, or reverse-engineer k8v
8. Capture the full Codex CLI outcome, including the final answer and the MCP call trace/log
9. Capture the pre-run and post-run snapshots with `npm run codex:rate-limits -- --json` so external-agent testing stays under 50% of both windows
10. Analyze how the agent actually used the MCP: number of requests, sequence of requests, validation/runtime errors, and any mistakes or wrong assumptions the agent made
11. Use that analysis to judge the quality of the MCP documentation, naming, and API surface expressiveness

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
12. Do not treat a narrower test command or a partially complete test run as "full verification"; if some automated tests were not run or did not finish, state that plainly and do not claim the repo is fully verified
13. For MCP testing, use the external Codex CLI procedure above, enforce the 50% budget with `npm run codex:rate-limits`, and report the observed MCP usage pattern, not just whether the task eventually succeeded
