import { z } from 'zod';
import { renderGraphRegionScreenshotFromFrontend } from './frontendScreenshot.js';
import {
  requestBinary,
  requestJson,
  textResult,
} from './mcpHttp.js';
import {
  type Graph,
  normalizeGraph,
} from './graphModel.js';

type GetGraphFn = (backendUrl: string, graphId: string) => Promise<Graph>;

interface RuntimeToolRegistrarDeps {
  resolveBackendUrl: (backendUrl?: string) => string;
  resolveFrontendUrl: (frontendUrl?: string) => string;
  getGraph: GetGraphFn;
}

export function registerRuntimeTools(server: any, deps: RuntimeToolRegistrarDeps): void {
  const {
    resolveBackendUrl,
    resolveFrontendUrl,
    getGraph,
  } = deps;

  server.registerTool(
    'graphics_get',
    {
      description:
        'Fetch a graphics artifact by id as binary image data, with optional backend mip-level selection by maxPixels.',
      inputSchema: {
        graphicsId: z.string(),
        maxPixels: z.number().int().positive().optional(),
        includeImage: z.boolean().optional(),
        backendUrl: z.string().optional(),
      },
    },
    async ({ graphicsId, maxPixels, includeImage, backendUrl }) => {
      const resolvedBackendUrl = resolveBackendUrl(backendUrl);
      const params = new URLSearchParams();
      if (typeof maxPixels === 'number' && Number.isFinite(maxPixels) && maxPixels > 0) {
        params.set('maxPixels', String(Math.floor(maxPixels)));
      }
      const query = params.toString();

      const { buffer, headers } = await requestBinary(
        resolvedBackendUrl,
        `/api/graphics/${encodeURIComponent(graphicsId)}/image${query ? `?${query}` : ''}`
      );

      const mimeType = headers.get('content-type') || 'application/octet-stream';
      const selectedLevel = {
        level: Number(headers.get('x-k8v-graphics-level') ?? '0'),
        width: Number(headers.get('x-k8v-graphics-width') ?? '0'),
        height: Number(headers.get('x-k8v-graphics-height') ?? '0'),
        pixelCount: Number(headers.get('x-k8v-graphics-pixels') ?? '0'),
      };

      const content: Array<{
        type: 'text' | 'image';
        text?: string;
        mimeType?: string;
        data?: string;
      }> = [
        {
          type: 'text',
          text: JSON.stringify(
            {
              graphicsId,
              mimeType,
              bytes: buffer.byteLength,
              selectedLevel,
            },
            null,
            2
          ),
        },
      ];

      if (includeImage !== false && mimeType.startsWith('image/')) {
        content.push({
          type: 'image',
          mimeType,
          data: buffer.toString('base64'),
        });
      }

      return { content };
    }
  );

  server.registerTool(
    'graph_screenshot_region',
    {
      description:
        'Render the frontend canvas-only view in Playwright and capture a fixed-size bitmap for a world-coordinate rectangle.',
      inputSchema: {
        graphId: z.string().optional(),
        graph: z.unknown().optional(),
        backendUrl: z.string().optional(),
        frontendUrl: z.string().optional(),
        regionX: z.number(),
        regionY: z.number(),
        regionWidth: z.number().positive(),
        regionHeight: z.number().positive(),
        bitmapWidth: z.number().int().positive(),
        bitmapHeight: z.number().int().positive(),
        outputPath: z.string().optional(),
        includeBase64: z.boolean().optional(),
      },
    },
    async ({
      graphId,
      graph,
      backendUrl,
      frontendUrl,
      regionX,
      regionY,
      regionWidth,
      regionHeight,
      bitmapWidth,
      bitmapHeight,
      outputPath,
      includeBase64,
    }) => {
      const resolvedBackendUrl = resolveBackendUrl(backendUrl);
      const resolvedFrontendUrl = resolveFrontendUrl(frontendUrl);
      const graphData = graph
        ? normalizeGraph(graph as Graph)
        : graphId
          ? await getGraph(resolvedBackendUrl, graphId)
          : normalizeGraph(await requestJson<Graph>(resolvedBackendUrl, '/api/graphs/latest'));

      const result = await renderGraphRegionScreenshotFromFrontend({
        frontendUrl: resolvedFrontendUrl,
        backendUrl: resolvedBackendUrl,
        graphId: graphData.id,
        graphOverride: graph ? graphData : undefined,
        region: {
          x: regionX,
          y: regionY,
          width: regionWidth,
          height: regionHeight,
        },
        bitmap: {
          width: bitmapWidth,
          height: bitmapHeight,
        },
        outputPath,
        includeBase64,
        allowBackendUrlFallback: !frontendUrl,
      });

      const content: Array<{
        type: 'text' | 'image';
        text?: string;
        mimeType?: string;
        data?: string;
      }> = [
        {
          type: 'text',
          text: JSON.stringify(
            {
              graphId: graphData.id,
              region: {
                x: regionX,
                y: regionY,
                width: regionWidth,
                height: regionHeight,
              },
              bitmap: {
                width: bitmapWidth,
                height: bitmapHeight,
              },
              frontendUrl: resolvedFrontendUrl,
              outputPath: result.outputPath,
              bytes: result.bytes,
            },
            null,
            2
          ),
        },
      ];

      if (result.base64) {
        content.push({
          type: 'image',
          mimeType: 'image/png',
          data: result.base64,
        });
      }

      return { content };
    }
  );
}
