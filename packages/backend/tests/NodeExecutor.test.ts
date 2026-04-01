import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { DataStore } from '../src/core/DataStore.ts';
import { NodeExecutor } from '../src/core/NodeExecutor.ts';
import { ExecutionRuntime, ExecutionRequest, ExecutionResult } from '../src/core/execution/types.ts';
import { Graph, GraphNode, NodeType } from '../src/types/index.ts';

class StubRuntime implements ExecutionRuntime {
  calls = 0;
  lastRequest: ExecutionRequest | null = null;
  constructor(private readonly result: ExecutionResult) {}

  async execute(request: ExecutionRequest): Promise<ExecutionResult> {
    this.calls += 1;
    this.lastRequest = request;
    return this.result;
  }
}

function createInlineNode(runtime?: string): GraphNode {
  return {
    id: 'node-1',
    type: NodeType.INLINE_CODE,
    position: { x: 0, y: 0 },
    metadata: {
      name: 'Inline',
      inputs: [{ name: 'input', schema: { type: 'number' } }],
      outputs: [{ name: 'output', schema: { type: 'number' } }],
    },
    config: {
      code: 'outputs.output = inputs.input;',
      runtime,
    },
    version: '1',
  };
}

function createNumericInputNode(config?: Record<string, unknown>): GraphNode {
  return {
    id: 'numeric-node',
    type: NodeType.NUMERIC_INPUT,
    position: { x: 0, y: 0 },
    metadata: {
      name: 'Numeric Input',
      inputs: [],
      outputs: [{ name: 'value', schema: { type: 'number' } }],
    },
    config: (config ?? {
      value: 0,
      min: 0,
      max: 100,
      step: 1,
    }) as any,
    version: '1',
  };
}

function createAnnotationNode(): GraphNode {
  return {
    id: 'annotation-node',
    type: NodeType.ANNOTATION,
    position: { x: 0, y: 0 },
    metadata: {
      name: 'Annotation',
      inputs: [],
      outputs: [],
    },
    config: {
      text: 'hello',
      backgroundColor: '#fef3c7',
      borderColor: '#334155',
      fontColor: '#1f2937',
      fontSize: 14,
      cardWidth: 320,
      cardHeight: 200,
    },
    version: '1',
  };
}

function hasPythonAvailable(): boolean {
  const result = spawnSync(process.env.K8V_PYTHON_BIN || 'python3', ['--version'], {
    encoding: 'utf8',
  });
  return result.status === 0;
}

function createGraphWithPythonEnv(node: GraphNode): Graph {
  const now = Date.now();
  return {
    id: 'graph-1',
    name: 'Graph with envs',
    nodes: [node],
    connections: [],
    pythonEnvs: [
      {
        name: 'analytics',
        pythonPath: '/tmp/fake-python',
        cwd: '/tmp/fake-workdir',
      },
    ],
    drawings: [],
    createdAt: now,
    updatedAt: now,
  };
}

