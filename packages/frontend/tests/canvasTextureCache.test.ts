import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clearAllNodeGraphicsTextures,
  destroyNodeGraphicsTexture,
  releaseUnusedNodeGraphicsTextures,
  type TextureCacheState,
} from '../src/utils/canvasTextureCache.ts';

function createFakeTexture() {
  let destroyCallCount = 0;
  const texture = {
    baseTexture: {
      valid: true,
      once: () => undefined,
    },
    destroy: () => {
      destroyCallCount += 1;
    },
  } as unknown as Texture;

  return {
    texture,
    getDestroyCallCount: () => destroyCallCount,
  };
}

function createTextureCacheState(): TextureCacheState {
  return {
    graphicsTextureCache: new Map(),
    pendingGraphicsTextureLoads: new Map(),
    nodeGraphicsTextureBindings: new Map(),
    nodePendingGraphicsTextureBindings: new Map(),
  };
}

test('destroyNodeGraphicsTexture destroys non-white textures', () => {
  const fake = createFakeTexture();
  destroyNodeGraphicsTexture(fake.texture);
  assert.equal(fake.getDestroyCallCount(), 1);
});

test('releaseUnusedNodeGraphicsTextures removes inactive bindings and releases cache entries', () => {
  const state = createTextureCacheState();
  const textureA = createFakeTexture();
  const textureB = createFakeTexture();

  state.graphicsTextureCache.set('source-a', { texture: textureA.texture, refCount: 1 });
  state.graphicsTextureCache.set('source-b', { texture: textureB.texture, refCount: 2 });
  state.nodeGraphicsTextureBindings.set('node-a', 'source-a');
  state.nodeGraphicsTextureBindings.set('node-b', 'source-b');
  state.nodePendingGraphicsTextureBindings.set('node-c', 'source-b');

  releaseUnusedNodeGraphicsTextures(state, new Set(['node-b']));

  assert.equal(textureA.getDestroyCallCount(), 1);
  assert.equal(state.graphicsTextureCache.has('source-a'), false);
  assert.equal(state.nodeGraphicsTextureBindings.has('node-a'), false);
  assert.equal(state.nodePendingGraphicsTextureBindings.has('node-c'), false);
  assert.equal(state.graphicsTextureCache.get('source-b')?.refCount, 1);
  assert.equal(textureB.getDestroyCallCount(), 0);
});

test('clearAllNodeGraphicsTextures clears all maps and destroys cached textures', () => {
  const state = createTextureCacheState();
  const fakeTexture = createFakeTexture();

  state.graphicsTextureCache.set('source-a', { texture: fakeTexture.texture, refCount: 3 });
  state.nodeGraphicsTextureBindings.set('node-a', 'source-a');
  state.nodePendingGraphicsTextureBindings.set('node-b', 'source-b');
  state.pendingGraphicsTextureLoads.set('source-a', fakeTexture.texture);

  clearAllNodeGraphicsTextures(state);

  assert.equal(fakeTexture.getDestroyCallCount(), 1);
  assert.equal(state.graphicsTextureCache.size, 0);
  assert.equal(state.nodeGraphicsTextureBindings.size, 0);
  assert.equal(state.nodePendingGraphicsTextureBindings.size, 0);
  assert.equal(state.pendingGraphicsTextureLoads.size, 0);
});
