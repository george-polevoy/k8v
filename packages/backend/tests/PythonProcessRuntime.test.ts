import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { PythonProcessRuntime } from '../src/core/execution/PythonProcessRuntime.js';

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
