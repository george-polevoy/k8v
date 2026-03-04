import { Texture } from 'pixi.js';

export interface GraphicsTextureCacheEntry {
  texture: Texture;
  refCount: number;
}

export interface TextureCacheState {
  graphicsTextureCache: Map<string, GraphicsTextureCacheEntry>;
  pendingGraphicsTextureLoads: Map<string, Texture>;
  nodeGraphicsTextureBindings: Map<string, string>;
  nodePendingGraphicsTextureBindings: Map<string, string>;
}

export function destroyNodeGraphicsTexture(texture: Texture): void {
  const whiteTexture = typeof document !== 'undefined' ? Texture.WHITE : null;
  if (whiteTexture && texture === whiteTexture) {
    return;
  }

  texture.destroy(true);
}

function releaseTextureSource(
  state: TextureCacheState,
  source: string
): void {
  const cached = state.graphicsTextureCache.get(source);
  if (!cached) {
    return;
  }

  if (cached.refCount <= 1) {
    const pendingTexture = state.pendingGraphicsTextureLoads.get(source);
    if (pendingTexture === cached.texture) {
      state.pendingGraphicsTextureLoads.delete(source);
    }
    destroyNodeGraphicsTexture(cached.texture);
    state.graphicsTextureCache.delete(source);
    return;
  }

  cached.refCount -= 1;
}

function queueNodeGraphicsTextureRefresh(
  state: TextureCacheState,
  source: string,
  texture: Texture,
  requestRefresh: () => void
): void {
  const pendingTexture = state.pendingGraphicsTextureLoads.get(source);
  if (texture.baseTexture.valid) {
    if (pendingTexture === texture) {
      state.pendingGraphicsTextureLoads.delete(source);
    }
    return;
  }

  if (pendingTexture === texture) {
    return;
  }

  state.pendingGraphicsTextureLoads.set(source, texture);
  const clearPendingTexture = () => {
    if (state.pendingGraphicsTextureLoads.get(source) === texture) {
      state.pendingGraphicsTextureLoads.delete(source);
    }
  };
  const scheduleGraphicsRefresh = () => {
    if (!texture.baseTexture.valid) {
      return;
    }
    clearPendingTexture();
    requestRefresh();
  };

  texture.baseTexture.once('loaded', scheduleGraphicsRefresh);
  texture.baseTexture.once('update', scheduleGraphicsRefresh);
  texture.baseTexture.once('error', () => {
    clearPendingTexture();
  });
}

function retainTextureSource(
  state: TextureCacheState,
  source: string,
  requestRefresh: () => void
): GraphicsTextureCacheEntry {
  let cached = state.graphicsTextureCache.get(source);
  if (!cached) {
    cached = { texture: Texture.from(source), refCount: 0 };
    state.graphicsTextureCache.set(source, cached);
  }

  cached.refCount += 1;
  queueNodeGraphicsTextureRefresh(state, source, cached.texture, requestRefresh);
  return cached;
}

export function getNodeGraphicsTextureForNode(
  state: TextureCacheState,
  nodeId: string,
  source: string,
  requestRefresh: () => void
): Texture {
  const currentSource = state.nodeGraphicsTextureBindings.get(nodeId);
  const pendingSource = state.nodePendingGraphicsTextureBindings.get(nodeId);
  if (pendingSource && pendingSource !== source) {
    releaseTextureSource(state, pendingSource);
    state.nodePendingGraphicsTextureBindings.delete(nodeId);
  }

  if (currentSource === source) {
    const existing = state.graphicsTextureCache.get(source);
    if (existing) {
      queueNodeGraphicsTextureRefresh(state, source, existing.texture, requestRefresh);
      return existing.texture;
    }

    return retainTextureSource(state, source, requestRefresh).texture;
  }

  if (pendingSource !== source) {
    retainTextureSource(state, source, requestRefresh);
    state.nodePendingGraphicsTextureBindings.set(nodeId, source);
  }

  const nextTexture = state.graphicsTextureCache.get(source)?.texture;
  const canPromoteImmediately = Boolean(nextTexture && (nextTexture.baseTexture.valid || !currentSource));
  if (nextTexture && canPromoteImmediately) {
    if (currentSource) {
      releaseTextureSource(state, currentSource);
    }
    state.nodeGraphicsTextureBindings.set(nodeId, source);
    state.nodePendingGraphicsTextureBindings.delete(nodeId);
    return nextTexture;
  }

  if (currentSource) {
    const currentTexture = state.graphicsTextureCache.get(currentSource)?.texture;
    if (currentTexture) {
      queueNodeGraphicsTextureRefresh(state, currentSource, currentTexture, requestRefresh);
      return currentTexture;
    }
  }

  if (nextTexture) {
    state.nodeGraphicsTextureBindings.set(nodeId, source);
    state.nodePendingGraphicsTextureBindings.delete(nodeId);
    return nextTexture;
  }

  const retained = retainTextureSource(state, source, requestRefresh);
  state.nodeGraphicsTextureBindings.set(nodeId, source);
  state.nodePendingGraphicsTextureBindings.delete(nodeId);
  return retained.texture;
}

export function releaseUnusedNodeGraphicsTextures(
  state: TextureCacheState,
  activeNodeIds: Set<string>
): void {
  for (const [nodeId, source] of state.nodeGraphicsTextureBindings.entries()) {
    if (activeNodeIds.has(nodeId)) {
      continue;
    }

    releaseTextureSource(state, source);
    state.nodeGraphicsTextureBindings.delete(nodeId);
  }

  for (const [nodeId, source] of state.nodePendingGraphicsTextureBindings.entries()) {
    if (activeNodeIds.has(nodeId)) {
      continue;
    }

    releaseTextureSource(state, source);
    state.nodePendingGraphicsTextureBindings.delete(nodeId);
  }
}

export function clearAllNodeGraphicsTextures(state: TextureCacheState): void {
  for (const cacheEntry of state.graphicsTextureCache.values()) {
    destroyNodeGraphicsTexture(cacheEntry.texture);
  }
  state.graphicsTextureCache.clear();
  state.nodeGraphicsTextureBindings.clear();
  state.nodePendingGraphicsTextureBindings.clear();
  state.pendingGraphicsTextureLoads.clear();
}
