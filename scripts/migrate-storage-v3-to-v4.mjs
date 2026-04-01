import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  DEFAULT_ANNOTATION_BACKGROUND_COLOR,
  DEFAULT_ANNOTATION_BORDER_COLOR,
  DEFAULT_ANNOTATION_FONT_COLOR,
  DEFAULT_ANNOTATION_FONT_SIZE,
  DEFAULT_ANNOTATION_TEXT,
  Graph,
  normalizeAnnotationFontSize,
  normalizeNumericInputConfig,
} from '../packages/domain/dist/index.js';

export const LEGACY_STORAGE_SCHEMA_VERSION = 3;
export const TARGET_STORAGE_SCHEMA_VERSION = 4;
export const STORAGE_DB_FILE_NAME = 'k8v.sqlite';
export const STORAGE_ARTIFACTS_DIR_NAME = 'artifacts';
export const DEFAULT_ANNOTATION_CARD_WIDTH = 320;
export const DEFAULT_ANNOTATION_CARD_HEIGHT = 200;

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const DEFAULT_STORAGE_BASE_DIR = path.join(REPO_ROOT, 'storage');

export function resolveStorageLayout(baseDir, version) {
  const storageRoot = path.resolve(baseDir, `v${version}`);
  return {
    storageRoot,
    dbPath: path.join(storageRoot, STORAGE_DB_FILE_NAME),
    artifactsDir: path.join(storageRoot, STORAGE_ARTIFACTS_DIR_NAME),
  };
}

