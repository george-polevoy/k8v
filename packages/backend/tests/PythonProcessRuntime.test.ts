import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { PythonProcessRuntime } from '../src/core/execution/PythonProcessRuntime.js';
import { PythonExecutionManager } from '../src/core/execution/PythonExecutionManager.js';

const PNG_1X1_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Z8S8AAAAASUVORK5CYII=';
const RELOAD_GUARD_EXTENSION_BUILD_SCRIPT = String.raw`
import pathlib
import shlex
import subprocess
import sys
import sysconfig
import textwrap

target_dir = pathlib.Path(sys.argv[1])
target_dir.mkdir(parents=True, exist_ok=True)

source = textwrap.dedent(
    r'''
    #include <Python.h>

    static int was_loaded = 0;

    static int reload_guard_exec(PyObject *module) {
        if (was_loaded) {
            PyErr_SetString(PyExc_ImportError, "cannot load module more than once per process");
            return -1;
        }
        was_loaded = 1;
        return 0;
    }

    static PyMethodDef methods[] = {
        {NULL, NULL, 0, NULL},
    };

    static PyModuleDef_Slot slots[] = {
        {Py_mod_exec, reload_guard_exec},
        {0, NULL},
    };

    static struct PyModuleDef moduledef = {
        PyModuleDef_HEAD_INIT,
        .m_name = "reload_guard",
        .m_doc = NULL,
        .m_size = 0,
        .m_methods = methods,
        .m_slots = slots,
    };

    PyMODINIT_FUNC PyInit_reload_guard(void) {
        return PyModuleDef_Init(&moduledef);
    }
    '''
)

source_path = target_dir / 'reload_guard.c'
source_path.write_text(source, encoding='utf-8')

ldshared = sysconfig.get_config_var('LDSHARED')
include_dir = sysconfig.get_config_var('INCLUDEPY')
ext_suffix = sysconfig.get_config_var('EXT_SUFFIX')

if not ldshared or not include_dir or not ext_suffix:
    raise SystemExit('Python extension build flags are unavailable')

command = shlex.split(ldshared) + [
    '-I',
    include_dir,
    str(source_path),
    '-o',
    str(target_dir / f'reload_guard{ext_suffix}'),
]
subprocess.run(command, check=True)
`;

function hasPythonAvailable(): boolean {
  const result = spawnSync(process.env.K8V_PYTHON_BIN || 'python3', ['--version'], {
    encoding: 'utf8',
  });
  return result.status === 0;
}

function buildReloadGuardExtension(directory: string): { ok: true } | { ok: false; reason: string } {
  const result = spawnSync(
    process.env.K8V_PYTHON_BIN || 'python3',
    ['-c', RELOAD_GUARD_EXTENSION_BUILD_SCRIPT, directory],
    {
      encoding: 'utf8',
    }
  );

  if (result.status === 0) {
    return { ok: true };
  }

  const stderr = result.stderr?.trim();
  const stdout = result.stdout?.trim();
  const details = stderr || stdout || `exit code ${result.status ?? 'unknown'}`;
  return {
    ok: false,
    reason: `Python extension build support is unavailable: ${details}`,
  };
}

const skipPythonTests = !hasPythonAvailable();

test('PythonProcessRuntime executes code and captures outputs', { skip: skipPythonTests }, async () => {
  const runtime = new PythonProcessRuntime();

  try {
    const result = await runtime.execute({
      code: `
print("hello", inputs.value)
outputs.answer = inputs.value * 2
outputGraphics("data:image/png;base64,abc123")
`,
      inputs: { value: 21 },
      timeoutMs: 1000,
    });

    assert.equal(result.outputs.answer, 42);
    assert.equal(result.graphicsOutput, 'data:image/png;base64,abc123');
    assert.match(result.textOutput ?? '', /hello 21/);
  } finally {
    await runtime.dispose();
  }
});

