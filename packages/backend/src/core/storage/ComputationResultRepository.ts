import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import {
  ComputationResult,
  type ComputationResult as ComputationResultType,
} from '../../types/index.js';
import { type PublicGraphicsArtifact, toPublicGraphicsArtifact } from '../graphicsArtifacts.js';
import { ArtifactRepository } from './ArtifactRepository.js';
import { GraphicsArtifactStore } from './GraphicsArtifactStore.js';

export class ComputationResultRepository {
  constructor(
    private readonly db: Database.Database,
    private readonly artifactRepository: ArtifactRepository,
    private readonly graphicsStore: GraphicsArtifactStore
  ) {}

  async storeResult(graphId: string, nodeId: string, result: ComputationResultType): Promise<void> {
    const runId = randomUUID();
    const graphics = result.graphicsOutput
      ? await this.graphicsStore.storeGraphicsArtifact(result.graphicsOutput)
      : null;
    if (graphics) {
      this.artifactRepository.storeArtifact(graphics);
    }

    this.db.prepare(`
      INSERT INTO node_results
      (run_id, graph_id, node_id, node_version, timestamp, outputs_json, schema_json, text_output, artifact_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      runId,
      graphId,
      nodeId,
      result.version,
      result.timestamp,
      JSON.stringify(result.outputs),
      JSON.stringify(result.schema),
      result.textOutput ?? null,
      graphics?.id ?? null
    );

    this.db.prepare(`
      INSERT INTO latest_node_results
      (graph_id, node_id, run_id, timestamp)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(graph_id, node_id) DO UPDATE SET
        run_id = excluded.run_id,
        timestamp = excluded.timestamp
      WHERE excluded.timestamp >= latest_node_results.timestamp
    `).run(graphId, nodeId, runId, result.timestamp);
  }

  async getResult(
    graphId: string,
    nodeId: string,
    version?: string
  ): Promise<ComputationResultType | null> {
    const row = version
      ? this.db.prepare(`
          SELECT *
          FROM node_results
          WHERE graph_id = ? AND node_id = ? AND node_version = ?
          ORDER BY timestamp DESC, rowid DESC
          LIMIT 1
        `).get(graphId, nodeId, version)
      : this.db.prepare(`
          SELECT *
          FROM node_results
          WHERE graph_id = ? AND node_id = ?
          ORDER BY timestamp DESC, rowid DESC
          LIMIT 1
        `).get(graphId, nodeId);

    return this.deserializeRow(nodeId, row as NodeResultRow | undefined);
  }

  async getLatestResultByNodeId(
    nodeId: string,
    version?: string
  ): Promise<ComputationResultType | null> {
    const row = version
      ? this.db.prepare(`
          SELECT *
          FROM node_results
          WHERE node_id = ? AND node_version = ?
          ORDER BY timestamp DESC, rowid DESC
          LIMIT 1
        `).get(nodeId, version)
      : this.db.prepare(`
          SELECT *
          FROM node_results
          WHERE node_id = ?
          ORDER BY timestamp DESC, rowid DESC
          LIMIT 1
        `).get(nodeId);

    return this.deserializeRow(nodeId, row as NodeResultRow | undefined);
  }

  async listLatestResultsForGraph(
    graphId: string,
    nodeIds?: readonly string[]
  ): Promise<Record<string, ComputationResultType | null>> {
    if (Array.isArray(nodeIds) && nodeIds.length === 0) {
      return {};
    }

    const filters = ['latest.graph_id = ?'];
    const params: Array<string> = [graphId];
    if (Array.isArray(nodeIds) && nodeIds.length > 0) {
      filters.push(`latest.node_id IN (${nodeIds.map(() => '?').join(', ')})`);
      params.push(...nodeIds);
    }

    const rows = this.db.prepare(`
      SELECT results.*
      FROM latest_node_results latest
      JOIN node_results results
        ON results.run_id = latest.run_id
      WHERE ${filters.join(' AND ')}
      ORDER BY latest.node_id
    `).all(...params) as NodeResultRow[];

    const results: Record<string, ComputationResultType | null> = {};
    for (const row of rows) {
      results[row.node_id] = await this.deserializeRow(row.node_id, row);
    }
    return results;
  }

  syncLatestResultsProjection(): void {
    this.db.prepare(`
      INSERT INTO latest_node_results
      (graph_id, node_id, run_id, timestamp)
      SELECT graph_id, node_id, run_id, timestamp
      FROM (
        SELECT
          graph_id,
          node_id,
          run_id,
          timestamp,
          ROW_NUMBER() OVER (
            PARTITION BY graph_id, node_id
            ORDER BY timestamp DESC, rowid DESC
          ) AS row_rank
        FROM node_results
      )
      WHERE row_rank = 1
      ON CONFLICT(graph_id, node_id) DO UPDATE SET
        run_id = excluded.run_id,
        timestamp = excluded.timestamp
      WHERE excluded.timestamp >= latest_node_results.timestamp
    `).run();
  }

  private async deserializeRow(
    nodeId: string,
    row: NodeResultRow | undefined
  ): Promise<ComputationResultType | null> {
    if (!row) {
      return null;
    }

    const outputs = JSON.parse(row.outputs_json);
    const schema = JSON.parse(row.schema_json);

    let graphics: PublicGraphicsArtifact | undefined;
    if (typeof row.artifact_id === 'string' && row.artifact_id.trim()) {
      const artifact = this.artifactRepository.getArtifact(row.artifact_id.trim());
      if (artifact) {
        graphics = toPublicGraphicsArtifact(artifact);
      }
    }

    return ComputationResult.parse({
      nodeId,
      outputs,
      schema,
      timestamp: row.timestamp,
      version: row.node_version,
      textOutput: row.text_output ?? undefined,
      graphics,
    });
  }
}

interface NodeResultRow {
  graph_id: string;
  node_id: string;
  node_version: string;
  timestamp: number;
  outputs_json: string;
  schema_json: string;
  text_output: string | null;
  artifact_id: string | null;
}
