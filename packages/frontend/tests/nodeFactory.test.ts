import test from 'node:test';
import assert from 'node:assert/strict';
import { createAnnotationNode, createInlineCodeNode, createNumericInputNode } from '../src/utils/nodeFactory.ts';
import { NodeType } from '../src/types.ts';

test('createInlineCodeNode uses javascript_vm runtime by default', () => {
  const node = createInlineCodeNode({
    position: { x: 0, y: 0 },
  });

  assert.equal(node.config.runtime, 'javascript_vm');
});

test('createInlineCodeNode honors explicit runtime option', () => {
  const node = createInlineCodeNode({
    position: { x: 10, y: 10 },
    runtime: 'custom_runtime',
  });

  assert.equal(node.config.runtime, 'custom_runtime');
});

test('createInlineCodeNode stores explicit python env name when provided', () => {
  const node = createInlineCodeNode({
    position: { x: 5, y: 5 },
    runtime: 'python_process',
    pythonEnv: 'analytics',
  });

  assert.equal(node.config.runtime, 'python_process');
  assert.equal(node.config.pythonEnv, 'analytics');
});

test('createInlineCodeNode stores explicit custom metadata when provided', () => {
  const node = createInlineCodeNode({
    position: { x: 6, y: 4 },
    custom: {
      owner: 'frontend',
      nested: {
        enabled: true,
      },
    },
  });

  assert.deepEqual(node.metadata.custom, {
    owner: 'frontend',
    nested: {
      enabled: true,
    },
  });
});

test('createInlineCodeNode honors explicit input and output port names', () => {
  const node = createInlineCodeNode({
    position: { x: 12, y: 8 },
    inputNames: ['a', 'b'],
    outputNames: ['sum'],
  });

  assert.deepEqual(node.metadata.inputs.map((port) => port.name), ['a', 'b']);
  assert.deepEqual(node.metadata.outputs.map((port) => port.name), ['sum']);
});

test('createNumericInputNode uses numeric defaults and numeric_input type', () => {
  const node = createNumericInputNode({
    position: { x: 20, y: 30 },
  });

  assert.equal(node.type, NodeType.NUMERIC_INPUT);
  assert.equal(node.metadata.outputs.length, 1);
  assert.equal(node.metadata.outputs[0]?.name, 'value');
  assert.equal(node.config.value, 0);
  assert.equal(node.config.min, 0);
  assert.equal(node.config.max, 100);
  assert.equal(node.config.step, 1);
  assert.equal(node.config.dragDebounceSeconds, 0.1);
});

test('createNumericInputNode stores propagateWhileDragging when enabled', () => {
  const node = createNumericInputNode({
    position: { x: 24, y: 36 },
    propagateWhileDragging: true,
  });

  assert.equal(node.config.propagateWhileDragging, true);
});

test('createNumericInputNode stores explicit drag debounce seconds when provided', () => {
  const node = createNumericInputNode({
    position: { x: 18, y: 22 },
    dragDebounceSeconds: 0.35,
  });

  assert.equal(node.config.dragDebounceSeconds, 0.35);
});

test('createAnnotationNode uses markdown/text color defaults and annotation type', () => {
  const node = createAnnotationNode({
    position: { x: 4, y: 9 },
  });

  assert.equal(node.type, NodeType.ANNOTATION);
  assert.equal(node.metadata.inputs.length, 0);
  assert.equal(node.metadata.outputs.length, 0);
  assert.equal(node.config.text, '');
  assert.equal(node.config.backgroundColor, '#fef3c7');
  assert.equal(node.config.borderColor, '#334155');
  assert.equal(node.config.fontColor, '#1f2937');
  assert.equal(node.config.fontSize, 14);
});
