import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { normalizeDrawingColor } from './graphModel.js';
import type { BulkEditOperationHandler } from './graphBulkEditDomainTypes.js';

export const drawingBulkEditOperationSchemas = [
  z.object({
    op: z.literal('drawing_create'),
    drawingId: z.string().trim().min(1).optional(),
    name: z.string().optional(),
    x: z.number().optional(),
    y: z.number().optional(),
  }),
  z.object({
    op: z.literal('drawing_add_path'),
    drawingId: z.string(),
    points: z.array(z.object({ x: z.number(), y: z.number() })).min(1),
    color: z.union([z.string().regex(/^#[0-9a-fA-F]{6}$/), z.enum(['white', 'green', 'red'])]).optional(),
    thickness: z.number().positive().optional(),
    pathId: z.string().optional(),
    coordinateSpace: z.enum(['world', 'local']).optional(),
  }),
  z.object({
    op: z.literal('drawing_move'),
    drawingId: z.string(),
    x: z.number(),
    y: z.number(),
  }),
  z.object({
    op: z.literal('drawing_set_name'),
    drawingId: z.string(),
    name: z.string(),
  }),
  z.object({
    op: z.literal('drawing_delete'),
    drawingId: z.string(),
  }),
] as const;

export const drawingBulkEditHandlers: Record<string, BulkEditOperationHandler> = {
  drawing_create: (current, operation) => {
    const drawingId = operation.drawingId?.trim() || randomUUID();
    if ((current.drawings ?? []).some((drawing) => drawing.id === drawingId)) {
      throw new Error(`Drawing ${drawingId} already exists in graph ${current.id}`);
    }

    return {
      graph: {
        ...current,
        drawings: [
          ...(current.drawings ?? []),
          {
            id: drawingId,
            name: operation.name ?? `Drawing ${((current.drawings ?? []).length + 1)}`,
            position: {
              x: operation.x ?? 0,
              y: operation.y ?? 0,
            },
            paths: [],
          },
        ],
      },
      details: { drawingId },
    };
  },
  drawing_add_path: (current, operation) => {
    const drawing = (current.drawings ?? []).find((candidate) => candidate.id === operation.drawingId);
    if (!drawing) {
      throw new Error(`Drawing ${operation.drawingId} not found in graph ${current.id}`);
    }

    const localPoints = (operation.coordinateSpace ?? 'world') === 'local'
      ? operation.points
      : operation.points.map((point: { x: number; y: number }) => ({
          x: point.x - drawing.position.x,
          y: point.y - drawing.position.y,
        }));
    const nextPathId = operation.pathId ?? randomUUID();

    return {
      graph: {
        ...current,
        drawings: (current.drawings ?? []).map((candidate) =>
          candidate.id === operation.drawingId
            ? {
                ...candidate,
                paths: [
                  ...candidate.paths,
                  {
                    id: nextPathId,
                    color: normalizeDrawingColor(operation.color, '#ffffff'),
                    thickness: operation.thickness ?? 3,
                    points: localPoints,
                  },
                ],
              }
            : candidate
        ),
      },
      details: {
        drawingId: operation.drawingId,
        pathId: nextPathId,
      },
    };
  },
  drawing_move: (current, operation) => ({
    graph: {
      ...current,
      drawings: (current.drawings ?? []).map((drawing) =>
        drawing.id === operation.drawingId
          ? {
              ...drawing,
              position: { x: operation.x, y: operation.y },
            }
          : drawing
      ),
    },
  }),
  drawing_set_name: (current, operation) => ({
    graph: {
      ...current,
      drawings: (current.drawings ?? []).map((drawing) =>
        drawing.id === operation.drawingId
          ? {
              ...drawing,
              name: operation.name,
            }
          : drawing
      ),
    },
  }),
  drawing_delete: (current, operation) => ({
    graph: {
      ...current,
      drawings: (current.drawings ?? []).filter((drawing) => drawing.id !== operation.drawingId),
    },
  }),
};

