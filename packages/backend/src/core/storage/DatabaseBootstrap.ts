import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

export const STORAGE_SCHEMA_VERSION = 2;
export const STORAGE_DB_FILE_NAME = 'k8v.sqlite';
export const STORAGE_ARTIFACTS_DIR_NAME = 'artifacts';

export interface VersionedStorageLayout {
  storageRoot: string;
  dbPath: string;
  artifactsDir: string;
}

function readSchemaVersion(dbPath: string): number | null {
  try {
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
      const metaExists = db
        .prepare("SELECT 1 AS value FROM sqlite_master WHERE type = 'table' AND name = 'meta'")
        .get() as { value: number } | undefined;
      if (!metaExists) {
        return null;
      }

      const row = db
        .prepare("SELECT value FROM meta WHERE key = 'schema_version'")
        .get() as { value: string } | undefined;
      if (!row?.value) {
        return null;
      }

      const parsed = Number.parseInt(row.value, 10);
      return Number.isFinite(parsed) ? parsed : null;
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

export function resolveVersionedStorageLayout(baseDir = './storage'): VersionedStorageLayout {
  const storageRoot = path.resolve(baseDir, `v${STORAGE_SCHEMA_VERSION}`);
  return {
    storageRoot,
    dbPath: path.join(storageRoot, STORAGE_DB_FILE_NAME),
    artifactsDir: path.join(storageRoot, STORAGE_ARTIFACTS_DIR_NAME),
  };
}

export function prepareVersionedStorageLayout(baseDir = './storage'): VersionedStorageLayout {
  const layout = resolveVersionedStorageLayout(baseDir);
  fs.mkdirSync(path.dirname(layout.storageRoot), { recursive: true });

  const rootExists = fs.existsSync(layout.storageRoot);
  const dbExists = fs.existsSync(layout.dbPath);
  const shouldReset =
    (rootExists && !dbExists) ||
    (dbExists && readSchemaVersion(layout.dbPath) !== STORAGE_SCHEMA_VERSION);

  if (shouldReset) {
    fs.rmSync(layout.storageRoot, { recursive: true, force: true });
  }

  fs.mkdirSync(layout.storageRoot, { recursive: true });
  fs.mkdirSync(layout.artifactsDir, { recursive: true });
  return layout;
}

export function initializeDataStoreDatabase(db: Database.Database): void {
  db.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS graphs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      revision INTEGER NOT NULL,
      document_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS artifacts (
      id TEXT PRIMARY KEY,
      mime_type TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      levels_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS wasm_artifacts (
      id TEXT PRIMARY KEY,
      sha256 TEXT NOT NULL,
      byte_length INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      wasm_blob BLOB NOT NULL
    );

    CREATE TABLE IF NOT EXISTS node_results (
      run_id TEXT PRIMARY KEY,
      graph_id TEXT NOT NULL,
      node_id TEXT NOT NULL,
      node_version TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      outputs_json TEXT NOT NULL,
      schema_json TEXT NOT NULL,
      text_output TEXT,
      artifact_id TEXT,
      FOREIGN KEY (graph_id) REFERENCES graphs(id) ON DELETE CASCADE,
      FOREIGN KEY (artifact_id) REFERENCES artifacts(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_graph_updated ON graphs(updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_node_results_graph_node_time
      ON node_results(graph_id, node_id, timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_node_results_graph_node_version_time
      ON node_results(graph_id, node_id, node_version, timestamp DESC);
  `);

  db.prepare(`
    INSERT INTO meta (key, value)
    VALUES ('schema_version', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(String(STORAGE_SCHEMA_VERSION));
}
