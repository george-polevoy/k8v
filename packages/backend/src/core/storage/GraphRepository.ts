import type Database from 'better-sqlite3';

export class GraphRepository {
  constructor(private readonly db: Database.Database) {}

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

  async getGraph(graphId: string): Promise<any | null> {
    const stmt = this.db.prepare('SELECT * FROM graphs WHERE id = ?');
    const row = stmt.get(graphId) as { data: string } | undefined;

    if (!row) {
      return null;
    }

    return JSON.parse(row.data);
  }

  async deleteGraph(graphId: string): Promise<boolean> {
    const stmt = this.db.prepare('DELETE FROM graphs WHERE id = ?');
    const result = stmt.run(graphId);
    return result.changes > 0;
  }

  async listGraphs(): Promise<Array<{ id: string; name: string; updatedAt: number }>> {
    const stmt = this.db.prepare('SELECT id, name, updated_at FROM graphs ORDER BY updated_at DESC');
    const rows = stmt.all() as Array<{ id: string; name: string; updated_at: number }>;

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      updatedAt: row.updated_at,
    }));
  }

  async getLatestGraph(): Promise<any | null> {
    const stmt = this.db.prepare('SELECT data FROM graphs ORDER BY updated_at DESC LIMIT 1');
    const row = stmt.get() as { data: string } | undefined;

    if (!row) {
      return null;
    }

    return JSON.parse(row.data);
  }
}

