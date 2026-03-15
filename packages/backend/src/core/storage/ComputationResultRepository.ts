import type Database from 'better-sqlite3';
import * as fs from 'fs/promises';
import * as path from 'path';
import { ComputationResult } from '../../types/index.js';
import { PublicGraphicsArtifact, toPublicGraphicsArtifact } from '../graphicsArtifacts.js';
import { GraphicsArtifactStore } from './GraphicsArtifactStore.js';

export class ComputationResultRepository {
  constructor(
    private readonly db: Database.Database,
    private readonly dataDir: string,
    private readonly graphicsStore: GraphicsArtifactStore
  ) {}

  async storeResult(nodeId: string, result: ComputationResult): Promise<void> {
    const dataPath = path.join(this.dataDir, `${nodeId}_${result.timestamp}.json`);
    const schemaPath = path.join(this.dataDir, `${nodeId}_${result.timestamp}_schema.json`);
    const textOutputPath = result.textOutput
      ? path.join(this.dataDir, `${nodeId}_${result.timestamp}_text.txt`)
      : null;
    const graphics = result.graphicsOutput
      ? await this.graphicsStore.storeGraphicsArtifact(result.graphicsOutput)
      : null;
    const graphicsOutputPath = graphics?.id ?? null;

    await fs.writeFile(dataPath, JSON.stringify(result.outputs, null, 2));
    await fs.writeFile(schemaPath, JSON.stringify(result.schema, null, 2));

    if (result.textOutput && textOutputPath) {
      await fs.writeFile(textOutputPath, result.textOutput);
    }

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

  async getResult(nodeId: string, version?: string): Promise<ComputationResult | null> {
    let row: any;

    if (version) {
      row = this.db.prepare(`
        SELECT * FROM computation_results
        WHERE node_id = ? AND version = ?
        ORDER BY timestamp DESC
        LIMIT 1
      `).get(nodeId, version);
    } else {
      row = this.db.prepare(`
        SELECT * FROM computation_results
        WHERE node_id = ?
        ORDER BY timestamp DESC
        LIMIT 1
      `).get(nodeId);
    }

    if (!row) {
      return null;
    }

    const outputs = JSON.parse(await fs.readFile(row.data_path, 'utf-8'));
    const schema = JSON.parse(await fs.readFile(row.schema_path, 'utf-8'));

    let textOutput: string | undefined;
    if (row.text_output_path) {
      try {
        textOutput = await fs.readFile(row.text_output_path, 'utf-8');
      } catch {
        // File might not exist, ignore.
      }
    }

    let graphics: PublicGraphicsArtifact | undefined;
    if (typeof row.graphics_output_path === 'string' && row.graphics_output_path.trim()) {
      const graphicsValue = row.graphics_output_path.trim();
      if (this.graphicsStore.isGraphicsArtifactId(graphicsValue)) {
        const metadata = await this.graphicsStore.readStoredGraphicsArtifact(graphicsValue);
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

  private async migrateLegacyGraphicsPath(
    rowId: number,
    legacyPathWithoutExtension: string
  ) {
    const legacyPath = await this.graphicsStore.resolveLegacyGraphicsPath(legacyPathWithoutExtension);
    if (!legacyPath) {
      return null;
    }

    try {
      const buffer = await fs.readFile(legacyPath);
      const extension = path.extname(legacyPath).slice(1).toLowerCase();
      const mimeType = this.graphicsStore.mimeTypeFromExtension(extension);
      const stored = await this.graphicsStore.persistGraphicsArtifactBuffer(mimeType, buffer);

      this.db
        .prepare('UPDATE computation_results SET graphics_output_path = ? WHERE id = ?')
        .run(stored.id, rowId);

      return stored;
    } catch {
      return null;
    }
  }
}