export function initializeStorageDatabase(db, schemaVersion) {
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
  `).run(String(schemaVersion));
}

function asRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function asFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asString(value) {
  return typeof value === 'string' ? value : undefined;
}

function migrateSharedConfig(legacyConfigBag) {
  return {
    ...(asFiniteNumber(legacyConfigBag?.cardWidth) !== undefined
      ? { cardWidth: legacyConfigBag.cardWidth }
      : {}),
    ...(asFiniteNumber(legacyConfigBag?.cardHeight) !== undefined
      ? { cardHeight: legacyConfigBag.cardHeight }
      : {}),
    ...(asString(legacyConfigBag?.backgroundColor) ? { backgroundColor: legacyConfigBag.backgroundColor } : {}),
    ...(asString(legacyConfigBag?.borderColor) ? { borderColor: legacyConfigBag.borderColor } : {}),
    ...(typeof legacyConfigBag?.autoRecompute === 'boolean'
      ? { autoRecompute: legacyConfigBag.autoRecompute }
      : {}),
    ...(typeof legacyConfigBag?.displayTextOutputs === 'boolean'
      ? { displayTextOutputs: legacyConfigBag.displayTextOutputs }
      : {}),
    ...(asFiniteNumber(legacyConfigBag?.textOutputMaxLines) !== undefined
      ? { textOutputMaxLines: legacyConfigBag.textOutputMaxLines }
      : {}),
    ...(legacyConfigBag?.textOutputOverflowMode === 'cap' ||
        legacyConfigBag?.textOutputOverflowMode === 'scroll'
      ? { textOutputOverflowMode: legacyConfigBag.textOutputOverflowMode }
      : {}),
  };
}

function migrateLegacyNode(node) {
  const legacyConfig = asRecord(node?.config);
  if (!legacyConfig) {
    return node;
  }

  const legacyConfigBag = asRecord(legacyConfig.config) ?? legacyConfig;
  const sharedConfig = migrateSharedConfig(legacyConfigBag);

  switch (node.type) {
    case 'inline_code':
      return {
        ...node,
        config: {
          code: asString(legacyConfig.code) ?? '',
          ...sharedConfig,
          ...(asString(legacyConfig.runtime) ? { runtime: legacyConfig.runtime } : {}),
          ...(asString(legacyConfig.pythonEnv) ? { pythonEnv: legacyConfig.pythonEnv } : {}),
        },
      };
    case 'subgraph': {
      const subgraphId = asString(legacyConfig.subgraphId);
      if (!subgraphId) {
        throw new Error(`Subgraph node ${node.id} is missing subgraphId`);
      }
      return {
        ...node,
        config: {
          subgraphId,
          ...sharedConfig,
        },
      };
    }
    case 'numeric_input': {
      const numericConfig = normalizeNumericInputConfig({
        value: legacyConfigBag?.value,
        min: legacyConfigBag?.min,
        max: legacyConfigBag?.max,
        step: legacyConfigBag?.step,
        dragDebounceSeconds: legacyConfigBag?.dragDebounceSeconds,
        propagateWhileDragging: legacyConfigBag?.propagateWhileDragging,
      });
      return {
        ...node,
        config: {
          ...numericConfig,
          ...sharedConfig,
        },
      };
    }
    case 'annotation':
      return {
        ...node,
        config: {
          text: asString(legacyConfigBag?.text) ?? DEFAULT_ANNOTATION_TEXT,
          backgroundColor:
            asString(legacyConfigBag?.backgroundColor) ?? DEFAULT_ANNOTATION_BACKGROUND_COLOR,
          borderColor:
            asString(legacyConfigBag?.borderColor) ?? DEFAULT_ANNOTATION_BORDER_COLOR,
          fontColor: asString(legacyConfigBag?.fontColor) ?? DEFAULT_ANNOTATION_FONT_COLOR,
          fontSize: normalizeAnnotationFontSize(
            legacyConfigBag?.fontSize,
            DEFAULT_ANNOTATION_FONT_SIZE
          ),
          cardWidth: asFiniteNumber(legacyConfigBag?.cardWidth) ?? DEFAULT_ANNOTATION_CARD_WIDTH,
          cardHeight: asFiniteNumber(legacyConfigBag?.cardHeight) ?? DEFAULT_ANNOTATION_CARD_HEIGHT,
        },
      };
    default:
      return node;
  }
}

export function migrateLegacyGraphDocument(legacyGraph) {
  const migrated = {
    ...legacyGraph,
    nodes: Array.isArray(legacyGraph?.nodes)
      ? legacyGraph.nodes.map((node) => migrateLegacyNode(node))
      : [],
  };
  return Graph.parse(migrated);
}

function readSchemaVersion(dbPath) {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const row = db.prepare(
      "SELECT value FROM meta WHERE key = 'schema_version'"
    ).get();
    return typeof row?.value === 'string' ? Number.parseInt(row.value, 10) : Number.NaN;
  } finally {
    db.close();
  }
}

function parseArgs(argv) {
  const args = {
    storageBaseDir: process.env.K8V_STORAGE_DIR?.trim()
      ? path.resolve(process.env.K8V_STORAGE_DIR.trim())
      : DEFAULT_STORAGE_BASE_DIR,
  };

  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--storage-base-dir' && argv[index + 1]) {
      args.storageBaseDir = path.resolve(argv[index + 1]);
      index += 1;
    }
  }

  return args;
}

export function runStorageMigration({ storageBaseDir = DEFAULT_STORAGE_BASE_DIR } = {}) {
  const source = resolveStorageLayout(storageBaseDir, LEGACY_STORAGE_SCHEMA_VERSION);
  const target = resolveStorageLayout(storageBaseDir, TARGET_STORAGE_SCHEMA_VERSION);

  if (!fs.existsSync(source.dbPath)) {
    throw new Error(`Source database not found: ${source.dbPath}`);
  }

  const sourceSchemaVersion = readSchemaVersion(source.dbPath);
  if (sourceSchemaVersion !== LEGACY_STORAGE_SCHEMA_VERSION) {
    throw new Error(
      `Expected source schema version ${LEGACY_STORAGE_SCHEMA_VERSION}, found ${sourceSchemaVersion}`
    );
  }

  fs.rmSync(target.storageRoot, { recursive: true, force: true });
  fs.mkdirSync(target.storageRoot, { recursive: true });
  fs.mkdirSync(target.artifactsDir, { recursive: true });

  const sourceDb = new Database(source.dbPath, { readonly: true, fileMustExist: true });
  const targetDb = new Database(target.dbPath);

  try {
    initializeStorageDatabase(targetDb, TARGET_STORAGE_SCHEMA_VERSION);

    const graphRows = sourceDb.prepare(`
      SELECT id, name, revision, document_json, created_at, updated_at
      FROM graphs
      ORDER BY updated_at ASC
    `).all();
    const artifactRows = sourceDb.prepare(`
      SELECT id, mime_type, created_at, levels_json
      FROM artifacts
      ORDER BY created_at ASC
    `).all();
    const resultRows = sourceDb.prepare(`
      SELECT run_id, graph_id, node_id, node_version, timestamp, outputs_json, schema_json, text_output, artifact_id
      FROM node_results
      ORDER BY timestamp ASC
    `).all();

    const insertGraph = targetDb.prepare(`
      INSERT INTO graphs (id, name, revision, document_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const insertArtifact = targetDb.prepare(`
      INSERT INTO artifacts (id, mime_type, created_at, levels_json)
      VALUES (?, ?, ?, ?)
    `);
    const insertResult = targetDb.prepare(`
      INSERT INTO node_results (
        run_id, graph_id, node_id, node_version, timestamp, outputs_json, schema_json, text_output, artifact_id
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const commit = targetDb.transaction(() => {
      for (const row of graphRows) {
        const migratedGraph = migrateLegacyGraphDocument(JSON.parse(row.document_json));
        insertGraph.run(
          row.id,
          migratedGraph.name,
          row.revision,
          JSON.stringify(migratedGraph),
          row.created_at,
          row.updated_at
        );
      }

      for (const row of artifactRows) {
        insertArtifact.run(row.id, row.mime_type, row.created_at, row.levels_json);
      }

      for (const row of resultRows) {
        insertResult.run(
          row.run_id,
          row.graph_id,
          row.node_id,
          row.node_version,
          row.timestamp,
          row.outputs_json,
          row.schema_json,
          row.text_output ?? null,
          row.artifact_id ?? null
        );
      }
    });

    commit();
  } finally {
    sourceDb.close();
    targetDb.close();
  }

  if (fs.existsSync(source.artifactsDir)) {
    fs.cpSync(source.artifactsDir, target.artifactsDir, { recursive: true });
  }

  return {
    source,
    target,
    targetSchemaVersion: TARGET_STORAGE_SCHEMA_VERSION,
  };
}

function isDirectExecution() {
  if (!process.argv[1]) {
    return false;
  }
  return import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
}

if (isDirectExecution()) {
  const args = parseArgs(process.argv.slice(2));
  const result = runStorageMigration({ storageBaseDir: args.storageBaseDir });
  process.stdout.write(
    [
      `Migrated storage from v${LEGACY_STORAGE_SCHEMA_VERSION} to v${TARGET_STORAGE_SCHEMA_VERSION}.`,
      `Source DB: ${result.source.dbPath}`,
      `Target DB: ${result.target.dbPath}`,
      `Target artifacts: ${result.target.artifactsDir}`,
    ].join('\n') + '\n'
  );
}
