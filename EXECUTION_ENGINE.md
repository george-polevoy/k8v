# Execution Engine Architecture

This document describes the pluggable execution engine architecture for k8v, enabling support for multiple runtimes (V8 isolates, containers, WASM/WASI) and multiple languages.

Current scope note: transient wasm algo invocation now exists for MCP-driven graph tooling, but it is not part of the node execution engine yet. It uses a separate capability-based host API and should not be treated as the delivery of the planned graph node wasm runtime described below.

## Vision

Build a **pluggable, secure, multi-language execution framework** that:

1. **Abstracts execution details** behind clean interfaces
2. **Treats all languages equally** - no special in-process execution
3. **Supports multiple runtimes** (Containers, WASM/WASI)
4. **Supports multiple languages** (JavaScript, TypeScript, Python, Go, Rust, etc.)
5. **Separates design-time (transpilation) from runtime (execution)**
6. **Produces persisted artifacts** (compiled modules, container images)

**Design Principle**: JavaScript is just another language. All code executes through the same sandboxed runtime abstraction - no language gets special treatment or in-process execution.

---

## Key Concepts

### 1. Language Definition

Each supported language defines:
- **Syntax** - How code is written by the user
- **Transpiler** - Design-time transformation to executable form
- **Runtime requirements** - What's needed to execute (interpreter, VM, container)

### 2. Execution Runtime

A runtime is an environment that can execute code:

| Runtime | Isolation | Languages | Artifact Type | Priority |
|---------|-----------|-----------|---------------|----------|
| **Container** | OS-level (max) | Any | OCI image | **Primary** |
| **WASM/WASI** | Sandbox | Any→WASM | `.wasm` module | Secondary |
| **Process Spawn** | Process-level | Any | None | Dev only |

### 3. Transpiler (Design-Time)

Transforms source code at design time (when user edits code):
- TypeScript → JavaScript
- Python → (none, or to WASM via Pyodide)
- Any language → Container Dockerfile

### 4. Compiler (Build-Time)

Creates runtime artifacts:
- JavaScript → WASM (via QuickJS)
- Source + Dockerfile → Container image
- WASM module → Optimized WASM

---

## Interface Design

### Core Interfaces

```typescript
/**
 * Represents a language that can be used for inline code
 */
interface Language {
  id: string;                    // 'javascript', 'typescript', 'python'
  name: string;                  // Human-readable name
  fileExtension: string;         // '.js', '.ts', '.py'
  supportsRuntimes: RuntimeType[]; // Which runtimes can execute this
}

/**
 * Runtime types
 */
enum RuntimeType {
  V8_ISOLATE = 'v8_isolate',
  WASM = 'wasm',
  CONTAINER = 'container',
}

/**
 * Transpiles source code (design-time)
 */
interface Transpiler {
  readonly sourceLanguage: string;
  readonly targetLanguage: string;
  
  transpile(source: string): Promise<TranspileResult>;
}

interface TranspileResult {
  code: string;
  sourceMap?: string;
  errors?: TranspileError[];
}

/**
 * Compiles to runtime artifact (build-time)
 */
interface Compiler {
  readonly inputLanguage: string;
  readonly outputRuntime: RuntimeType;
  
  compile(source: string, options?: CompileOptions): Promise<CompileResult>;
}

interface CompileResult {
  artifact: Artifact;
  errors?: CompileError[];
}

interface Artifact {
  type: 'wasm_module' | 'container_image' | 'js_bundle';
  id: string;
  location: string;  // File path or image reference
  hash: string;      // Content hash for caching
}

/**
 * Executes code in a specific runtime
 */
interface ExecutionRuntime {
  readonly type: RuntimeType;
  readonly supportedLanguages: string[];
  
  /**
   * Execute code with inputs, return outputs
   */
  execute(request: ExecutionRequest): Promise<ExecutionResult>;
  
  /**
   * Execute a pre-compiled artifact
   */
  executeArtifact(artifact: Artifact, request: ExecutionRequest): Promise<ExecutionResult>;
}

interface ExecutionRequest {
  code?: string;           // Source code (for interpreted runtimes)
  artifact?: Artifact;     // Compiled artifact (for compiled runtimes)
  inputs: Record<string, any>;
  meta?: {
    custom: Record<string, any>;
    graph: { id: string | null; name: string | null };
    node: { id: string; name: string };
  };
  timeout?: number;        // Max execution time (ms)
  memoryLimit?: number;    // Max memory (bytes)
}

interface ExecutionResult {
  outputs: Record<string, any>;
  textOutput?: string;     // stdout/stderr
  graphicsOutput?: string; // Image data
  metrics?: ExecutionMetrics;
}

interface ExecutionMetrics {
  executionTimeMs: number;
  memoryUsedBytes?: number;
}
```

---

## Runtime Implementations

All languages execute through the same pluggable runtime system. JavaScript has no special treatment - it's just another language that runs in a sandboxed environment.

