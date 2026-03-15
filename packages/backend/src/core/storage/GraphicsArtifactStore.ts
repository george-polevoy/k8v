import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import { randomUUID } from 'node:crypto';
import {
  buildStoredGraphicsLevels,
  chooseGraphicsLevel,
  parseGraphicsPayload,
  PublicGraphicsArtifact,
  StoredGraphicsArtifact,
  toPublicGraphicsArtifact,
} from '../graphicsArtifacts.js';

const GRAPHICS_ID_PREFIX = 'gfx_';

export class GraphicsArtifactStore {
  private readonly graphicsDir: string;

  constructor(private readonly dataDir: string) {
    this.graphicsDir = path.join(this.dataDir, 'graphics');
    this.ensureDataDirectorySync();
  }

  getDataDir(): string {
    return this.dataDir;
  }

  getGraphicsDir(): string {
    return this.graphicsDir;
  }

  ensureDataDirectorySync(): void {
    try {
      fsSync.mkdirSync(this.dataDir, { recursive: true });
      fsSync.mkdirSync(this.graphicsDir, { recursive: true });
    } catch (error) {
      console.error('Failed to create data directory:', error);
    }
  }

  async storeGraphicsArtifact(raw: string): Promise<StoredGraphicsArtifact | null> {
    const parsed = parseGraphicsPayload(raw);
    if (!parsed.buffer || parsed.buffer.length === 0) {
      return null;
    }

    return this.persistGraphicsArtifactBuffer(parsed.mimeType, parsed.buffer);
  }

  async getGraphicsArtifact(graphicsId: string): Promise<PublicGraphicsArtifact | null> {
    if (!this.isGraphicsArtifactId(graphicsId)) {
      return null;
    }

    const metadata = await this.readStoredGraphicsArtifact(graphicsId);
    if (!metadata) {
      return null;
    }

    return toPublicGraphicsArtifact(metadata);
  }

  async getGraphicsBinary(
    graphicsId: string,
    maxPixels?: number
  ): Promise<{
    buffer: Buffer;
    mimeType: string;
    selectedLevel: { level: number; width: number; height: number; pixelCount: number };
  } | null> {
    if (!this.isGraphicsArtifactId(graphicsId)) {
      return null;
    }

    const metadata = await this.readStoredGraphicsArtifact(graphicsId);
    if (!metadata) {
      return null;
    }

    const selectedLevel = chooseGraphicsLevel(metadata.levels, maxPixels);
    const levelPath = path.join(this.getGraphicsArtifactDir(graphicsId), selectedLevel.fileName);
    const buffer = await fs.readFile(levelPath);
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

    const metadata: StoredGraphicsArtifact = {
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

    await fs.writeFile(this.getGraphicsMetadataPath(graphicsId), JSON.stringify(metadata, null, 2));
    return metadata;
  }

  async readStoredGraphicsArtifact(graphicsId: string): Promise<StoredGraphicsArtifact | null> {
    try {
      const metadataRaw = await fs.readFile(this.getGraphicsMetadataPath(graphicsId), 'utf-8');
      const parsed = JSON.parse(metadataRaw) as StoredGraphicsArtifact;
      if (!parsed?.id || !Array.isArray(parsed.levels) || parsed.levels.length === 0) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  async resolveLegacyGraphicsPath(basePath: string): Promise<string | null> {
    const trimmed = basePath.trim();
    if (!trimmed) {
      return null;
    }

    if (path.extname(trimmed)) {
      try {
        await fs.access(trimmed);
        return trimmed;
      } catch {
        return null;
      }
    }

    const possibleExtensions = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'dat'];
    for (const extension of possibleExtensions) {
      const candidate = `${trimmed}.${extension}`;
      try {
        await fs.access(candidate);
        return candidate;
      } catch {
        // Continue probing.
      }
    }

    return null;
  }

  mimeTypeFromExtension(extension: string): string {
    switch (extension) {
      case 'png':
        return 'image/png';
      case 'jpg':
      case 'jpeg':
        return 'image/jpeg';
      case 'gif':
        return 'image/gif';
      case 'svg':
        return 'image/svg+xml';
      default:
        return 'application/octet-stream';
    }
  }

  isGraphicsArtifactId(value: string): boolean {
    return value.startsWith(GRAPHICS_ID_PREFIX);
  }

  private createGraphicsArtifactId(): string {
    return `${GRAPHICS_ID_PREFIX}${randomUUID()}`;
  }

  private getGraphicsArtifactDir(graphicsId: string): string {
    return path.join(this.graphicsDir, graphicsId);
  }

  private getGraphicsMetadataPath(graphicsId: string): string {
    return path.join(this.getGraphicsArtifactDir(graphicsId), 'metadata.json');
  }
}

