import { PNG } from 'pngjs';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export interface ParsedGraphicsPayload {
  mimeType: string;
  buffer: Buffer;
  isImage: boolean;
}

export interface GraphicsMipLevel {
  level: number;
  width: number;
  height: number;
  pixelCount: number;
}

export interface StoredGraphicsMipLevel extends GraphicsMipLevel {
  fileName: string;
}

export interface StoredGraphicsArtifact {
  id: string;
  mimeType: string;
  createdAt: number;
  levels: StoredGraphicsMipLevel[];
}

export interface PublicGraphicsArtifact {
  id: string;
  mimeType: string;
  levels: GraphicsMipLevel[];
}

interface PngLevelBuffer {
  width: number;
  height: number;
  buffer: Buffer;
}

interface PngRaster {
  width: number;
  height: number;
  data: Uint8Array;
}

function extensionFromMimeType(mimeType: string): string {
  switch (mimeType.toLowerCase()) {
    case 'image/png':
      return 'png';
    case 'image/jpeg':
      return 'jpg';
    case 'image/gif':
      return 'gif';
    case 'image/svg+xml':
      return 'svg';
    case 'image/webp':
      return 'webp';
    case 'text/plain':
      return 'txt';
    default:
      return 'bin';
  }
}

function parseBase64DataUrl(data: string): { mimeType: string; buffer: Buffer } | null {
  const match = data.match(/^data:([^;,]+);base64,(.*)$/s);
  if (!match) {
    return null;
  }

  const mimeType = match[1]?.trim().toLowerCase() || 'application/octet-stream';
  const payload = match[2] ?? '';
  return {
    mimeType,
    buffer: Buffer.from(payload, 'base64'),
  };
}

function isLikelyBase64(value: string): boolean {
  const normalized = value.replace(/\s+/g, '');
  if (normalized.length === 0 || normalized.length % 4 !== 0) {
    return false;
  }
  return /^[A-Za-z0-9+/]+=*$/.test(normalized);
}

export function parseGraphicsPayload(raw: string): ParsedGraphicsPayload {
  const trimmed = raw.trim();
  const fromDataUrl = parseBase64DataUrl(trimmed);
  if (fromDataUrl) {
    return {
      mimeType: fromDataUrl.mimeType,
      buffer: fromDataUrl.buffer,
      isImage: fromDataUrl.mimeType.startsWith('image/'),
    };
  }

  if (isLikelyBase64(trimmed)) {
    const decoded = Buffer.from(trimmed, 'base64');
    if (decoded.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
      return {
        mimeType: 'image/png',
        buffer: decoded,
        isImage: true,
      };
    }
  }

  return {
    mimeType: 'text/plain',
    buffer: Buffer.from(raw, 'utf8'),
    isImage: false,
  };
}

function downsamplePng(source: PngRaster): PNG {
  const targetWidth = Math.max(1, Math.floor(source.width / 2));
  const targetHeight = Math.max(1, Math.floor(source.height / 2));
  const target = new PNG({ width: targetWidth, height: targetHeight });

  for (let y = 0; y < targetHeight; y += 1) {
    const srcYStart = Math.floor((y * source.height) / targetHeight);
    const srcYEnd = Math.max(srcYStart + 1, Math.floor(((y + 1) * source.height) / targetHeight));

    for (let x = 0; x < targetWidth; x += 1) {
      const srcXStart = Math.floor((x * source.width) / targetWidth);
      const srcXEnd = Math.max(srcXStart + 1, Math.floor(((x + 1) * source.width) / targetWidth));

      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let samples = 0;

      for (let srcY = srcYStart; srcY < srcYEnd; srcY += 1) {
        for (let srcX = srcXStart; srcX < srcXEnd; srcX += 1) {
          const sourceIndex = (source.width * srcY + srcX) << 2;
          const sourceR = source.data[sourceIndex];
          const sourceG = source.data[sourceIndex + 1];
          const sourceB = source.data[sourceIndex + 2];
          const sourceA = source.data[sourceIndex + 3];

          // Filter in premultiplied-alpha space to avoid dark/bright fringes
          // around semi-transparent edges when generating lower mip levels.
          const alphaFactor = sourceA / 255;
          r += sourceR * alphaFactor;
          g += sourceG * alphaFactor;
          b += sourceB * alphaFactor;
          a += sourceA;
          samples += 1;
        }
      }

      const targetIndex = (target.width * y + x) << 2;
      const averagedAlpha = a / samples;
      target.data[targetIndex + 3] = Math.round(averagedAlpha);
      if (averagedAlpha <= 0) {
        target.data[targetIndex] = 0;
        target.data[targetIndex + 1] = 0;
        target.data[targetIndex + 2] = 0;
        continue;
      }

      const unpremultiplyFactor = 255 / averagedAlpha;
      target.data[targetIndex] = Math.round(Math.min(255, Math.max(0, (r / samples) * unpremultiplyFactor)));
      target.data[targetIndex + 1] = Math.round(
        Math.min(255, Math.max(0, (g / samples) * unpremultiplyFactor))
      );
      target.data[targetIndex + 2] = Math.round(
        Math.min(255, Math.max(0, (b / samples) * unpremultiplyFactor))
      );
    }
  }

  return target;
}

export function buildPngMipLevels(pngBuffer: Buffer): PngLevelBuffer[] {
  const parsed = PNG.sync.read(pngBuffer);
  const levels: PngLevelBuffer[] = [
    {
      width: parsed.width,
      height: parsed.height,
      buffer: pngBuffer,
    },
  ];

  let current: PngRaster = parsed;
  const maxLevels = 24;

  for (let level = 1; level < maxLevels; level += 1) {
    if (current.width === 1 && current.height === 1) {
      break;
    }

    const next = downsamplePng(current);
    levels.push({
      width: next.width,
      height: next.height,
      buffer: PNG.sync.write(next),
    });
    current = next;
  }

  return levels;
}

export function buildStoredGraphicsLevels(
  mimeType: string,
  originalBuffer: Buffer
): Array<{ fileName: string; width: number; height: number; buffer: Buffer }> {
  if (mimeType.toLowerCase() === 'image/png') {
    try {
      return buildPngMipLevels(originalBuffer).map((entry, index) => ({
        fileName: `level-${index}.png`,
        width: entry.width,
        height: entry.height,
        buffer: entry.buffer,
      }));
    } catch {
      // Fall through to single binary level when PNG parsing fails.
    }
  }

  const extension = extensionFromMimeType(mimeType);
  return [
    {
      fileName: `level-0.${extension}`,
      width: 1,
      height: 1,
      buffer: originalBuffer,
    },
  ];
}

export function toPublicGraphicsArtifact(metadata: StoredGraphicsArtifact): PublicGraphicsArtifact {
  return {
    id: metadata.id,
    mimeType: metadata.mimeType,
    levels: metadata.levels.map((level) => ({
      level: level.level,
      width: level.width,
      height: level.height,
      pixelCount: level.pixelCount,
    })),
  };
}

export function chooseGraphicsLevel(
  levels: StoredGraphicsMipLevel[],
  maxPixels?: number
): StoredGraphicsMipLevel {
  if (levels.length === 0) {
    throw new Error('No graphics levels available');
  }

  if (!maxPixels || !Number.isFinite(maxPixels) || maxPixels <= 0) {
    return levels[0];
  }

  for (const level of levels) {
    if (level.pixelCount <= maxPixels) {
      return level;
    }
  }

  return levels[levels.length - 1];
}
