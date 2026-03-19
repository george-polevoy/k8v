import type Database from 'better-sqlite3';
import { Graph, type Graph as GraphType } from '../../types/index.js';

export class GraphRepository {
  constructor(private readonly db: Database.Database) {}

  async storeGraph(graph: GraphType): Promise<void> {
    this.db.prepare(`
      INSERT INTO graphs
      (id, name, revision, document_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        revision = excluded.revision,
        document_json = excluded.document_json,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at
    `).run(
      graph.id,
      graph.name,
      graph.revision,
      JSON.stringify(graph),
      graph.createdAt,
      graph.updatedAt
    );
  }

  async getGraph(graphId: string): Promise<GraphType | null> {
    const row = this.db.prepare(`
      SELECT document_json
      FROM graphs
      WHERE id = ?
    `).get(graphId) as { document_json: string } | undefined;

    if (!row) {
      return null;
    }

    return Graph.parse(JSON.parse(row.document_json));
  }

  async deleteGraph(graphId: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM graphs WHERE id = ?').run(graphId);
    return result.changes > 0;
  }

  async listGraphs(): Promise<Array<{ id: string; name: string; revision: number; updatedAt: number }>> {
    const rows = this.db.prepare(`
      SELECT id, name, revision, updated_at
      FROM graphs
      ORDER BY updated_at DESC
    `).all() as Array<{ id: string; name: string; revision: number; updated_at: number }>;

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      revision: row.revision,
      updatedAt: row.updated_at,
    }));
  }

  async getLatestGraph(): Promise<GraphType | null> {
    const row = this.db.prepare(`
      SELECT document_json
      FROM graphs
      ORDER BY updated_at DESC
      LIMIT 1
    `).get() as { document_json: string } | undefined;

    if (!row) {
      return null;
    }

    return Graph.parse(JSON.parse(row.document_json));
  }
}
