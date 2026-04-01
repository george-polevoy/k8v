import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import Database from 'better-sqlite3';
import {
  LEGACY_STORAGE_SCHEMA_VERSION,
  TARGET_STORAGE_SCHEMA_VERSION,
  initializeStorageDatabase,
  resolveStorageLayout,
  runStorageMigration,
} from '../../../scripts/migrate-storage-v3-to-v4.mjs';

function readSchemaVersion(dbPath: string): string | null {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const row = db
      .prepare("SELECT value FROM meta WHERE key = 'schema_version'")
      .get() as { value?: string } | undefined;
    return row?.value ?? null;
  } finally {
    db.close();
  }
}

test('runStorageMigration rewrites legacy nested node configs into v4 flat configs', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'k8v-storage-migration-test-'));
  const storageBaseDir = path.join(tmpDir, 'storage');
  const legacyLayout = resolveStorageLayout(storageBaseDir, LEGACY_STORAGE_SCHEMA_VERSION);

  try {
    await fs.mkdir(legacyLayout.artifactsDir, { recursive: true });
    await fs.writeFile(path.join(legacyLayout.artifactsDir, 'artifact.bin'), 'legacy-artifact');

    const legacyDb = new Database(legacyLayout.dbPath);
    try {
      initializeStorageDatabase(legacyDb, LEGACY_STORAGE_SCHEMA_VERSION);

      const now = Date.now();
      const legacyGraph = {
        id: 'graph-1',
        name: 'Legacy Graph',
        revision: 7,
        nodes: [
          {
            id: 'inline-node',
            type: 'inline_code',
            position: { x: 10, y: 20 },
            metadata: {
              name: 'Inline',
              inputs: [],
              outputs: [{ name: 'output', schema: { type: 'number' } }],
              custom: { owner: 'migration-test' },
            },
            config: {
              type: 'inline_code',
              code: 'outputs.output = 1;',
              runtime: 'python_process',
              pythonEnv: 'analytics',
              config: {
                autoRecompute: true,
                cardWidth: 280,
                displayTextOutputs: true,
                textOutputMaxLines: 5,
                textOutputOverflowMode: 'scroll',
              },
            },
            version: 'inline-v1',
          },
          {
            id: 'numeric-node',
            type: 'numeric_input',
            position: { x: 40, y: 80 },
            metadata: {
              name: 'Numeric',
              inputs: [],
              outputs: [{ name: 'value', schema: { type: 'number' } }],
            },
            config: {
              type: 'numeric_input',
              config: {
                value: 7.4,
                min: 0,
                max: 10,
                step: 0.5,
                dragDebounceSeconds: 0.2,
                propagateWhileDragging: true,
                autoRecompute: true,
                cardHeight: 160,
              },
            },
            version: 'numeric-v1',
          },
          {
            id: 'annotation-node',
            type: 'annotation',
            position: { x: 120, y: 140 },
            metadata: {
              name: 'Annotation',
              inputs: [],
              outputs: [],
            },
            config: {
              type: 'annotation',
              config: {
                text: 'Legacy note',
                backgroundColor: '#fff7ed',
                borderColor: '#7c2d12',
                fontColor: '#431407',
                fontSize: 18,
                cardWidth: 260,
                cardHeight: 180,
              },
            },
            version: 'annotation-v1',
          },
        ],
        connections: [],
        pythonEnvs: [
          {
            name: 'analytics',
            pythonPath: '/usr/bin/python3',
            cwd: '/tmp',
          },
        ],
        drawings: [],
        createdAt: now,
        updatedAt: now,
      };

      legacyDb.prepare(`
        INSERT INTO graphs (id, name, revision, document_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        legacyGraph.id,
        legacyGraph.name,
        legacyGraph.revision,
        JSON.stringify(legacyGraph),
        now,
        now
      );

      legacyDb.prepare(`
        INSERT INTO artifacts (id, mime_type, created_at, levels_json)
        VALUES (?, ?, ?, ?)
      `).run('artifact-1', 'image/png', now, JSON.stringify([{ level: 0, width: 4, height: 4, pixelCount: 16 }]));

      legacyDb.prepare(`
        INSERT INTO node_results (
          run_id, graph_id, node_id, node_version, timestamp, outputs_json, schema_json, text_output, artifact_id
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        'run-1',
        legacyGraph.id,
        'inline-node',
        'inline-v1',
        now,
        JSON.stringify({ output: 1 }),
        JSON.stringify({ output: { type: 'number' } }),
        'ok',
        'artifact-1'
      );
    } finally {
      legacyDb.close();
    }

    const result = runStorageMigration({ storageBaseDir });
    const migratedLayout = resolveStorageLayout(storageBaseDir, TARGET_STORAGE_SCHEMA_VERSION);

    assert.equal(result.target.dbPath, migratedLayout.dbPath);
    assert.equal(readSchemaVersion(migratedLayout.dbPath), String(TARGET_STORAGE_SCHEMA_VERSION));
    assert.equal(fsSync.existsSync(path.join(migratedLayout.artifactsDir, 'artifact.bin')), true);

    const migratedDb = new Database(migratedLayout.dbPath, { readonly: true, fileMustExist: true });
    try {
      const graphRow = migratedDb.prepare(`
        SELECT document_json
        FROM graphs
        WHERE id = 'graph-1'
      `).get() as { document_json: string };
      const migratedGraph = JSON.parse(graphRow.document_json);

      const inlineNode = migratedGraph.nodes.find((node: { id: string }) => node.id === 'inline-node');
      const numericNode = migratedGraph.nodes.find((node: { id: string }) => node.id === 'numeric-node');
      const annotationNode = migratedGraph.nodes.find((node: { id: string }) => node.id === 'annotation-node');

      assert.equal(inlineNode.config.type, undefined);
      assert.equal(inlineNode.config.config, undefined);
      assert.equal(inlineNode.config.runtime, 'python_process');
      assert.equal(inlineNode.config.pythonEnv, 'analytics');
      assert.equal(inlineNode.config.displayTextOutputs, true);
      assert.equal(inlineNode.config.textOutputOverflowMode, 'scroll');

      assert.equal(numericNode.config.type, undefined);
      assert.equal(numericNode.config.config, undefined);
      assert.equal(numericNode.config.value, 7.5);
      assert.equal(numericNode.config.dragDebounceSeconds, 0.2);
      assert.equal(numericNode.config.propagateWhileDragging, true);
      assert.equal(numericNode.config.cardHeight, 160);

      assert.equal(annotationNode.config.type, undefined);
      assert.equal(annotationNode.config.config, undefined);
      assert.equal(annotationNode.config.text, 'Legacy note');
      assert.equal(annotationNode.config.fontSize, 18);
      assert.equal(annotationNode.config.cardWidth, 260);

      const artifactCount = migratedDb.prepare('SELECT COUNT(*) AS count FROM artifacts').get() as { count: number };
      const resultCount = migratedDb.prepare('SELECT COUNT(*) AS count FROM node_results').get() as { count: number };
      assert.equal(artifactCount.count, 1);
      assert.equal(resultCount.count, 1);
    } finally {
      migratedDb.close();
    }
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
