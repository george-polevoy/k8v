import assert from 'node:assert/strict';
import test from 'node:test';
import { MemoryLocalStorage } from './graphStoreTestUtils.ts';
import {
  clearGraphViewportTransform,
  readFloatingWindowPosition,
  readGraphViewportTransform,
  saveFloatingWindowPosition,
  saveGraphViewportTransform,
} from '../src/utils/uiPersistence.ts';

test.beforeEach(() => {
  (globalThis as { localStorage?: MemoryLocalStorage }).localStorage = new MemoryLocalStorage();
});

test('floating window positions round-trip through persisted UI state', () => {
  saveFloatingWindowPosition('toolbar', { x: 164, y: 92 });

  assert.deepEqual(readFloatingWindowPosition('toolbar'), {
    x: 164,
    y: 92,
  });
});

test('graph viewport persistence ignores malformed values and clears cleanly', () => {
  globalThis.localStorage?.setItem(
    'k8v-graph-viewport-transform:graph-1',
    JSON.stringify({ x: 120, y: 'bad', scale: 1.4 })
  );
  assert.equal(readGraphViewportTransform('graph-1'), null);

  saveGraphViewportTransform('graph-1', {
    x: 220,
    y: 140,
    scale: 1.6,
  });
  assert.deepEqual(readGraphViewportTransform('graph-1'), {
    x: 220,
    y: 140,
    scale: 1.6,
  });

  clearGraphViewportTransform('graph-1');
  assert.equal(readGraphViewportTransform('graph-1'), null);
});