test('PythonProcessRuntime exposes meta to inline code', { skip: skipPythonTests }, async () => {
  const runtime = new PythonProcessRuntime();

  try {
    const result = await runtime.execute({
      code: `
outputs.answer = meta.custom.multiplier * inputs.value
outputs.graphName = meta.graph.name
outputs.nodeId = meta.node.id
outputs.nestedEnabled = meta.custom.nested.enabled
`,
      inputs: { value: 7 },
      meta: {
        custom: {
          multiplier: 6,
          nested: {
            enabled: true,
          },
        },
        graph: {
          id: 'graph-a',
          name: 'Graph A',
        },
        node: {
          id: 'node-b',
          name: 'Node B',
        },
      },
      timeoutMs: 1000,
    });

    assert.equal(result.outputs.answer, 42);
    assert.equal(result.outputs.graphName, 'Graph A');
    assert.equal(result.outputs.nodeId, 'node-b');
    assert.equal(result.outputs.nestedEnabled, true);
  } finally {
    await runtime.dispose();
  }
});

test('PythonProcessRuntime ignores non-protocol stdout writes and still parses wrapped JSON payload', { skip: skipPythonTests }, async () => {
  const runtime = new PythonProcessRuntime();

  try {
    const result = await runtime.execute({
      code: `
import sys
sys.stdout.write("Crap 2\\n")
print("hello from wrapper print")
outputs.answer = 42
`,
      inputs: {},
      timeoutMs: 1000,
    });

    assert.equal(result.outputs.answer, 42);
    assert.match(result.textOutput ?? '', /hello from wrapper print/);
    assert.equal((result.textOutput ?? '').includes('Crap 2'), false);
  } finally {
    await runtime.dispose();
  }
});

test('PythonProcessRuntime captures builtins.print calls from imported scopes', { skip: skipPythonTests }, async () => {
  const runtime = new PythonProcessRuntime();

  try {
    const result = await runtime.execute({
      code: `
import builtins

def emit():
    builtins.print("from builtins print")

emit()
outputs.answer = 7
`,
      inputs: {},
      timeoutMs: 1000,
    });

    assert.equal(result.outputs.answer, 7);
    assert.match(result.textOutput ?? '', /from builtins print/);
  } finally {
    await runtime.dispose();
  }
});

test('PythonProcessRuntime captures execution errors as text output', { skip: skipPythonTests }, async () => {
  const runtime = new PythonProcessRuntime();

  try {
    const result = await runtime.execute({
      code: `
raise RuntimeError("boom")
`,
      inputs: {},
      timeoutMs: 1000,
    });

    assert.deepEqual(result.outputs, {});
    assert.match(result.textOutput ?? '', /Error: boom/);
  } finally {
    await runtime.dispose();
  }
});

test('PythonProcessRuntime enforces timeout for runaway code', { skip: skipPythonTests }, async () => {
  const runtime = new PythonProcessRuntime();

  try {
    const result = await runtime.execute({
      code: `
import time
time.sleep(0.2)
`,
      inputs: {},
      timeoutMs: 50,
    });

    assert.deepEqual(result.outputs, {});
    assert.match(result.textOutput ?? '', /timed out/i);
  } finally {
    await runtime.dispose();
  }
});

test('PythonProcessRuntime reuses a warm service for repeated executions in the same graph/env scope', { skip: skipPythonTests }, async () => {
  const runtime = new PythonProcessRuntime();

  try {
    const first = await runtime.execute({
      code: 'outputs.answer = inputs.value + 1',
      inputs: { value: 1 },
      timeoutMs: 1000,
      graphId: 'graph-a',
      workerConcurrencyHint: 2,
    });
    const second = await runtime.execute({
      code: 'outputs.answer = inputs.value + 2',
      inputs: { value: 2 },
      timeoutMs: 1000,
      graphId: 'graph-a',
      workerConcurrencyHint: 2,
    });

    assert.equal(first.outputs.answer, 2);
    assert.equal(second.outputs.answer, 4);
    assert.equal(runtime.getActiveServiceCount(), 1);
  } finally {
    await runtime.dispose();
  }
});

