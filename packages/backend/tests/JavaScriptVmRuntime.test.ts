import test from 'node:test';
import assert from 'node:assert/strict';
import { JavaScriptVmRuntime } from '../src/core/execution/JavaScriptVmRuntime.js';

test('JavaScriptVmRuntime executes code and captures outputs', async () => {
  const runtime = new JavaScriptVmRuntime();
  const result = await runtime.execute({
    code: `
      print("hello", inputs.value);
      outputs.answer = inputs.value * 2;
      outputGraphics("data:image/png;base64,abc123");
    `,
    inputs: { value: 21 },
    timeoutMs: 1000,
  });

  assert.equal(result.outputs.answer, 42);
  assert.equal(result.graphicsOutput, 'data:image/png;base64,abc123');
  assert.match(result.textOutput ?? '', /hello 21/);
});

test('JavaScriptVmRuntime exposes meta to inline code', async () => {
  const runtime = new JavaScriptVmRuntime();
  const result = await runtime.execute({
    code: `
      outputs.answer = meta.custom.multiplier * inputs.value;
      outputs.graphName = meta.graph.name;
      outputs.nodeId = meta.node.id;
      outputs.nestedEnabled = meta.custom.nested.enabled;
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
});

test('JavaScriptVmRuntime captures execution errors as text output', async () => {
  const runtime = new JavaScriptVmRuntime();
  const result = await runtime.execute({
    code: `
      throw new Error("boom");
    `,
    inputs: {},
    timeoutMs: 1000,
  });

  assert.deepEqual(result.outputs, {});
  assert.match(result.textOutput ?? '', /Error: boom/);
});

test('JavaScriptVmRuntime enforces timeout for runaway code', async () => {
  const runtime = new JavaScriptVmRuntime();
  const result = await runtime.execute({
    code: `
      while (true) {}
    `,
    inputs: {},
    timeoutMs: 50,
  });

  assert.deepEqual(result.outputs, {});
  assert.match(result.textOutput ?? '', /timed out/i);
});
