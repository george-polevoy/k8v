import type Database from 'better-sqlite3';
import type { StoredWasmArtifactRecord } from '../wasmArtifacts.js';

export class WasmArtifactRepository {
  constructor(private readonly db: Database.Database) {}

  storeArtifact(artifact: StoredWasmArtifactRecord): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO wasm_artifacts (id, sha256, byte_length, created_at, wasm_blob)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      artifact.id,
      artifact.sha256,
      artifact.byteLength,
      artifact.createdAt,
      artifact.buffer
    );
  }

  getArtifact(artifactId: string): StoredWasmArtifactRecord | null {
    const row = this.db.prepare(`
      SELECT id, sha256, byte_length, created_at, wasm_blob
      FROM wasm_artifacts
      WHERE id = ?
    `).get(artifactId) as {
      id: string;
      sha256: string;
      byte_length: number;
      created_at: number;
      wasm_blob: Buffer;
    } | undefined;

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      sha256: row.sha256,
      byteLength: row.byte_length,
      createdAt: row.created_at,
      buffer: Buffer.isBuffer(row.wasm_blob) ? row.wasm_blob : Buffer.from(row.wasm_blob),
    };
  }

  deleteArtifact(artifactId: string): boolean {
    const result = this.db.prepare(`
      DELETE FROM wasm_artifacts
      WHERE id = ?
    `).run(artifactId);
    return result.changes > 0;
  }
}
