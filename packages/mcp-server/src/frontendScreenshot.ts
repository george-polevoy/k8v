import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright';
import {
  type Graph,
  normalizeGraph,
  type RenderBitmap,
  type RenderRegion,
} from './graphModel.js';

function resolveOutputPath(explicitPath?: string): string {
  if (explicitPath) {
    return path.isAbsolute(explicitPath)
      ? explicitPath
      : path.resolve(process.cwd(), explicitPath);
  }

  return path.resolve(
    process.cwd(),
    'tmp',
    'mcp-screenshots',
    `graph-region-${Date.now()}.png`
  );
}

export async function renderGraphRegionScreenshotFromFrontend(params: {
  frontendUrl: string;
  backendUrl: string;
  graphId: string;
  graphOverride?: Graph;
  region: RenderRegion;
  bitmap: RenderBitmap;
  outputPath?: string;
  includeBase64?: boolean;
}): Promise<{ outputPath: string; bytes: number; base64?: string }> {
  const graphData = params.graphOverride ? normalizeGraph(params.graphOverride) : null;
  const browser = await chromium.launch({
    headless: true,
    args: ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
  });

  try {
    const context = await browser.newContext({
      viewport: {
        width: Math.max(1, Math.round(params.bitmap.width)),
        height: Math.max(1, Math.round(params.bitmap.height)),
      },
      deviceScaleFactor: 1,
    });

    await context.route(/\/api\/.*/, async (route) => {
      const request = route.request();
      const requestUrl = new URL(request.url());
      const method = request.method().toUpperCase();
      const proxyUrl = `${params.backendUrl}${requestUrl.pathname}${requestUrl.search}`;

      if (graphData && method === 'GET' && requestUrl.pathname === '/api/graphs/latest') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(graphData),
        });
        return;
      }

      if (graphData && method === 'GET' && requestUrl.pathname === '/api/graphs') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            graphs: [
              {
                id: graphData.id,
                name: graphData.name,
                updatedAt: graphData.updatedAt,
              },
            ],
          }),
        });
        return;
      }

      if (graphData && method === 'GET' && requestUrl.pathname.startsWith('/api/graphs/')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(graphData),
        });
        return;
      }

      const requestHeaders = request.headers();
      const proxyHeaders = Object.fromEntries(
        Object.entries(requestHeaders).filter(([key]) => key.toLowerCase() !== 'host')
      );
      const requestBody = method === 'GET' || method === 'HEAD'
        ? undefined
        : request.postData() ?? undefined;
      const proxyResponse = await fetch(proxyUrl, {
        method,
        headers: proxyHeaders,
        body: requestBody,
      });
      const buffer = Buffer.from(await proxyResponse.arrayBuffer());
      const responseHeaders: Record<string, string> = {};
      proxyResponse.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });
      await route.fulfill({
        status: proxyResponse.status,
        headers: responseHeaders,
        body: buffer,
      });
    });

    const page = await context.newPage();
    await page.addInitScript((targetGraphId: string) => {
      window.localStorage.setItem('k8v-current-graph-id', targetGraphId);
    }, params.graphId);
    const targetUrl = new URL(params.frontendUrl);
    targetUrl.searchParams.set('canvasOnly', '1');
    targetUrl.searchParams.set('mcpScreenshot', '1');
    await page.goto(targetUrl.toString(), { waitUntil: 'domcontentloaded' });

    await page.waitForFunction(() => {
      const bridge = (window as any).__k8vMcpScreenshotBridge;
      return Boolean(
        bridge &&
          typeof bridge.isCanvasReady === 'function' &&
          typeof bridge.isGraphReady === 'function' &&
          typeof bridge.setViewportRegion === 'function' &&
          bridge.isCanvasReady() &&
          bridge.isGraphReady()
      );
    });

    const applied = await page.evaluate((payload) => {
      const bridge = (window as any).__k8vMcpScreenshotBridge;
      if (!bridge || typeof bridge.setViewportRegion !== 'function') {
        return false;
      }
      return Boolean(bridge.setViewportRegion(payload.region, payload.bitmap));
    }, {
      region: params.region,
      bitmap: params.bitmap,
    });

    if (!applied) {
      throw new Error('Frontend canvas screenshot bridge could not apply requested region.');
    }

    await page.evaluate(async () => {
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => resolve());
        });
      });
    });

    const outputPath = resolveOutputPath(params.outputPath);
    await mkdir(path.dirname(outputPath), { recursive: true });

    const canvasRoot = page.locator('[data-testid="canvas-root"]');
    const imageBuffer = await canvasRoot.screenshot({
      path: outputPath,
      type: 'png',
    });

    await context.close();

    return {
      outputPath,
      bytes: imageBuffer.byteLength,
      ...(params.includeBase64
        ? {
            base64: imageBuffer.toString('base64'),
          }
        : {}),
    };
  } finally {
    await browser.close();
  }
}
