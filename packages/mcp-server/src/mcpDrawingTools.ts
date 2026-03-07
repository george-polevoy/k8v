import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { textResult } from './mcpHttp.js';
import {
  type Graph,
  normalizeDrawingColor,
} from './graphModel.js';

type UpdateGraphFn = (
  backendUrl: string,
  graphId: string,
  mutateGraph: (current: Graph) => Graph
) => Promise<Graph>;

interface DrawingToolRegistrarDeps {
  resolveBackendUrl: (backendUrl?: string) => string;
  updateGraph: UpdateGraphFn;
}

export function registerDrawingTools(server: any, deps: DrawingToolRegistrarDeps): void {
  const { resolveBackendUrl, updateGraph } = deps;

  server.registerTool(
    'drawing_create',
    {
      description: 'Create a persistent drawing object with a draggable handle/title.',
      inputSchema: {
        graphId: z.string(),
        name: z.string().optional(),
        x: z.number().optional(),
        y: z.number().optional(),
        backendUrl: z.string().optional(),
      },
    },
    async ({ graphId, name, x, y, backendUrl }) => {
      const resolvedBackendUrl = resolveBackendUrl(backendUrl);
      const drawingId = randomUUID();

      const graph = await updateGraph(resolvedBackendUrl, graphId, (current) => ({
        ...current,
        drawings: [
          ...(current.drawings ?? []),
          {
            id: drawingId,
            name: name ?? `Drawing ${((current.drawings ?? []).length + 1)}`,
            position: {
              x: x ?? 0,
              y: y ?? 0,
            },
            paths: [],
          },
        ],
      }));

      return textResult({ graphId, drawingId, graph });
    }
  );

  server.registerTool(
    'drawing_add_path',
    {
      description: 'Append a path to an existing drawing object.',
      inputSchema: {
        graphId: z.string(),
        drawingId: z.string(),
        points: z.array(z.object({ x: z.number(), y: z.number() })).min(1),
        color: z.union([z.string().regex(/^#[0-9a-fA-F]{6}$/), z.enum(['white', 'green', 'red'])]).optional(),
        thickness: z.number().positive().optional(),
        pathId: z.string().optional(),
        coordinateSpace: z.enum(['world', 'local']).optional(),
        backendUrl: z.string().optional(),
      },
    },
    async ({
      graphId,
      drawingId,
      points,
      color,
      thickness,
      pathId,
      coordinateSpace,
      backendUrl,
    }) => {
      const resolvedBackendUrl = resolveBackendUrl(backendUrl);

      const graph = await updateGraph(resolvedBackendUrl, graphId, (current) => {
        const drawing = (current.drawings ?? []).find((candidate) => candidate.id === drawingId);
        if (!drawing) {
          throw new Error(`Drawing ${drawingId} not found in graph ${graphId}`);
        }

        const localPoints = (coordinateSpace ?? 'world') === 'local'
          ? points
          : points.map((point) => ({
              x: point.x - drawing.position.x,
              y: point.y - drawing.position.y,
            }));

        return {
          ...current,
          drawings: (current.drawings ?? []).map((candidate) =>
            candidate.id === drawingId
              ? {
                  ...candidate,
                  paths: [
                    ...candidate.paths,
                    {
                      id: pathId ?? randomUUID(),
                      color: normalizeDrawingColor(color, '#ffffff'),
                      thickness: thickness ?? 3,
                      points: localPoints,
                    },
                  ],
                }
              : candidate
          ),
        };
      });

      return textResult(graph);
    }
  );

  server.registerTool(
    'drawing_move',
    {
      description: 'Move a drawing handle (and all of its paths) to a new world position.',
      inputSchema: {
        graphId: z.string(),
        drawingId: z.string(),
        x: z.number(),
        y: z.number(),
        backendUrl: z.string().optional(),
      },
    },
    async ({ graphId, drawingId, x, y, backendUrl }) => {
      const resolvedBackendUrl = resolveBackendUrl(backendUrl);

      const graph = await updateGraph(resolvedBackendUrl, graphId, (current) => ({
        ...current,
        drawings: (current.drawings ?? []).map((drawing) =>
          drawing.id === drawingId
            ? {
                ...drawing,
                position: { x, y },
              }
            : drawing
        ),
      }));

      return textResult(graph);
    }
  );

  server.registerTool(
    'drawing_set_name',
    {
      description: 'Rename a drawing object.',
      inputSchema: {
        graphId: z.string(),
        drawingId: z.string(),
        name: z.string(),
        backendUrl: z.string().optional(),
      },
    },
    async ({ graphId, drawingId, name, backendUrl }) => {
      const resolvedBackendUrl = resolveBackendUrl(backendUrl);

      const graph = await updateGraph(resolvedBackendUrl, graphId, (current) => ({
        ...current,
        drawings: (current.drawings ?? []).map((drawing) =>
          drawing.id === drawingId
            ? {
                ...drawing,
                name,
              }
            : drawing
        ),
      }));

      return textResult(graph);
    }
  );

  server.registerTool(
    'drawing_delete',
    {
      description: 'Delete a drawing object and all stored paths.',
      inputSchema: {
        graphId: z.string(),
        drawingId: z.string(),
        backendUrl: z.string().optional(),
      },
    },
    async ({ graphId, drawingId, backendUrl }) => {
      const resolvedBackendUrl = resolveBackendUrl(backendUrl);
      const graph = await updateGraph(resolvedBackendUrl, graphId, (current) => ({
        ...current,
        drawings: (current.drawings ?? []).filter((drawing) => drawing.id !== drawingId),
      }));

      return textResult(graph);
    }
  );
}
