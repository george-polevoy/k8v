import test from 'node:test';
import assert from 'node:assert/strict';
import {
  inferInlineInputPortNames,
  inferInlineOutputPortNames,
} from '../src/utils/inlinePortInference.ts';

test('inferInlineInputPortNames extracts identifiers from dot, bracket, and get access', () => {
  const code = [
    'a = inputs.a',
    'b = inputs["b"]',
    'c = inputs.get("c", 0)',
    'd = inputs.get(\'d\')',
  ].join('\n');

  assert.deepEqual(inferInlineInputPortNames(code), ['a', 'b', 'c', 'd']);
});

test('inferInlineInputPortNames ignores dictionary helper method names', () => {
  const code = [
    'pairs = inputs.items()',
    'keys = inputs.keys()',
    'value = inputs.get("a")',
  ].join('\n');

  assert.deepEqual(inferInlineInputPortNames(code), ['a']);
});

test('inferInlineOutputPortNames extracts output identifiers and preserves first appearance order', () => {
  const code = [
    'outputs.status = "ok"',
    'outputs["output"] = 42',
    'outputs.status = "done"',
  ].join('\n');

  assert.deepEqual(inferInlineOutputPortNames(code), ['status', 'output']);
});

test('port inference returns empty arrays when code is blank', () => {
  assert.deepEqual(inferInlineInputPortNames('   '), []);
  assert.deepEqual(inferInlineOutputPortNames(''), []);
});