test('PythonExecutionManager keeps a warm service alive while a new request is entering execution', { skip: skipPythonTests }, async () => {
  const manager = new PythonExecutionManager();
  const pythonBin = process.env.K8V_PYTHON_BIN || 'python3';

  try {
    const first = await manager.execute({
      code: 'outputs.answer = 1',
      inputs: {},
      timeoutMs: 1000,
      pythonBin,
      graphId: 'graph-idle-boundary',
    });

    assert.equal(first.outputs.answer, 1);

    const services = (manager as any).services as Map<string, any>;
    assert.equal(services.size, 1);

    const service = services.values().next().value as any;
    const originalEnsureStarted = service.ensureStarted.bind(service);

    service.ensureStarted = async () => {
      await new Promise(resolve => setTimeout(resolve, 20));
      return await originalEnsureStarted();
    };
    service.idleTtlMs = 1;
    service.lastUsedAt = Date.now() - 100;
    service.clearIdleTimer();
    service.scheduleIdleTimer();

    const second = await manager.execute({
      code: 'outputs.answer = 2',
      inputs: {},
      timeoutMs: 1000,
      pythonBin,
      graphId: 'graph-idle-boundary',
    });

    assert.equal(second.outputs.answer, 2);
    assert.equal(manager.getActiveServiceCount(), 1);
  } finally {
    await manager.dispose();
  }
});

test('PythonProcessRuntime keeps separate warm services per graph and can drop one graph scope', { skip: skipPythonTests }, async () => {
  const runtime = new PythonProcessRuntime();

  try {
    await runtime.execute({
      code: 'outputs.answer = 1',
      inputs: {},
      timeoutMs: 1000,
      graphId: 'graph-a',
    });
    await runtime.execute({
      code: 'outputs.answer = 2',
      inputs: {},
      timeoutMs: 1000,
      graphId: 'graph-b',
    });

    assert.equal(runtime.getActiveServiceCount(), 2);

    await runtime.dropGraph('graph-a');

    assert.equal(runtime.getActiveServiceCount(), 1);
  } finally {
    await runtime.dispose();
  }
});

test('PythonProcessRuntime preserves parallel execution within one graph/env service pool', { skip: skipPythonTests }, async () => {
  const runtime = new PythonProcessRuntime();

  try {
    await runtime.execute({
      code: 'outputs.ready = True',
      inputs: {},
      timeoutMs: 1000,
      graphId: 'graph-parallel',
      workerConcurrencyHint: 2,
    });

    const startedAt = Date.now();
    const [left, right] = await Promise.all([
      runtime.execute({
        code: `
import time
time.sleep(0.25)
outputs.value = inputs.value
`,
        inputs: { value: 'left' },
        timeoutMs: 1000,
        graphId: 'graph-parallel',
        workerConcurrencyHint: 2,
      }),
      runtime.execute({
        code: `
import time
time.sleep(0.25)
outputs.value = inputs.value
`,
        inputs: { value: 'right' },
        timeoutMs: 1000,
        graphId: 'graph-parallel',
        workerConcurrencyHint: 2,
      }),
    ]);
    const elapsedMs = Date.now() - startedAt;

    assert.equal(left.outputs.value, 'left');
    assert.equal(right.outputs.value, 'right');
    assert.ok(elapsedMs < 450, `expected warm parallel execution under 450ms, got ${elapsedMs}ms`);
  } finally {
    await runtime.dispose();
  }
});

