import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import {
  Graph, GraphCommand, InputDefinition, applyGraphCommandMutation,
  createInlineCodeNode, createNumericInputNode,
} from '../../domain/dist/index.js';
import { DataStore } from '../src/core/DataStore.ts';
import { GraphEngine } from '../src/core/GraphEngine.ts';
import { NodeExecutor } from '../src/core/NodeExecutor.ts';

function fixture(): Graph {
  return Graph.parse({ id: 'inputs-test', name: 'autotests_inline_inputs', revision: 0,
    createdAt: Date.now(), updatedAt: Date.now(), connections: [],
    nodes: [createInlineCodeNode({ nodeId: 'inline', position: { x: 0, y: 0 }, code: 'outputs.output = inputs.flag;' })] });
}

function edit(graph: Graph, command: unknown): Graph {
  return applyGraphCommandMutation(graph, GraphCommand.parse(command));
}

test('typed input commands preserve false, metadata on rename/move, and explicit clearing', () => {
  let graph = edit(fixture(), { kind: 'node_add_input', nodeId: 'inline', inputName: 'flag', schema: { type: 'boolean' }, defaultValue: false });
  graph = edit(graph, { kind: 'node_update_input', nodeId: 'inline', inputName: 'input', schema: { type: 'number' }, defaultValue: 0, editor: { min: 0, max: 10, step: 0.1 } });
  graph = edit(graph, { kind: 'node_rename_input', nodeId: 'inline', oldName: 'input', newName: 'amount' });
  graph = edit(graph, { kind: 'node_move_input', nodeId: 'inline', inputName: 'amount', direction: 'down' });
  assert.equal(graph.nodes[0].metadata.inputs[0].defaultValue, false);
  assert.deepEqual(graph.nodes[0].metadata.inputs[1], { name: 'amount', schema: { type: 'number' }, defaultValue: 0, editor: { min: 0, max: 10, step: 0.1 } });
  assert.throws(() => edit(graph, { kind: 'node_update_input', nodeId: 'inline', inputName: 'amount', schema: { type: 'string' }, editor: null }), /Expected string/);
  graph = edit(graph, { kind: 'node_update_input', nodeId: 'inline', inputName: 'amount', schema: { type: 'string' }, editor: null, clearDefaultValue: true });
  assert.equal(Object.hasOwn(graph.nodes[0].metadata.inputs[1], 'defaultValue'), false);
  assert.equal(Object.hasOwn(graph.nodes[0].metadata.inputs[1], 'editor'), false);
  graph = edit(graph, { kind: 'node_update_input', nodeId: 'inline', inputName: 'amount', defaultValue: '' });
  assert.equal(graph.nodes[0].metadata.inputs[1].defaultValue, '');
  assert.throws(() => edit(graph, { kind: 'node_update_input', nodeId: 'inline', inputName: 'missing' }), /not found/);
  assert.throws(() => edit(graph, { kind: 'node_update_input', nodeId: 'inline', inputName: 'flag', clearDefaultValue: true, defaultValue: true }), /set and clear/);
});

test('input definitions validate numeric settings, dates, types, and legacy/untyped ports', () => {
  for (const input of [
    { schema: { type: 'boolean' }, defaultValue: 'false' },
    { schema: { type: 'number' }, defaultValue: 12, editor: { min: 0, max: 10 } },
    { schema: { type: 'number' }, editor: { min: 10, max: 10 } },
    { schema: { type: 'number' }, editor: { step: 0 } },
    { schema: { type: 'string', format: 'date-time' }, defaultValue: '2026-11-02T12:00' },
    { schema: { type: 'string', format: 'date-time' }, defaultValue: '2026-02-30T12:00:00Z' },
    { schema: { type: 'number', format: 'date-time' } },
    { schema: { type: 'string' }, editor: { min: 0 } },
  ]) assert.equal(InputDefinition.safeParse({ name: 'value', ...input }).success, false, JSON.stringify(input));
  assert.equal(InputDefinition.parse({ name: 'legacy', schema: { type: 'object' } }).schema.type, 'object');
  assert.equal(InputDefinition.parse({ name: 'anything', schema: { type: 'any' }, defaultValue: null }).defaultValue, null);
  assert.equal(InputDefinition.parse({ name: 'date', schema: { type: 'string', format: 'date-time' }, defaultValue: '2026-11-02T15:00:00+03:00' }).defaultValue, '2026-11-02T15:00:00+03:00');
  const graph = edit(fixture(), { kind: 'node_add_input', nodeId: 'inline', inputName: 'untyped' });
  assert.equal(graph.nodes[0].metadata.inputs[1].schema.type, 'any');
});

