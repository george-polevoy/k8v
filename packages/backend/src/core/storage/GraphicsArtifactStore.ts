import * as fs from 'node:fs/promises';
import * as fsSync from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  buildStoredGraphicsLevels,
  chooseGraphicsLevel,
  parseGraphicsPayload,
  type StoredGraphicsArtifact,
} from '../graphicsArtifacts.js';

const GRAPHICS_ID_PREFIX = 'gfx_';

export class GraphicsArtifactStore {
  constructor(private readonly artifactsDir: string) {
    this.ensureArtifactsDirectorySync();
  }

  getArtifactsDir(): string {
    return this.artifactsDir;
  }

  ensureArtifactsDirectorySync(): void {
    fsSync.mkdirSync(this.artifactsDir, { recursive: true });
  }

  async storeGraphicsArtifact(raw: string): Promise<StoredGraphicsArtifact | null> {
    const parsed = parseGraphicsPayload(raw);
    if (!parsed.buffer || parsed.buffer.length === 0) {
      return null;
    }

    return this.persistGraphicsArtifactBuffer(parsed.mimeType, parsed.buffer);
  }

  async persistGraphicsArtifactBuffer(
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

    return {
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
  }

  async getGraphicsBinary(
    metadata: StoredGraphicsArtifact,
    maxPixels?: number
  ): Promise<{
    buffer: Buffer;
    mimeType: string;
    selectedLevel: { level: number; width: number; height: number; pixelCount: number };
  }> {
    const selectedLevel = chooseGraphicsLevel(metadata.levels, maxPixels);
    const buffer = await fs.readFile(
      path.join(this.getGraphicsArtifactDir(metadata.id), selectedLevel.fileName)
    );

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

  private createGraphicsArtifactId(): string {
    return `${GRAPHICS_ID_PREFIX}${randomUUID()}`;
  }

  private getGraphicsArtifactDir(graphicsId: string): string {
    return path.join(this.artifactsDir, graphicsId);
  }
}
