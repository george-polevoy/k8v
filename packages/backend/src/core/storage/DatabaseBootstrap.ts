import type Database from 'better-sqlite3';

export function initializeDataStoreDatabase(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS computation_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      node_id TEXT NOT NULL,
      version TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      data_path TEXT NOT NULL,
      schema_path TEXT NOT NULL,
      text_output_path TEXT,
      graphics_output_path TEXT
    );

    CREATE TABLE IF NOT EXISTS graphs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      data TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  migrateComputationResultsSchemaIfNeeded(db);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_computation_node_version_timestamp
      ON computation_results(node_id, version, timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_computation_node_timestamp
      ON computation_results(node_id, timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_graph_updated ON graphs(updated_at);
  `);
}

function migrateComputationResultsSchemaIfNeeded(db: Database.Database): void {
  const tableInfo = db
    .prepare('PRAGMA table_info(computation_results)')
    .all() as Array<{ name: string; pk: number }>;

  if (tableInfo.length === 0) {
    return;
  }

  const nodeIdColumn = tableInfo.find((column) => column.name === 'node_id');
  const hasIdColumn = tableInfo.some((column) => column.name === 'id');
  const usesLegacyPrimaryKey = Boolean(nodeIdColumn?.pk === 1 && !hasIdColumn);

  if (!usesLegacyPrimaryKey) {
    return;
  }

  const migrate = db.transaction(() => {
    db.exec(`
      ALTER TABLE computation_results RENAME TO computation_results_legacy;

      CREATE TABLE computation_results (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        node_id TEXT NOT NULL,
        version TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        data_path TEXT NOT NULL,
        schema_path TEXT NOT NULL,
        text_output_path TEXT,
        graphics_output_path TEXT
      );

      INSERT INTO computation_results
        (node_id, version, timestamp, data_path, schema_path, text_output_path, graphics_output_path)
      SELECT
        node_id, version, timestamp, data_path, schema_path, text_output_path, graphics_output_path
      FROM computation_results_legacy;

      DROP TABLE computation_results_legacy;
    `);
  });

  migrate();
}

