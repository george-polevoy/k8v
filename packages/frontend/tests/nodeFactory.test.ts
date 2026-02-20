import test from 'node:test';
import assert from 'node:assert/strict';
import { createInlineCodeNode } from '../src/utils/nodeFactory.ts';

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
