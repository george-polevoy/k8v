import Database from 'better-sqlite3';
import { ComputationResult } from '../types/index.js';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import { randomUUID } from 'node:crypto';
import {
  buildStoredGraphicsLevels,
  chooseGraphicsLevel,
  parseGraphicsPayload,
  PublicGraphicsArtifact,
  StoredGraphicsArtifact,
  toPublicGraphicsArtifact,
} from './graphicsArtifacts.js';

const GRAPHICS_ID_PREFIX = 'gfx_';

/**
 * Data store for persisting computation results and metadata
 */
export class DataStore {
  private db: Database.Database;
  private dataDir: string;
  private graphicsDir: string;

  constructor(dbPath: string = ':memory:', dataDir: string = './data') {
    this.db = new Database(dbPath);
    this.dataDir = dataDir;
    this.graphicsDir = path.join(this.dataDir, 'graphics');
    this.initializeDatabase();
    this.ensureDataDirectorySync();
  }

  private initializeDatabase(): void {
    this.db.exec(`
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

    this.migrateComputationResultsSchemaIfNeeded();

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_computation_node_version_timestamp
        ON computation_results(node_id, version, timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_computation_node_timestamp
        ON computation_results(node_id, timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_graph_updated ON graphs(updated_at);
    `);
  }

