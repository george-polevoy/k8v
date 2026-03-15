import { z } from 'zod';
import type { Graph } from './graphModel.js';

export const ConnectionAnchorSchema = z.object({
  side: z.enum(['top', 'right', 'bottom', 'left']),
  offset: z.number().finite().min(0).max(1),
});

export type BulkEditOperationResult = {
  graph: Graph;
  details?: Record<string, unknown>;
};

export type BulkEditOperationHandler = (current: Graph, operation: any) => BulkEditOperationResult;

