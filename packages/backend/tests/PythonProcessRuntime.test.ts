import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { PythonProcessRuntime } from '../src/core/execution/PythonProcessRuntime.js';

const PNG_1X1_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Z8S8AAAAASUVORK5CYII=';

function hasPythonAvailable(): boolean {
  const result = spawnSync(process.env.K8V_PYTHON_BIN || 'python3', ['--version'], {
    encoding: 'utf8',
  });
  return result.status === 0;
}

const skipPythonTests = !hasPythonAvailable();

test('PythonProcessRuntime executes code and captures outputs', { skip: skipPythonTests }, async () => {
  const runtime = new PythonProcessRuntime();
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
});

test('PythonProcessRuntime ignores non-protocol stdout writes and still parses wrapped JSON payload', { skip: skipPythonTests }, async () => {
  const runtime = new PythonProcessRuntime();
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
});

test('PythonProcessRuntime captures builtins.print calls from imported scopes', { skip: skipPythonTests }, async () => {
  const runtime = new PythonProcessRuntime();
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
});

test('PythonProcessRuntime captures execution errors as text output', { skip: skipPythonTests }, async () => {
  const runtime = new PythonProcessRuntime();
  const result = await runtime.execute({
    code: `
raise RuntimeError("boom")
`,
    inputs: {},
    timeoutMs: 1000,
  });

  assert.deepEqual(result.outputs, {});
  assert.match(result.textOutput ?? '', /Error: boom/);
});

test('PythonProcessRuntime enforces timeout for runaway code', { skip: skipPythonTests }, async () => {
  const runtime = new PythonProcessRuntime();
  const result = await runtime.execute({
    code: `
while True:
    pass
`,
    inputs: {},
    timeoutMs: 50,
  });

  assert.deepEqual(result.outputs, {});
  assert.match(result.textOutput ?? '', /timed out/i);
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
    });

    const expectedCwd = await fs.realpath(tmpDir);
    const actualCwd = await fs.realpath(result.outputs.cwd);
    assert.equal(actualCwd, expectedCwd);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('PythonProcessRuntime converts bytes passed to outputGraphics into PNG data URL', { skip: skipPythonTests }, async () => {
  const runtime = new PythonProcessRuntime();
  const result = await runtime.execute({
    code: `
import base64
outputGraphics(base64.b64decode("${PNG_1X1_BASE64}"))
`,
    inputs: {},
    timeoutMs: 1000,
  });

  assert.equal(result.graphicsOutput, `data:image/png;base64,${PNG_1X1_BASE64}`);
});

test('PythonProcessRuntime accepts raw PNG base64 via outputPng helper', { skip: skipPythonTests }, async () => {
  const runtime = new PythonProcessRuntime();
  const result = await runtime.execute({
    code: `
outputPng("${PNG_1X1_BASE64}")
`,
    inputs: {},
    timeoutMs: 1000,
  });

  assert.equal(result.graphicsOutput, `data:image/png;base64,${PNG_1X1_BASE64}`);
});