test('NodeExecutor uses default runtime when node runtime is not set', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'k8v-node-executor-test-'));
  const dataStore = new DataStore(':memory:', tmpDir);
  const defaultRuntime = new StubRuntime({ outputs: { output: 11 } });
  const alternativeRuntime = new StubRuntime({ outputs: { output: 22 } });
  const executor = new NodeExecutor(dataStore, {
    javascript_vm: defaultRuntime,
    test_runtime: alternativeRuntime,
  });

  try {
    const result = await executor.execute(createInlineNode(), { input: 5 });
    assert.equal(result.outputs.output, 11);
    assert.equal(defaultRuntime.calls, 1);
    assert.equal(alternativeRuntime.calls, 0);
    assert.equal(defaultRuntime.lastRequest?.timeoutMs, 30_000);
  } finally {
    dataStore.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('NodeExecutor uses configured runtime from node config', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'k8v-node-executor-test-'));
  const dataStore = new DataStore(':memory:', tmpDir);
  const defaultRuntime = new StubRuntime({ outputs: { output: 11 } });
  const alternativeRuntime = new StubRuntime({ outputs: { output: 22 } });
  const executor = new NodeExecutor(dataStore, {
    javascript_vm: defaultRuntime,
    test_runtime: alternativeRuntime,
  });

  try {
    const result = await executor.execute(createInlineNode('test_runtime'), { input: 5 });
    assert.equal(result.outputs.output, 22);
    assert.equal(defaultRuntime.calls, 0);
    assert.equal(alternativeRuntime.calls, 1);
  } finally {
    dataStore.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('NodeExecutor uses graph-level execution timeout for inline code', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'k8v-node-executor-test-'));
  const dataStore = new DataStore(':memory:', tmpDir);
  const runtime = new StubRuntime({ outputs: { output: 11 } });
  const executor = new NodeExecutor(dataStore, {
    javascript_vm: runtime,
  });
  const node = createInlineNode();
  const now = Date.now();
  const graph: Graph = {
    id: 'graph-timeout',
    name: 'Graph timeout',
    nodes: [node],
    connections: [],
    recomputeConcurrency: 3,
    executionTimeoutMs: 45_000,
    pythonEnvs: [],
    drawings: [],
    createdAt: now,
    updatedAt: now,
  };

  try {
    await executor.execute(node, { input: 5 }, graph);
    assert.equal(runtime.calls, 1);
    assert.equal(runtime.lastRequest?.timeoutMs, 45_000);
    assert.equal(runtime.lastRequest?.graphId, 'graph-timeout');
    assert.equal(runtime.lastRequest?.workerConcurrencyHint, 3);
  } finally {
    await executor.dispose();
    dataStore.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('NodeExecutor passes execution meta with custom metadata and graph/node identity to runtime', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'k8v-node-executor-test-'));
  const dataStore = new DataStore(':memory:', tmpDir);
  const runtime = new StubRuntime({ outputs: { output: 42 } });
  const executor = new NodeExecutor(dataStore, {
    javascript_vm: runtime,
  });
  const node = createInlineNode();
  node.metadata.name = 'Custom Inline';
  node.metadata.custom = {
    threshold: 0.25,
    tags: ['alpha', 2, null],
    nested: {
      enabled: true,
    },
  };
  const graph = createGraphWithPythonEnv(node);

  try {
    const result = await executor.execute(node, { input: 5 }, graph);
    assert.equal(result.outputs.output, 42);
    assert.deepEqual(runtime.lastRequest?.meta, {
      custom: {
        threshold: 0.25,
        tags: ['alpha', 2, null],
        nested: {
          enabled: true,
        },
      },
      graph: {
        id: 'graph-1',
        name: 'Graph with envs',
      },
      node: {
        id: 'node-1',
        name: 'Custom Inline',
      },
    });

    const requestMeta = runtime.lastRequest?.meta;
    assert.ok(requestMeta, 'expected NodeExecutor to pass runtime meta');
    const requestMetaCustom = requestMeta?.custom as {
      nested: {
        enabled: boolean;
      };
    };
    requestMetaCustom.nested.enabled = false;
    assert.equal(
      (node.metadata.custom.nested as { enabled: boolean }).enabled,
      true,
      'runtime meta should be cloned from persisted node metadata'
    );
  } finally {
    await executor.dispose();
    dataStore.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('NodeExecutor throws for unknown runtime in node config', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'k8v-node-executor-test-'));
  const dataStore = new DataStore(':memory:', tmpDir);
  const executor = new NodeExecutor(dataStore);

  try {
    await assert.rejects(
      () => executor.execute(createInlineNode('missing_runtime'), { input: 5 }),
      /not registered/
    );
  } finally {
    dataStore.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('NodeExecutor can execute inline node with python_process runtime', { skip: !hasPythonAvailable() }, async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'k8v-node-executor-test-'));
  const dataStore = new DataStore(':memory:', tmpDir);
  const executor = new NodeExecutor(dataStore);
  const pythonNode: GraphNode = {
    ...createInlineNode('python_process'),
    config: {
      ...createInlineNode('python_process').config,
      code: 'outputs.output = inputs.input * 3',
    },
  };

  try {
    const result = await executor.execute(pythonNode, { input: 7 });
    assert.equal(result.outputs.output, 21);
  } finally {
    await executor.dispose();
    dataStore.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('NodeExecutor passes graph-scoped python env pythonPath and cwd to runtime', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'k8v-node-executor-test-'));
  const dataStore = new DataStore(':memory:', tmpDir);
  const pythonRuntime = new StubRuntime({ outputs: { output: 99 } });
  const executor = new NodeExecutor(dataStore, {
    python_process: pythonRuntime,
  });
  const pythonNode: GraphNode = {
    ...createInlineNode('python_process'),
    config: {
      ...createInlineNode('python_process').config,
      pythonEnv: 'analytics',
      code: 'outputs.output = inputs.input;',
    },
  };

  try {
    const graph = createGraphWithPythonEnv(pythonNode);
    const result = await executor.execute(pythonNode, { input: 1 }, graph);

    assert.equal(result.outputs.output, 99);
    assert.equal(pythonRuntime.calls, 1);
    assert.equal(pythonRuntime.lastRequest?.pythonBin, '/tmp/fake-python');
    assert.equal(pythonRuntime.lastRequest?.cwd, '/tmp/fake-workdir');
    assert.equal(pythonRuntime.lastRequest?.graphId, 'graph-1');
    assert.equal(pythonRuntime.lastRequest?.workerConcurrencyHint, 1);
  } finally {
    await executor.dispose();
    dataStore.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('NodeExecutor throws when python env name is missing from graph', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'k8v-node-executor-test-'));
  const dataStore = new DataStore(':memory:', tmpDir);
  const pythonRuntime = new StubRuntime({ outputs: { output: 1 } });
  const executor = new NodeExecutor(dataStore, {
    python_process: pythonRuntime,
  });
  const pythonNode: GraphNode = {
    ...createInlineNode('python_process'),
    config: {
      ...createInlineNode('python_process').config,
      pythonEnv: 'missing-env',
    },
  };

  try {
    const graph = createGraphWithPythonEnv(pythonNode);
    graph.pythonEnvs = [];

    await assert.rejects(
      () => executor.execute(pythonNode, { input: 2 }, graph),
      /unknown python environment/i
    );
  } finally {
    await executor.dispose();
    dataStore.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('NodeExecutor throws when python env is set on non-python runtime node', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'k8v-node-executor-test-'));
  const dataStore = new DataStore(':memory:', tmpDir);
  const executor = new NodeExecutor(dataStore);
  const jsNode: GraphNode = {
    ...createInlineNode('javascript_vm'),
    config: {
      ...createInlineNode('javascript_vm').config,
      pythonEnv: 'analytics',
    },
  };

  try {
    await assert.rejects(
      () => executor.execute(jsNode, { input: 2 }),
      /runtime .* is not 'python_process'/i
    );
  } finally {
    await executor.dispose();
    dataStore.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('NodeExecutor executes numeric_input nodes with normalized min/max/step/value', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'k8v-node-executor-test-'));
  const dataStore = new DataStore(':memory:', tmpDir);
  const executor = new NodeExecutor(dataStore);
  const numericNode = createNumericInputNode({
    value: 7.8,
    min: 0,
    max: 10,
    step: 0.5,
  });

  try {
    const result = await executor.execute(numericNode, {});
    assert.equal(result.outputs.value, 8);

    numericNode.config = {
      ...numericNode.config,
      value: 12,
      min: 3,
      max: 1,
      step: -1,
    };
    const normalizedResult = await executor.execute(numericNode, {});
    assert.equal(normalizedResult.outputs.value, 3);
  } finally {
    dataStore.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('NodeExecutor executes annotation nodes as non-computing no-op outputs', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'k8v-node-executor-test-'));
  const dataStore = new DataStore(':memory:', tmpDir);
  const runtime = new StubRuntime({ outputs: { output: 42 } });
  const executor = new NodeExecutor(dataStore, {
    javascript_vm: runtime,
  });
  const annotationNode = createAnnotationNode();

  try {
    const result = await executor.execute(annotationNode, {});
    assert.deepEqual(result.outputs, {});
    assert.deepEqual(result.schema, {});
    assert.equal(runtime.calls, 0);
  } finally {
    dataStore.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
