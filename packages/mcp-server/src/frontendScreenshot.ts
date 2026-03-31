import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright';
import type { GraphRuntimeState } from '../../domain/dist/index.js';
import {
  type Graph,
  normalizeGraph,
  type RenderBitmap,
  type RenderRegion,
} from './graphModel.js';
import { requestJson } from './mcpHttp.js';
import { ensureScreenshotHarnessServer } from './screenshotHarnessServer.js';

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

function resolveHarnessUrl(baseUrl: string): string {
  const targetUrl = new URL(baseUrl);
  if (targetUrl.pathname === '/' || targetUrl.pathname === '') {
    targetUrl.pathname = '/screenshot.html';
  }
  return targetUrl.toString();
}

function buildEmptyRuntimeState(graph: Graph): GraphRuntimeState {
  return {
    graphId: graph.id,
    revision: graph.revision ?? 0,
    statusVersion: graph.updatedAt,
    queueLength: 0,
    workerConcurrency: graph.recomputeConcurrency ?? 1,
    nodeStates: {},
    results: {},
  };
}

async function fetchRuntimeStateOrEmpty(backendUrl: string, graph: Graph): Promise<GraphRuntimeState> {
  try {
    return await requestJson<GraphRuntimeState>(
      backendUrl,
      `/api/graphs/${encodeURIComponent(graph.id)}/runtime-state`
    );
  } catch {
    return buildEmptyRuntimeState(graph);
  }
}

export async function renderGraphRegionScreenshotFromFrontend(params: {
  frontendUrl?: string;
  backendUrl: string;
  graphId: string;
  graphOverride?: Graph;
  region: RenderRegion;
  bitmap: RenderBitmap;
  outputPath?: string;
  includeBase64?: boolean;
}): Promise<{ outputPath: string; bytes: number; base64?: string }> {
  const graphData = params.graphOverride
    ? normalizeGraph(params.graphOverride)
    : normalizeGraph(await requestJson<Graph>(
      params.backendUrl,
      `/api/graphs/${encodeURIComponent(params.graphId)}`
    ));
  const runtimeState = await fetchRuntimeStateOrEmpty(params.backendUrl, graphData);
  const harnessBaseUrl = params.frontendUrl
    ? params.frontendUrl
    : (await ensureScreenshotHarnessServer()).baseUrl;
  const targetUrl = resolveHarnessUrl(harnessBaseUrl);

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

    try {
      const page = await context.newPage();
      const bootstrapPayload: unknown = {
        graph: graphData,
        runtimeState,
        backendUrl: params.backendUrl,
      };
      await page.addInitScript((bootstrap: unknown) => {
        (window as any).__k8vScreenshotHarnessBootstrap = bootstrap;
      }, bootstrapPayload);

      await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });

      try {
        await page.waitForFunction(() => {
          const harness = (window as any).__k8vScreenshotHarness;
          return Boolean(
            harness &&
              typeof harness.isCanvasReady === 'function' &&
              typeof harness.isGraphReady === 'function' &&
              typeof harness.setViewportRegion === 'function' &&
              harness.isCanvasReady() &&
              harness.isGraphReady()
          );
        }, undefined, {
          timeout: 30_000,
        });
      } catch (error) {
        const diagnostics = await page.evaluate(() => {
          const harness = (window as any).__k8vScreenshotHarness;
          return {
            location: window.location.href,
            readyState: document.readyState,
            title: document.title,
            hasCanvas: Boolean(document.querySelector('canvas')),
            hasHarness: Boolean(harness),
            harnessCanvasReady: typeof harness?.isCanvasReady === 'function' ? harness.isCanvasReady() : null,
            harnessGraphReady: typeof harness?.isGraphReady === 'function' ? harness.isGraphReady() : null,
            bodyTextPreview: document.body?.textContent?.slice(0, 240) ?? '',
          };
        }).catch(() => null);

        throw new Error(
          `Screenshot harness was not ready at ${targetUrl}.\n` +
          `Diagnostics: ${JSON.stringify(diagnostics)}\n` +
          `Cause: ${error instanceof Error ? error.message : String(error)}`
        );
      }

      const applied = await page.evaluate((payload) => {
        const harness = (window as any).__k8vScreenshotHarness;
        if (!harness || typeof harness.setViewportRegion !== 'function') {
          return false;
        }
        return Boolean(harness.setViewportRegion(payload.region, payload.bitmap));
      }, {
        region: params.region,
        bitmap: params.bitmap,
      });

      if (!applied) {
        throw new Error('Screenshot harness could not apply requested region.');
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
    } catch (error) {
      await context.close().catch(() => undefined);
      throw new Error(
        `Failed to render screenshot for graph ${params.graphId}. ` +
        `Harness URL: ${targetUrl}. ` +
        `Backend URL: ${params.backendUrl}. ` +
        `Cause: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  } finally {
    await browser.close();
  }
}
