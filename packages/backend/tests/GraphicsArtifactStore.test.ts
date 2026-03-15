import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { GraphicsArtifactStore } from '../src/core/storage/GraphicsArtifactStore.ts';

const PNG_4X4_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAIUlEQVR4AVXBMQ0AIAADsJJM1mTjD+61h/uKoogaUSNqfK+QAylVq4ulAAAAAElFTkSuQmCC';

test('GraphicsArtifactStore persists PNG levels and serves the closest mip by maxPixels', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'k8v-graphics-store-'));
  const store = new GraphicsArtifactStore(tmpDir);

  try {
    const stored = await store.storeGraphicsArtifact(`data:image/png;base64,${PNG_4X4_BASE64}`);
    assert.ok(stored);
    assert.equal(stored?.levels[0]?.width, 4);
    assert.equal(stored?.levels[0]?.height, 4);

    const publicArtifact = await store.getGraphicsArtifact(stored!.id);
    assert.equal(publicArtifact?.mimeType, 'image/png');

    const binary = await store.getGraphicsBinary(stored!.id, 4);
    assert.ok(binary);
    assert.equal(binary?.selectedLevel.width, 2);
    assert.equal(binary?.selectedLevel.height, 2);
    assert.equal(binary?.selectedLevel.pixelCount, 4);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

