import Database from 'better-sqlite3';
import { ComputationResult, DataSchema } from '../types/index.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Data store for persisting computation results and metadata
 */
export class DataStore {
  private db: Database.Database;
  private dataDir: string;

  constructor(dbPath: string = ':memory:', dataDir: string = './data') {
    this.db = new Database(dbPath);
    this.dataDir = dataDir;
    this.initializeDatabase();
    this.ensureDataDirectory();
  }

  private initializeDatabase(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS computation_results (
        node_id TEXT PRIMARY KEY,
        version TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        data_path TEXT NOT NULL,
        schema_path TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS graphs (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        data TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS library_nodes (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        manifest TEXT NOT NULL,
        graph_id TEXT,
        version TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_computation_version ON computation_results(node_id, version);
      CREATE INDEX IF NOT EXISTS idx_graph_updated ON graphs(updated_at);
    `);
  }

  private async ensureDataDirectory(): Promise<void> {
    try {
      await fs.mkdir(this.dataDir, { recursive: true });
    } catch (error) {
      console.error('Failed to create data directory:', error);
    }
  }

  /**
   * Store computation result
   */
  async storeResult(nodeId: string, result: ComputationResult): Promise<void> {
    const dataPath = path.join(this.dataDir, `${nodeId}_${result.timestamp}.json`);
    const schemaPath = path.join(this.dataDir, `${nodeId}_${result.timestamp}_schema.json`);

    // Serialize outputs
    await fs.writeFile(dataPath, JSON.stringify(result.outputs, null, 2));

    // Serialize schema
    await fs.writeFile(schemaPath, JSON.stringify(result.schema, null, 2));

    // Store metadata in database
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO computation_results 
      (node_id, version, timestamp, data_path, schema_path)
      VALUES (?, ?, ?, ?, ?)
    `);

    stmt.run(nodeId, result.version, result.timestamp, dataPath, schemaPath);
  }

  /**
   * Get computation result
   */
  async getResult(nodeId: string, version?: string): Promise<ComputationResult | null> {
    let stmt;
    let row: any;

    if (version) {
      stmt = this.db.prepare(`
        SELECT * FROM computation_results 
        WHERE node_id = ? AND version = ?
        ORDER BY timestamp DESC
        LIMIT 1
      `);
      row = stmt.get(nodeId, version);
    } else {
      stmt = this.db.prepare(`
        SELECT * FROM computation_results 
        WHERE node_id = ?
        ORDER BY timestamp DESC
        LIMIT 1
      `);
      row = stmt.get(nodeId);
    }

    if (!row) {
      return null;
    }

    // Load outputs
    const outputs = JSON.parse(await fs.readFile(row.data_path, 'utf-8'));

    // Load schema
    const schema = JSON.parse(await fs.readFile(row.schema_path, 'utf-8'));

    return {
      nodeId,
      outputs,
      schema,
      timestamp: row.timestamp,
      version: row.version,
    };
  }

  /**
   * Store graph
   */
  async storeGraph(graph: any): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO graphs 
      (id, name, data, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `);

    const now = Date.now();
    stmt.run(
      graph.id,
      graph.name,
      JSON.stringify(graph),
      graph.createdAt || now,
      graph.updatedAt || now
    );
  }

  /**
   * Get graph
   */
  async getGraph(graphId: string): Promise<any | null> {
    const stmt = this.db.prepare('SELECT * FROM graphs WHERE id = ?');
    const row = stmt.get(graphId);

    if (!row) {
      return null;
    }

    return JSON.parse(row.data);
  }

  /**
   * Store library node
   */
  async storeLibraryNode(manifest: any, graphId?: string): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO library_nodes 
      (id, name, manifest, graph_id, version, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      manifest.id,
      manifest.name,
      JSON.stringify(manifest),
      graphId || null,
      manifest.version,
      manifest.createdAt || Date.now()
    );
  }

  /**
   * Get library node manifest
   */
  async getLibraryNode(libraryId: string): Promise<any | null> {
    const stmt = this.db.prepare('SELECT manifest FROM library_nodes WHERE id = ?');
    const row = stmt.get(libraryId);

    if (!row) {
      return null;
    }

    return JSON.parse(row.manifest);
  }

  /**
   * List all library nodes
   */
  async listLibraryNodes(): Promise<any[]> {
    const stmt = this.db.prepare('SELECT manifest FROM library_nodes');
    const rows = stmt.all();

    return rows.map((row: any) => JSON.parse(row.manifest));
  }

  /**
   * List all graphs
   */
  async listGraphs(): Promise<Array<{ id: string; name: string; updatedAt: number }>> {
    const stmt = this.db.prepare('SELECT id, name, updated_at FROM graphs ORDER BY updated_at DESC');
    const rows = stmt.all();

    return rows.map((row: any) => ({
      id: row.id,
      name: row.name,
      updatedAt: row.updated_at,
    }));
  }

  /**
   * Get the most recently updated graph
   */
  async getLatestGraph(): Promise<any | null> {
    const stmt = this.db.prepare('SELECT data FROM graphs ORDER BY updated_at DESC LIMIT 1');
    const row = stmt.get() as any;

    if (!row) {
      return null;
    }

    return JSON.parse(row.data);
  }

  close(): void {
    this.db.close();
  }
}