test('PythonProcessRuntime retries once after timeout and returns a later successful result', { skip: skipPythonTests }, async () => {
  const runtime = new PythonProcessRuntime('python3', 1);
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'k8v-python-timeout-retry-'));

  try {
    const result = await runtime.execute({
      code: `
import os
import time

marker = os.path.join(os.getcwd(), "attempt.txt")
if not os.path.exists(marker):
    with open(marker, "w", encoding="utf-8") as handle:
        handle.write("1")
    time.sleep(0.2)

outputs.recovered = True
`,
      inputs: {},
      timeoutMs: 50,
      cwd: tmpDir,
      graphId: 'graph-timeout-retry',
    });

    assert.equal(result.outputs.recovered, true);
  } finally {
    await runtime.dispose();
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('PythonProcessRuntime reports timeout after all retry attempts are exhausted', { skip: skipPythonTests }, async () => {
  const runtime = new PythonProcessRuntime('python3', 1);

  try {
    const result = await runtime.execute({
      code: `
import time
time.sleep(0.2)
`,
      inputs: {},
      timeoutMs: 20,
      graphId: 'graph-timeout-fail',
    });

    assert.deepEqual(result.outputs, {});
    assert.match(result.textOutput ?? '', /timed out/i);
    assert.match(result.textOutput ?? '', /attempts/i);
  } finally {
    await runtime.dispose();
  }
});

test('PythonProcessRuntime supports request-level pythonBin and cwd overrides', { skip: skipPythonTests }, async () => {
  const runtime = new PythonProcessRuntime('python-does-not-exist');
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'k8v-python-runtime-cwd-'));
  const pythonBin = process.env.K8V_PYTHON_BIN || 'python3';

  try {
    const result = await runtime.execute({
      code: `
import os
outputs.cwd = os.getcwd()
`,
      inputs: {},
      timeoutMs: 1000,
      pythonBin,
      cwd: tmpDir,
      graphId: 'graph-cwd-override',
    });

    const expectedCwd = await fs.realpath(tmpDir);
    const actualCwd = await fs.realpath(result.outputs.cwd);
    assert.equal(actualCwd, expectedCwd);
  } finally {
    await runtime.dispose();
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('PythonProcessRuntime reloads cwd-local modules between executions on the same warm service', { skip: skipPythonTests }, async () => {
  const runtime = new PythonProcessRuntime();
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'k8v-python-module-reload-'));
  const modulePath = path.join(tmpDir, 'helper.py');

  try {
    await fs.writeFile(modulePath, 'VALUE = 1\n', 'utf8');
    const first = await runtime.execute({
      code: `
import helper
outputs.value = helper.VALUE
`,
      inputs: {},
      timeoutMs: 1000,
      cwd: tmpDir,
      graphId: 'graph-module-reload',
    });

    await fs.writeFile(modulePath, 'VALUE = 22\n', 'utf8');
    const second = await runtime.execute({
      code: `
import helper
outputs.value = helper.VALUE
`,
      inputs: {},
      timeoutMs: 1000,
      cwd: tmpDir,
      graphId: 'graph-module-reload',
    });

    assert.equal(first.outputs.value, 1);
    assert.equal(second.outputs.value, 22);
    assert.equal(runtime.getActiveServiceCount(), 1);
  } finally {
    await runtime.dispose();
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('PythonProcessRuntime preserves cwd-local native extension modules across warm executions', { skip: skipPythonTests }, async (t) => {
  const runtime = new PythonProcessRuntime();
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'k8v-python-native-module-reuse-'));

  try {
    const buildResult = buildReloadGuardExtension(tmpDir);
    if (!buildResult.ok) {
      t.skip(buildResult.reason);
      return;
    }

    const first = await runtime.execute({
      code: `
import reload_guard
outputs.value = 1
`,
      inputs: {},
      timeoutMs: 1000,
      cwd: tmpDir,
      graphId: 'graph-native-module-reuse',
    });

    const second = await runtime.execute({
      code: `
import reload_guard
outputs.value = 2
`,
      inputs: {},
      timeoutMs: 1000,
      cwd: tmpDir,
      graphId: 'graph-native-module-reuse',
    });

    assert.equal(first.outputs.value, 1);
    assert.equal(second.outputs.value, 2);
    assert.equal(second.textOutput, null);
    assert.equal(runtime.getActiveServiceCount(), 1);
  } finally {
    await runtime.dispose();
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('PythonProcessRuntime converts bytes passed to outputGraphics into PNG data URL', { skip: skipPythonTests }, async () => {
  const runtime = new PythonProcessRuntime();

  try {
    const result = await runtime.execute({
      code: `
import base64
outputGraphics(base64.b64decode("${PNG_1X1_BASE64}"))
`,
      inputs: {},
      timeoutMs: 1000,
    });

    assert.equal(result.graphicsOutput, `data:image/png;base64,${PNG_1X1_BASE64}`);
  } finally {
    await runtime.dispose();
  }
});

test('PythonProcessRuntime accepts raw PNG base64 via outputPng helper', { skip: skipPythonTests }, async () => {
  const runtime = new PythonProcessRuntime();

  try {
    const result = await runtime.execute({
      code: `
outputPng("${PNG_1X1_BASE64}")
`,
      inputs: {},
      timeoutMs: 1000,
    });

    assert.equal(result.graphicsOutput, `data:image/png;base64,${PNG_1X1_BASE64}`);
  } finally {
    await runtime.dispose();
  }
});
