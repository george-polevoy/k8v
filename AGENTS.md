# k8v Agent Guidelines

This file provides project context and working rules for coding assistants on `k8v`.

## Project Overview

k8v is a flow-based visual programming tool with:
- React frontend (ReactFlow canvas)
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

## Assistant Expectations

1. Read relevant docs before broad changes
2. Keep docs aligned with architecture-level changes
3. Use node factory helpers for consistent node creation
4. Prefer existing patterns over one-off designs
5. Verify builds before claiming success
6. Do not introduce new unsafe code-execution paths