for (const runtime of ['javascript_vm', 'python_process']) {
  test(`GraphEngine sends local values to ${runtime}, honors connections, and restores defaults`, async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'k8v-inline-inputs-'));
    const store = new DataStore(':memory:', dir);
    const engine = new GraphEngine(store, new NodeExecutor(store));
    let graph = fixture();
    const inline = graph.nodes[0];
    assert.equal(inline.type, 'inline_code');
    if (inline.type !== 'inline_code') throw new Error('Expected inline node');
    inline.config.runtime = runtime;
    inline.config.code = runtime === 'python_process'
      ? "outputs['output'] = [inputs['flag'], inputs['amount'], inputs['text'], inputs['date']]"
      : 'outputs.output = [inputs.flag, inputs.amount, inputs.text, inputs.date];';
    inline.metadata.inputs = [
      { name: 'flag', schema: { type: 'boolean' }, defaultValue: false },
      { name: 'amount', schema: { type: 'number' }, defaultValue: 0, editor: { min: 0, max: 1 } },
      { name: 'text', schema: { type: 'string' }, defaultValue: '' },
      { name: 'date', schema: { type: 'string', format: 'date-time' }, defaultValue: '2026-11-02T12:00:00.000Z' },
    ];
    try {
      await store.storeGraph(graph);
      assert.deepEqual((await engine.computeNode(graph, 'inline')).outputs.output, [false, 0, '', '2026-11-02T12:00:00.000Z']);
      const restored = await store.getGraph(graph.id);
      assert.deepEqual(restored?.nodes[0].metadata.inputs, inline.metadata.inputs);
      graph.nodes.push(createNumericInputNode({ nodeId: 'source', position: { x: 0, y: 0 }, value: 7 }));
      graph = edit(graph, { kind: 'connection_add', sourceNodeId: 'source', sourcePort: 'value', targetNodeId: 'inline', targetPort: 'amount' });
      graph.nodes[0].version = 'connected'; // GraphCommandService invalidates the target on topology changes.
      // Slider bounds constrain local editing, not upstream numeric data.
      assert.deepEqual((await engine.computeNode(graph, 'inline')).outputs.output, [false, 7, '', '2026-11-02T12:00:00.000Z']);
      graph.connections = [];
      graph.nodes[0].version = 'disconnected';
      assert.deepEqual((await engine.computeNode(graph, 'inline')).outputs.output, [false, 0, '', '2026-11-02T12:00:00.000Z']);
      graph = edit(graph, { kind: 'node_update_input', nodeId: 'inline', inputName: 'amount', defaultValue: 1 });
      assert.deepEqual((await engine.computeNode(graph, 'inline')).outputs.output, [false, 1, '', '2026-11-02T12:00:00.000Z']);
    } finally {
      await engine.dispose();
      store.close();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
}

test('connected missing, invalid, or failed output never falls back to a local value', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'k8v-input-source-'));
  const store = new DataStore(':memory:', dir);
  const engine = new GraphEngine(store, new NodeExecutor(store));
  const graph = fixture();
  const target = graph.nodes[0];
  target.metadata.inputs = [{ name: 'flag', schema: { type: 'boolean' }, defaultValue: true }];
  const source = createInlineCodeNode({ nodeId: 'source', position: { x: 0, y: 0 }, outputNames: ['value'], code: 'outputs.value = false;' });
  graph.nodes.push(source);
  graph.connections.push({ id: 'edge', sourceNodeId: 'source', sourcePort: 'value', targetNodeId: 'inline', targetPort: 'flag' });
  try {
    await store.storeGraph(graph);
    assert.equal((await engine.computeNode(graph, 'inline')).outputs.output, false);
    source.config.code = 'outputs.value = "bad";'; source.version = 'bad'; target.version = 'bad';
    await assert.rejects(engine.computeNode(graph, 'inline'), /Input flag: Expected boolean/);
    source.config.code = 'outputs.other = 1;'; source.version = 'missing'; target.version = 'missing';
    assert.equal((await engine.computeNode(graph, 'inline')).outputs.output, undefined);
    source.config.code = 'throw new Error("source failed");'; source.version = 'failed'; target.version = 'failed';
    assert.equal((await engine.computeNode(graph, 'inline')).outputs.output, undefined);
    assert.match((await store.getResult(graph.id, 'source'))?.textOutput ?? '', /source failed/);
  } finally {
    await engine.dispose(); store.close(); await fs.rm(dir, { recursive: true, force: true });
  }
});
