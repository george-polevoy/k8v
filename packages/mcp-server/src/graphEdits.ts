import { z } from 'zod';
import { type Graph } from './graphModel.js';
import { ConnectionAnchorSchema, type BulkEditOperationResult } from './graphBulkEditDomainTypes.js';
import {
  getNextProjectionName,
  graphBulkEditHandlers,
  graphBulkEditOperationSchemas,
} from './graphBulkEditGraphOps.js';
import {
  drawingBulkEditHandlers,
  drawingBulkEditOperationSchemas,
} from './graphBulkEditDrawingOps.js';
import {
  nodeBulkEditHandlers,
  nodeBulkEditOperationSchemas,
} from './graphBulkEditNodeOps.js';
import {
  connectionBulkEditHandlers,
  connectionBulkEditOperationSchemas,
} from './graphBulkEditConnectionOps.js';

export { ConnectionAnchorSchema, getNextProjectionName };

const bulkEditOperationSchemas = [
  ...graphBulkEditOperationSchemas,
  ...drawingBulkEditOperationSchemas,
  ...nodeBulkEditOperationSchemas,
  ...connectionBulkEditOperationSchemas,
];

export const BULK_EDIT_OPERATION_SCHEMA = z.discriminatedUnion(
  'op',
  bulkEditOperationSchemas as any
);

export type BulkEditOperation = z.infer<typeof BULK_EDIT_OPERATION_SCHEMA>;

const bulkEditHandlers = {
  ...graphBulkEditHandlers,
  ...drawingBulkEditHandlers,
  ...nodeBulkEditHandlers,
  ...connectionBulkEditHandlers,
};

export function applyBulkEditOperation(current: Graph, operation: BulkEditOperation): BulkEditOperationResult {
  const handler = bulkEditHandlers[operation.op];
  if (!handler) {
    throw new Error(`Unsupported bulk edit operation "${operation.op}"`);
  }
  return handler(current, operation);
}
