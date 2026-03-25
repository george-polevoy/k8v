import { createHash, randomUUID } from 'node:crypto';

const WASM_ARTIFACT_ID_PREFIX = 'wasm_';
const WASM_MAGIC = Buffer.from([0x00, 0x61, 0x73, 0x6d]);

export interface StoredWasmArtifact {
  id: string;
  sha256: string;
  byteLength: number;
  createdAt: number;
}

export interface StoredWasmArtifactRecord extends StoredWasmArtifact {
  buffer: Buffer;
}

export function isWasmBinary(buffer: Buffer): boolean {
  return buffer.byteLength >= WASM_MAGIC.length &&
    buffer.subarray(0, WASM_MAGIC.length).equals(WASM_MAGIC);
}

export function buildStoredWasmArtifact(buffer: Buffer): StoredWasmArtifactRecord {
  return {
    id: `${WASM_ARTIFACT_ID_PREFIX}${randomUUID()}`,
    sha256: createHash('sha256').update(buffer).digest('hex'),
    byteLength: buffer.byteLength,
    createdAt: Date.now(),
    buffer,
  };
}
