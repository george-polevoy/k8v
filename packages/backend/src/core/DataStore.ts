import Database from 'better-sqlite3';
import { ComputationResult } from '../types/index.js';
import { PublicGraphicsArtifact } from './graphicsArtifacts.js';
import { initializeDataStoreDatabase } from './storage/DatabaseBootstrap.js';
import { ComputationResultRepository } from './storage/ComputationResultRepository.js';
import { GraphRepository } from './storage/GraphRepository.js';
import { GraphicsArtifactStore } from './storage/GraphicsArtifactStore.js';

/**
 * Data store facade for persisting computation results and graph metadata.
 */
export class DataStore {
  private readonly db: Database.Database;
  private readonly graphRepository: GraphRepository;
  private readonly resultRepository: ComputationResultRepository;
  private readonly graphicsStore: GraphicsArtifactStore;

  constructor(dbPath: string = ':memory:', dataDir: string = './data') {
    this.db = new Database(dbPath);
    initializeDataStoreDatabase(this.db);
    this.graphicsStore = new GraphicsArtifactStore(dataDir);
    this.graphRepository = new GraphRepository(this.db);
    this.resultRepository = new ComputationResultRepository(
      this.db,
      this.graphicsStore.getDataDir(),
      this.graphicsStore
    );
  }

  async storeResult(nodeId: string, result: ComputationResult): Promise<void> {
    await this.resultRepository.storeResult(nodeId, result);
  }

  async getResult(nodeId: string, version?: string): Promise<ComputationResult | null> {
    return await this.resultRepository.getResult(nodeId, version);
  }

  async getGraphicsArtifact(graphicsId: string): Promise<PublicGraphicsArtifact | null> {
    return await this.graphicsStore.getGraphicsArtifact(graphicsId);
  }

  async getGraphicsBinary(
    graphicsId: string,
    maxPixels?: number
  ): Promise<{
    buffer: Buffer;
    mimeType: string;
    selectedLevel: { level: number; width: number; height: number; pixelCount: number };
  } | null> {
    return await this.graphicsStore.getGraphicsBinary(graphicsId, maxPixels);
  }

  async storeGraph(graph: any): Promise<void> {
    await this.graphRepository.storeGraph(graph);
  }

  async getGraph(graphId: string): Promise<any | null> {
    return await this.graphRepository.getGraph(graphId);
  }

  async deleteGraph(graphId: string): Promise<boolean> {
    return await this.graphRepository.deleteGraph(graphId);
  }

  async listGraphs(): Promise<Array<{ id: string; name: string; updatedAt: number }>> {
    return await this.graphRepository.listGraphs();
  }

  async getLatestGraph(): Promise<any | null> {
    return await this.graphRepository.getLatestGraph();
  }

  close(): void {
    this.db.close();
  }
}
