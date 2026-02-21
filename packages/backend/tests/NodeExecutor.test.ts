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
      type: NodeType.INLINE_CODE,
      code: 'outputs.output = inputs.input;',
      runtime,
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
  } finally {
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
    dataStore.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
