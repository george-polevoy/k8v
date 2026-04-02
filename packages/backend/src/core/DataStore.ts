import Database from 'better-sqlite3';
import path from 'node:path';
import type { ComputationResult, Graph } from '../types/index.js';
import { type PublicGraphicsArtifact, toPublicGraphicsArtifact } from './graphicsArtifacts.js';
import { initializeDataStoreDatabase, prepareVersionedStorageLayout } from './storage/DatabaseBootstrap.js';
import { ArtifactRepository } from './storage/ArtifactRepository.js';
import { ComputationResultRepository } from './storage/ComputationResultRepository.js';
import { GraphRepository } from './storage/GraphRepository.js';
import { GraphicsArtifactStore } from './storage/GraphicsArtifactStore.js';

type StorageEnvironment = Record<string, string | undefined>;

function resolveStorageBaseDir(env: StorageEnvironment): string | undefined {
  const configuredPath = env.K8V_STORAGE_DIR?.trim();
  return configuredPath ? path.resolve(configuredPath) : undefined;
}

export class DataStore {
  private readonly db: Database.Database;
  private readonly graphRepository: GraphRepository;
  private readonly resultRepository: ComputationResultRepository;
  private readonly artifactRepository: ArtifactRepository;
  private readonly graphicsStore: GraphicsArtifactStore;

  constructor(dbPath?: string, artifactsDir?: string, env: StorageEnvironment = process.env) {
    const configuredStorageBaseDir = resolveStorageBaseDir(env);
    let persistentStorageLayout: ReturnType<typeof prepareVersionedStorageLayout> | null = null;
    const getPersistentStorageLayout = () => {
      persistentStorageLayout ??= prepareVersionedStorageLayout(configuredStorageBaseDir);
      return persistentStorageLayout;
    };
    const usesInMemoryDatabase = dbPath === ':memory:';
    const resolvedDbPath = dbPath ?? getPersistentStorageLayout().dbPath;
    const resolvedArtifactsDir =
      artifactsDir ??
      (usesInMemoryDatabase
        ? path.resolve('./tmp/k8v-memory-artifacts')
        : getPersistentStorageLayout().artifactsDir);

    if (!usesInMemoryDatabase) {
      this.graphicsStore = new GraphicsArtifactStore(resolvedArtifactsDir);
      this.db = new Database(resolvedDbPath);
    } else {
      this.graphicsStore = new GraphicsArtifactStore(resolvedArtifactsDir);
      this.db = new Database(':memory:');
    }

    initializeDataStoreDatabase(this.db);
    this.artifactRepository = new ArtifactRepository(this.db);
    this.graphRepository = new GraphRepository(this.db);
    this.resultRepository = new ComputationResultRepository(
      this.db,
      this.artifactRepository,
      this.graphicsStore
    );
    this.resultRepository.syncLatestResultsProjection();
  }

  async storeResult(graphId: string, nodeId: string, result: ComputationResult): Promise<void> {
    await this.resultRepository.storeResult(graphId, nodeId, result);
  }

  async getResult(
    graphId: string,
    nodeId: string,
    version?: string
  ): Promise<ComputationResult | null> {
    return await this.resultRepository.getResult(graphId, nodeId, version);
  }

  async getLatestResultByNodeId(nodeId: string, version?: string): Promise<ComputationResult | null> {
    return await this.resultRepository.getLatestResultByNodeId(nodeId, version);
  }

  async listLatestResultsForGraph(
    graphId: string,
    nodeIds?: readonly string[]
  ): Promise<Record<string, ComputationResult | null>> {
    return await this.resultRepository.listLatestResultsForGraph(graphId, nodeIds);
  }

  async getGraphicsArtifact(graphicsId: string): Promise<PublicGraphicsArtifact | null> {
    const artifact = this.artifactRepository.getArtifact(graphicsId);
    return artifact ? toPublicGraphicsArtifact(artifact) : null;
  }

  async getGraphicsBinary(
    graphicsId: string,
    maxPixels?: number
  ): Promise<{
    buffer: Buffer;
    mimeType: string;
    selectedLevel: { level: number; width: number; height: number; pixelCount: number };
  } | null> {
    const artifact = this.artifactRepository.getArtifact(graphicsId);
    if (!artifact) {
      return null;
    }
    return await this.graphicsStore.getGraphicsBinary(artifact, maxPixels);
  }

  async storeGraph(graph: Graph): Promise<void> {
    await this.graphRepository.storeGraph(graph);
  }

  async getGraph(graphId: string): Promise<Graph | null> {
    return await this.graphRepository.getGraph(graphId);
  }

  async deleteGraph(graphId: string): Promise<boolean> {
    return await this.graphRepository.deleteGraph(graphId);
  }

  async listGraphs(): Promise<Array<{ id: string; name: string; revision: number; updatedAt: number }>> {
    return await this.graphRepository.listGraphs();
  }

  async getLatestGraph(): Promise<Graph | null> {
    return await this.graphRepository.getLatestGraph();
  }

  close(): void {
    this.db.close();
  }
}