  /**
   * Migrate legacy computation_results schema that used node_id as PRIMARY KEY.
   * That schema overwrote previous versions for the same node.
   */
  private migrateComputationResultsSchemaIfNeeded(): void {
    const tableInfo = this.db
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

    const migrate = this.db.transaction(() => {
      this.db.exec(`
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

  /**
   * Synchronously ensure data directory exists (called from constructor)
   */
  private ensureDataDirectorySync(): void {
    try {
      fsSync.mkdirSync(this.dataDir, { recursive: true });
      fsSync.mkdirSync(this.graphicsDir, { recursive: true });
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
    const textOutputPath = result.textOutput
      ? path.join(this.dataDir, `${nodeId}_${result.timestamp}_text.txt`)
      : null;
    const graphics = result.graphicsOutput
      ? await this.storeGraphicsArtifact(result.graphicsOutput)
      : null;
    const graphicsOutputPath = graphics?.id ?? null;

    // Serialize outputs
    await fs.writeFile(dataPath, JSON.stringify(result.outputs, null, 2));

    // Serialize schema
    await fs.writeFile(schemaPath, JSON.stringify(result.schema, null, 2));

    // Store text output
    if (result.textOutput && textOutputPath) {
      await fs.writeFile(textOutputPath, result.textOutput);
    }

    // Store metadata in database without replacing previous versions.
    const stmt = this.db.prepare(`
      INSERT INTO computation_results 
      (node_id, version, timestamp, data_path, schema_path, text_output_path, graphics_output_path)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      nodeId,
      result.version,
      result.timestamp,
      dataPath,
      schemaPath,
      textOutputPath,
      graphicsOutputPath
    );
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

    // Load text output if exists
    let textOutput: string | undefined;
    if (row.text_output_path) {
      try {
        textOutput = await fs.readFile(row.text_output_path, 'utf-8');
      } catch {
        // File might not exist, ignore
      }
    }

    // Load graphics metadata if exists
    let graphics: PublicGraphicsArtifact | undefined;
    if (typeof row.graphics_output_path === 'string' && row.graphics_output_path.trim()) {
      const graphicsValue = row.graphics_output_path.trim();
      if (this.isGraphicsArtifactId(graphicsValue)) {
        const metadata = await this.readStoredGraphicsArtifact(graphicsValue);
        if (metadata) {
          graphics = toPublicGraphicsArtifact(metadata);
        }
      } else if (typeof row.id === 'number') {
        const migrated = await this.migrateLegacyGraphicsPath(row.id, graphicsValue);
        if (migrated) {
          graphics = toPublicGraphicsArtifact(migrated);
        }
      }
    }

    return {
      nodeId,
      outputs,
      schema,
      timestamp: row.timestamp,
      version: row.version,
      textOutput,
      graphics,
    };
  }

  async getGraphicsArtifact(graphicsId: string): Promise<PublicGraphicsArtifact | null> {
    if (!this.isGraphicsArtifactId(graphicsId)) {
      return null;
    }

    const metadata = await this.readStoredGraphicsArtifact(graphicsId);
    if (!metadata) {
      return null;
    }

    return toPublicGraphicsArtifact(metadata);
  }

  async getGraphicsBinary(
    graphicsId: string,
    maxPixels?: number
  ): Promise<{
    buffer: Buffer;
    mimeType: string;
    selectedLevel: { level: number; width: number; height: number; pixelCount: number };
  } | null> {
    if (!this.isGraphicsArtifactId(graphicsId)) {
      return null;
    }

    const metadata = await this.readStoredGraphicsArtifact(graphicsId);
    if (!metadata) {
      return null;
    }

    const selectedLevel = chooseGraphicsLevel(metadata.levels, maxPixels);
    const levelPath = path.join(this.getGraphicsArtifactDir(graphicsId), selectedLevel.fileName);
    const buffer = await fs.readFile(levelPath);
    return {
      buffer,
      mimeType: metadata.mimeType,
      selectedLevel: {
        level: selectedLevel.level,
        width: selectedLevel.width,
        height: selectedLevel.height,
        pixelCount: selectedLevel.pixelCount,
      },
    };
  }

  private async storeGraphicsArtifact(raw: string): Promise<StoredGraphicsArtifact | null> {
    const parsed = parseGraphicsPayload(raw);
    if (!parsed.buffer || parsed.buffer.length === 0) {
      return null;
    }

    return this.persistGraphicsArtifactBuffer(parsed.mimeType, parsed.buffer);
  }

  private async persistGraphicsArtifactBuffer(
    mimeType: string,
    buffer: Buffer
  ): Promise<StoredGraphicsArtifact> {
    const graphicsId = this.createGraphicsArtifactId();
    const artifactDir = this.getGraphicsArtifactDir(graphicsId);
    await fs.mkdir(artifactDir, { recursive: true });

    const storedLevels = buildStoredGraphicsLevels(mimeType, buffer).map((level, index) => ({
      level: index,
      width: Math.max(1, level.width),
      height: Math.max(1, level.height),
      pixelCount: Math.max(1, level.width * level.height),
      fileName: level.fileName,
      buffer: level.buffer,
    }));

    await Promise.all(
      storedLevels.map((level) => fs.writeFile(path.join(artifactDir, level.fileName), level.buffer))
    );

    const metadata: StoredGraphicsArtifact = {
      id: graphicsId,
      mimeType,
      createdAt: Date.now(),
      levels: storedLevels.map((level) => ({
        level: level.level,
        width: level.width,
        height: level.height,
        pixelCount: level.pixelCount,
        fileName: level.fileName,
      })),
    };

    await fs.writeFile(this.getGraphicsMetadataPath(graphicsId), JSON.stringify(metadata, null, 2));
    return metadata;
  }

  private async readStoredGraphicsArtifact(graphicsId: string): Promise<StoredGraphicsArtifact | null> {
    try {
      const metadataRaw = await fs.readFile(this.getGraphicsMetadataPath(graphicsId), 'utf-8');
      const parsed = JSON.parse(metadataRaw) as StoredGraphicsArtifact;
      if (!parsed?.id || !Array.isArray(parsed.levels) || parsed.levels.length === 0) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  private async migrateLegacyGraphicsPath(
    rowId: number,
    legacyPathWithoutExtension: string
  ): Promise<StoredGraphicsArtifact | null> {
    const legacyPath = await this.resolveLegacyGraphicsPath(legacyPathWithoutExtension);
    if (!legacyPath) {
      return null;
    }

    try {
      const buffer = await fs.readFile(legacyPath);
      const extension = path.extname(legacyPath).slice(1).toLowerCase();
      const mimeType = this.mimeTypeFromExtension(extension);
      const stored = await this.persistGraphicsArtifactBuffer(mimeType, buffer);

      this.db
        .prepare('UPDATE computation_results SET graphics_output_path = ? WHERE id = ?')
        .run(stored.id, rowId);

      return stored;
    } catch {
      return null;
    }
  }

  private async resolveLegacyGraphicsPath(basePath: string): Promise<string | null> {
    const trimmed = basePath.trim();
    if (!trimmed) {
      return null;
    }

    if (path.extname(trimmed)) {
      try {
        await fs.access(trimmed);
        return trimmed;
      } catch {
        return null;
      }
    }

    const possibleExtensions = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'dat'];
    for (const extension of possibleExtensions) {
      const candidate = `${trimmed}.${extension}`;
      try {
        await fs.access(candidate);
        return candidate;
      } catch {
        // Continue probing.
      }
    }

    return null;
  }

  private mimeTypeFromExtension(extension: string): string {
    switch (extension) {
      case 'png':
        return 'image/png';
      case 'jpg':
      case 'jpeg':
        return 'image/jpeg';
      case 'gif':
        return 'image/gif';
      case 'svg':
        return 'image/svg+xml';
      default:
        return 'application/octet-stream';
    }
  }

  private createGraphicsArtifactId(): string {
    return `${GRAPHICS_ID_PREFIX}${randomUUID()}`;
  }

  private isGraphicsArtifactId(value: string): boolean {
    return value.startsWith(GRAPHICS_ID_PREFIX);
  }

  private getGraphicsArtifactDir(graphicsId: string): string {
    return path.join(this.graphicsDir, graphicsId);
  }

  private getGraphicsMetadataPath(graphicsId: string): string {
    return path.join(this.getGraphicsArtifactDir(graphicsId), 'metadata.json');
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
    const row = stmt.get(graphId) as { data: string } | undefined;

    if (!row) {
      return null;
    }

    return JSON.parse(row.data);
  }

  /**
   * Delete graph by id
   */
  async deleteGraph(graphId: string): Promise<boolean> {
    const stmt = this.db.prepare('DELETE FROM graphs WHERE id = ?');
    const result = stmt.run(graphId);
    return result.changes > 0;
  }

  /**
   * List all graphs
   */
  async listGraphs(): Promise<Array<{ id: string; name: string; updatedAt: number }>> {
    const stmt = this.db.prepare('SELECT id, name, updated_at FROM graphs ORDER BY updated_at DESC');
    const rows = stmt.all() as Array<{ id: string; name: string; updated_at: number }>;

    return rows.map((row) => ({
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
    const row = stmt.get() as { data: string } | undefined;

    if (!row) {
      return null;
    }

    return JSON.parse(row.data);
  }

  close(): void {
    this.db.close();
  }
}
