import type Database from 'better-sqlite3';
import type { StoredGraphicsArtifact } from '../graphicsArtifacts.js';

export class ArtifactRepository {
  constructor(private readonly db: Database.Database) {}

  storeArtifact(artifact: StoredGraphicsArtifact): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO artifacts (id, mime_type, created_at, levels_json)
      VALUES (?, ?, ?, ?)
    `).run(
      artifact.id,
      artifact.mimeType,
      artifact.createdAt,
      JSON.stringify(artifact.levels)
    );
  }

  getArtifact(artifactId: string): StoredGraphicsArtifact | null {
    const row = this.db.prepare(`
      SELECT id, mime_type, created_at, levels_json
      FROM artifacts
      WHERE id = ?
    `).get(artifactId) as {
      id: string;
      mime_type: string;
      created_at: number;
      levels_json: string;
    } | undefined;

    if (!row) {
      return null;
    }

    const levels = JSON.parse(row.levels_json) as StoredGraphicsArtifact['levels'];
    if (!Array.isArray(levels) || levels.length === 0) {
      return null;
    }

    return {
      id: row.id,
      mimeType: row.mime_type,
      createdAt: row.created_at,
      levels,
    };
  }
}