### Runtime: Containers (Primary)

Docker/Podman-based execution:
- Maximum isolation (OS-level)
- Support for ANY language via base images
- Build container images from node code + dependencies
- Network isolation, resource limits
- Preferred for production and untrusted code

**Supported languages**: JavaScript, Python, Go, Rust, any language with a container base image

### Runtime: WASM/WASI

WebAssembly-based execution:
- Near-native performance with strong sandboxing
- Portable across platforms
- WASI capabilities for controlled I/O
- Can bundle QuickJS for JavaScript execution

**Supported languages**: Rust, C/C++, Go, AssemblyScript, JavaScript (via QuickJS)

### Runtime: Process Spawn (Development Only)

Direct process execution for development:
- Quick iteration during development
- **Not for production** - limited sandboxing
- Useful for debugging

**Note**: This runtime should be disabled in production environments.

---

## Artifact Storage

Compiled artifacts should be cached and versioned:

```
/artifacts/
  /wasm/
    {node_id}_{version}.wasm
  /containers/
    {node_id}_{version}/
      Dockerfile
      context/
```

---

## Node Configuration

Nodes should specify their execution preferences:

```typescript
interface NodeConfig {
  type: NodeType;
  code?: string;
  
  // Execution configuration
  language?: string;           // Default: 'javascript'
  runtime?: RuntimeType;       // Default: 'v8_isolate'
  artifactId?: string;         // Reference to pre-compiled artifact
  
  // Resource limits
  timeout?: number;            // Optional per-request override (default from graph timeout: 30000 / 30 seconds)
  memoryLimit?: number;        // Default: 128 * 1024 * 1024 (128MB)
}
```

---

## Implementation Roadmap

### Phase 1: Foundation (Current Priority)
- [x] Define abstract interfaces (Language, Transpiler, Compiler, ExecutionRuntime)
- [ ] Implement V8IsolateRuntime using `isolated-vm`
- [x] Replace `eval()` in NodeExecutor with ExecutionRuntime interface
- [ ] Add timeout and memory limit support

Current implementation status:
- `ExecutionRuntime` interface is wired into `NodeExecutor`
- `JavaScriptVmRuntime` (`node:vm`) provides interim execution with timeout support and should be treated as a development/intermediate runtime rather than a production isolation boundary
- `PythonProcessRuntime` (`python_process`) provides interim Python execution via warm graph/env-scoped Python services with timeout-enforced worker recycling
- Runtime timeout is graph-scoped via `graph.executionTimeoutMs` (default: `30000`)
- Runtime can be selected per node via `node.config.runtime` (defaults to `javascript_vm`)
- Python execution can resolve per-node graph env bindings via `graph.pythonEnvs[]` + `node.config.pythonEnv` (`pythonPath` and `cwd`)
- Warm Python pool size follows graph `recomputeConcurrency`
- Backend rejects unregistered runtime identifiers during execution
- Next security milestone is `isolated-vm` or stronger isolation runtime

### Phase 2: TypeScript Support
- [ ] Implement TypeScriptTranspiler (TS → JS)
- [ ] Add TypeScript language option in UI
- [ ] Transpile on code save (design-time)

### Phase 3: WASM Runtime
- [ ] Research quickjs-emscripten or other WASM runtimes
- [ ] Implement WasmRuntime
- [ ] Add artifact caching

### Phase 4: Container Runtime
- [ ] Implement ContainerRuntime (Docker/Podman)
- [ ] Implement ContainerCompiler (build images)
- [ ] Add language-specific base images (Python, Go, etc.)

### Phase 5: Multi-Language
- [ ] Add Python support (via containerized runtime)
- [ ] Add Go support (compiled to WASM or container)
- [ ] Add Rust support (compiled to WASM)

---

## Security Considerations

1. **V8 Isolate** - Code cannot access Node.js APIs, filesystem, network
2. **WASM** - Sandboxed by design, WASI capabilities must be explicitly granted
3. **Containers** - Network isolated, read-only filesystem, resource limits

All runtimes must enforce:
- Execution timeout (default: 30 seconds)
- Memory limit (default: 128MB)
- No network access by default
- No filesystem access by default

---

## Open Questions

1. **Hot reload vs. cold start**: Should we keep runtimes warm between executions?
2. **Artifact sharing**: Can nodes share compiled artifacts (e.g., common libraries)?
3. **Debugging**: How to support step-through debugging in sandboxed environments?
4. **Streaming outputs**: Should large outputs be streamed rather than buffered?

---

## References

- [isolated-vm](https://github.com/laverdet/isolated-vm) - V8 isolates for Node.js
- [quickjs-emscripten](https://github.com/nicferrier/nicferrier-qjs) - QuickJS compiled to WASM
- [Wasmtime](https://wasmtime.dev/) - WASI runtime
- [Podman](https://podman.io/) - Rootless container runtime
