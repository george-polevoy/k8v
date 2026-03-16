import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import Database from 'better-sqlite3';
import {
  STORAGE_SCHEMA_VERSION,
  initializeDataStoreDatabase,
  prepareVersionedStorageLayout,
  resolveVersionedStorageLayout,
} from '../src/core/storage/DatabaseBootstrap.ts';

async function withTempDir(run: (tmpDir: string) => Promise<void>): Promise<void> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'k8v-storage-bootstrap-'));
  try {
    await run(tmpDir);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

function readSchemaVersion(dbPath: string): string | null {
  const db = new Database(dbPath);
  try {
    const row = db
      .prepare("SELECT value FROM meta WHERE key = 'schema_version'")
      .get() as { value?: string } | undefined;
    return row?.value ?? null;
  } finally {
    db.close();
  }
}

test('prepareVersionedStorageLayout initializes the current versioned storage root', async () => {
  await withTempDir(async (tmpDir) => {
    const layout = prepareVersionedStorageLayout(tmpDir);

    assert.equal(layout.storageRoot, path.resolve(tmpDir, `v${STORAGE_SCHEMA_VERSION}`));
    assert.equal(fsSync.existsSync(layout.storageRoot), true);
    assert.equal(fsSync.existsSync(layout.artifactsDir), true);

    const db = new Database(layout.dbPath);
    try {
      initializeDataStoreDatabase(db);
    } finally {
      db.close();
    }

    assert.equal(readSchemaVersion(layout.dbPath), String(STORAGE_SCHEMA_VERSION));
  });
});

test('prepareVersionedStorageLayout discards a corrupted current-version database root', async () => {
  await withTempDir(async (tmpDir) => {
    const layout = resolveVersionedStorageLayout(tmpDir);
    await fs.mkdir(layout.artifactsDir, { recursive: true });
    await fs.writeFile(layout.dbPath, 'not-a-sqlite-database');
    await fs.writeFile(path.join(layout.storageRoot, 'stale.txt'), 'stale');
    await fs.writeFile(path.join(layout.artifactsDir, 'legacy.bin'), 'legacy');

    const prepared = prepareVersionedStorageLayout(tmpDir);

    assert.equal(prepared.storageRoot, layout.storageRoot);
    assert.equal(fsSync.existsSync(path.join(layout.storageRoot, 'stale.txt')), false);
    assert.equal(fsSync.existsSync(path.join(layout.artifactsDir, 'legacy.bin')), false);
    assert.equal(fsSync.existsSync(prepared.artifactsDir), true);
  });
});

test('prepareVersionedStorageLayout discards a current-version database with a mismatched schema version', async () => {
  await withTempDir(async (tmpDir) => {
    const layout = resolveVersionedStorageLayout(tmpDir);
    await fs.mkdir(layout.artifactsDir, { recursive: true });

    const db = new Database(layout.dbPath);
    try {
      db.exec(`
        CREATE TABLE meta (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
      `);
      db.prepare("INSERT INTO meta (key, value) VALUES ('schema_version', ?)").run(
        String(STORAGE_SCHEMA_VERSION + 1)
      );
    } finally {
      db.close();
    }

    await fs.writeFile(path.join(layout.artifactsDir, 'legacy.bin'), 'legacy');

    const prepared = prepareVersionedStorageLayout(tmpDir);

    assert.equal(prepared.storageRoot, layout.storageRoot);
    assert.equal(fsSync.existsSync(path.join(layout.artifactsDir, 'legacy.bin')), false);
    assert.equal(fsSync.existsSync(prepared.artifactsDir), true);
  });
});

test('prepareVersionedStorageLayout ignores older versioned storage roots', async () => {
  await withTempDir(async (tmpDir) => {
    const oldRoot = path.resolve(tmpDir, 'v0');
    const oldArtifactsDir = path.join(oldRoot, 'artifacts');
    const oldMarkerPath = path.join(oldArtifactsDir, 'legacy.txt');
    await fs.mkdir(oldArtifactsDir, { recursive: true });
    await fs.writeFile(oldMarkerPath, 'keep-me');

    const prepared = prepareVersionedStorageLayout(tmpDir);

    assert.equal(prepared.storageRoot, path.resolve(tmpDir, `v${STORAGE_SCHEMA_VERSION}`));
    assert.equal(await fs.readFile(oldMarkerPath, 'utf8'), 'keep-me');
    assert.notEqual(prepared.storageRoot, oldRoot);
  });
});
