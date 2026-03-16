import { z } from 'zod';

export * from '../../../domain/dist/index.js';

export const LibraryManifest = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  metadata: z.object({
    name: z.string(),
    description: z.string().optional(),
    inputs: z.array(
      z.object({
        name: z.string(),
        schema: z.record(z.unknown()),
        description: z.string().optional(),
      })
    ),
    outputs: z.array(
      z.object({
        name: z.string(),
        schema: z.record(z.unknown()),
        description: z.string().optional(),
      })
    ),
    category: z.string().optional(),
    version: z.string().optional(),
  }),
  version: z.string(),
  createdAt: z.number(),
});

export type LibraryManifest = z.infer<typeof LibraryManifest>;
