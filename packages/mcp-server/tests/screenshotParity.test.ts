import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { PNG } from 'pngjs';
import { chromium } from 'playwright';
import { renderGraphRegionScreenshotFromFrontend } from '../src/index.ts';

interface FrontendDevServer {
  url: string;
  stop: () => Promise<void>;
}

interface BackendStubServer {
  url: string;
  setGraph: (graph: any) => void;
  stop: () => Promise<void>;
}

interface ScreenshotRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ScreenshotBitmap {
  width: number;
  height: number;
}

function pngBuffersMatch(left: Buffer, right: Buffer): boolean {
  if (left.equals(right)) {
    return true;
  }

  const leftImage = PNG.sync.read(left);
  const rightImage = PNG.sync.read(right);
  if (leftImage.width !== rightImage.width || leftImage.height !== rightImage.height) {
    return false;
  }

  return leftImage.data.equals(rightImage.data);
}

async function findFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createNetServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Could not resolve ephemeral port for test server.'));
        return;
      }
      const port = address.port;
      server.close((closeError) => {
        if (closeError) {
          reject(closeError);
          return;
        }
        resolve(port);
      });
    });
  });
}

async function waitForHttp(url: string, timeoutMs = 30_000): Promise<void> {
  const startedAt = Date.now();
  while ((Date.now() - startedAt) < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok || response.status === 404) {
        return;
      }
    } catch {
      // Retry until timeout.
    }
    await delay(250);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function startFrontendDevServer(): Promise<FrontendDevServer> {
  const port = await findFreePort();
  const frontendUrl = `http://127.0.0.1:${port}`;
  const viteBin = path.resolve(process.cwd(), 'node_modules', 'vite', 'bin', 'vite.js');
  const child = spawn(
    process.execPath,
    [
      viteBin,
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
      '--strictPort',
    ],
    {
      cwd: path.resolve(process.cwd(), 'packages/frontend'),
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk: Buffer) => {
    stdout += chunk.toString();
  });
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });

  try {
    await waitForHttp(frontendUrl, 40_000);
  } catch (error) {
    child.kill('SIGKILL');
    await new Promise<void>((resolve) => {
      child.once('exit', () => resolve());
    });
    throw new Error(
      `Failed to start frontend dev server.\nstdout:\n${stdout}\nstderr:\n${stderr}\n${String(error)}`
    );
  }

  return {
    url: frontendUrl,
    stop: async () => {
      await stopChildProcess(child);
    },
  };
}

async function stopChildProcess(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null) {
    return;
  }

  child.kill('SIGTERM');
  await Promise.race([
    new Promise<void>((resolve) => {
      child.once('exit', () => resolve());
    }),
    delay(5_000),
  ]);

  if (child.exitCode === null) {
    child.kill('SIGKILL');
    await new Promise<void>((resolve) => {
      child.once('exit', () => resolve());
    });
  }
}

async function startBackendStubServer(): Promise<BackendStubServer> {
  let activeGraph: any = null;

  const server = createHttpServer((req, res) => {
    const method = (req.method || 'GET').toUpperCase();
    const requestUrl = new URL(req.url || '/', 'http://127.0.0.1');

    const writeJson = (status: number, payload: unknown) => {
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(payload));
    };

    if (method === 'GET' && requestUrl.pathname === '/api/graphs/latest') {
      if (!activeGraph) {
        writeJson(404, { error: 'Graph not found' });
        return;
      }
      writeJson(200, activeGraph);
      return;
    }

    if (method === 'GET' && requestUrl.pathname === '/api/graphs') {
      if (!activeGraph) {
        writeJson(200, { graphs: [] });
        return;
      }
      writeJson(200, {
        graphs: [{
          id: activeGraph.id,
          name: activeGraph.name,
          revision: activeGraph.revision ?? 0,
          updatedAt: activeGraph.updatedAt,
        }],
      });
      return;
    }

    if (method === 'GET' && /^\/api\/graphs\/[^/]+$/.test(requestUrl.pathname)) {
      if (!activeGraph) {
        writeJson(404, { error: 'Graph not found' });
        return;
      }
      writeJson(200, activeGraph);
      return;
    }

    if (method === 'GET' && /^\/api\/graphs\/[^/]+\/runtime-state$/.test(requestUrl.pathname)) {
      writeJson(200, {
        graphId: activeGraph?.id ?? 'unknown',
        revision: activeGraph?.revision ?? 0,
        statusVersion: activeGraph?.updatedAt ?? Date.now(),
        queueLength: 0,
        workerConcurrency: activeGraph?.recomputeConcurrency ?? 1,
        nodeStates: {},
        results: {},
      });
      return;
    }

    if (method === 'GET' && /^\/api\/graphs\/[^/]+\/events$/.test(requestUrl.pathname)) {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.end(': connected\n\n');
      return;
    }

    writeJson(200, {});
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => resolve());
    server.once('error', reject);
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new Error('Could not resolve backend stub server port.');
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    setGraph: (graph: any) => {
      activeGraph = graph;
    },
    stop: async () => {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    },
  };
}

function createBaseGraph() {
  const now = Date.now();
  return {
    id: 'graph-screenshot-parity',
    name: 'Parity Graph',
    revision: 0,
    nodes: [] as Array<any>,
    connections: [] as Array<any>,
    canvasBackground: { mode: 'solid', baseColor: '#123456' },
    createdAt: now,
    updatedAt: now,
  };
}

function createInlineNode(params: {
  id: string;
  x: number;
  y: number;
  inputs?: string[];
  outputs?: string[];
  cardWidth?: number;
  cardHeight?: number;
}) {
  return {
    id: params.id,
    type: 'inline_code',
    position: { x: params.x, y: params.y },
    metadata: {
      name: params.id,
      inputs: (params.inputs ?? []).map((name) => ({ name, schema: { type: 'number' } })),
      outputs: (params.outputs ?? []).map((name) => ({ name, schema: { type: 'number' } })),
    },
    config: {
      type: 'inline_code',
      code: 'outputs.output = 1;',
      runtime: 'javascript_vm',
      config: {
        ...(typeof params.cardWidth === 'number' ? { cardWidth: params.cardWidth } : {}),
        ...(typeof params.cardHeight === 'number' ? { cardHeight: params.cardHeight } : {}),
      },
    },
    version: `${params.id}-v1`,
  };
}

async function captureDirectFrontendScreenshot(params: {
  frontendUrl: string;
  backendUrl: string;
  graphId: string;
  graphOverride: any;
  region: ScreenshotRegion;
  bitmap: ScreenshotBitmap;
}): Promise<Buffer> {
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

      if (method === 'GET' && requestUrl.pathname === '/api/graphs/latest') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(params.graphOverride),
        });
        return;
      }

      if (method === 'GET' && requestUrl.pathname === '/api/graphs') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            graphs: [
              {
                id: params.graphOverride.id,
                name: params.graphOverride.name,
                revision: params.graphOverride.revision ?? 0,
                updatedAt: params.graphOverride.updatedAt,
              },
            ],
          }),
        });
        return;
      }

      if (method === 'GET' && /^\/api\/graphs\/[^/]+\/runtime-state$/.test(requestUrl.pathname)) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            graphId: params.graphOverride.id,
            revision: params.graphOverride.revision ?? 0,
            statusVersion: params.graphOverride.updatedAt,
            queueLength: 0,
            workerConcurrency: params.graphOverride.recomputeConcurrency ?? 1,
            nodeStates: {},
            results: {},
          }),
        });
        return;
      }

      if (method === 'GET' && /^\/api\/graphs\/[^/]+\/events$/.test(requestUrl.pathname)) {
        await route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          body: ': connected\n\n',
        });
        return;
      }

      if (method === 'GET' && requestUrl.pathname.startsWith('/api/graphs/')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(params.graphOverride),
        });
        return;
      }

      const requestHeaders = request.headers();
      const proxyHeaders = Object.fromEntries(
        Object.entries(requestHeaders).filter(([key]) => key.toLowerCase() !== 'host')
      );
      const proxyResponse = await fetch(proxyUrl, {
        method,
        headers: proxyHeaders,
        body: method === 'GET' || method === 'HEAD'
          ? undefined
          : request.postDataBuffer() ?? undefined,
      });
      const buffer = Buffer.from(await proxyResponse.arrayBuffer());
      await route.fulfill({
        status: proxyResponse.status,
        headers: Object.fromEntries(proxyResponse.headers.entries()),
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

    assert.equal(applied, true, 'Expected direct capture bridge region application to succeed.');

    await page.evaluate(async () => {
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => resolve());
        });
      });
    });

    const imageBuffer = await page.locator('[data-testid="canvas-root"]').screenshot({ type: 'png' });
    await context.close();
    return imageBuffer;
  } finally {
    await browser.close();
  }
}

let frontendServer: FrontendDevServer | null = null;
let backendServer: BackendStubServer | null = null;

test.before(async () => {
  frontendServer = await startFrontendDevServer();
  backendServer = await startBackendStubServer();
});

test.after(async () => {
  if (frontendServer) {
    await frontendServer.stop();
  }
  if (backendServer) {
    await backendServer.stop();
  }
});

test('frontend screenshot function matches direct frontend canvas capture', async () => {
  assert.ok(frontendServer);
  assert.ok(backendServer);

  const graph = createBaseGraph();
  graph.nodes.push(
    createInlineNode({
      id: 'source',
      x: 40,
      y: 40,
      outputs: ['value'],
      cardWidth: 280,
      cardHeight: 110,
    }),
    createInlineNode({
      id: 'target',
      x: 360,
      y: 120,
      inputs: ['input'],
    })
  );
  graph.connections.push({
    id: 'c1',
    sourceNodeId: 'source',
    sourcePort: 'value',
    targetNodeId: 'target',
    targetPort: 'input',
  });

  backendServer.setGraph(graph);

  const region = {
    x: -40,
    y: -30,
    width: 720,
    height: 420,
  };
  const bitmap = {
    width: 720,
    height: 420,
  };

  const outputDir = path.resolve(process.cwd(), 'tmp', 'mcp-screenshot-parity-tests');
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `frontend-parity-${Date.now()}.png`);

  let buffersMatch = false;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const result = await renderGraphRegionScreenshotFromFrontend({
      frontendUrl: frontendServer.url,
      backendUrl: backendServer.url,
      graphId: graph.id,
      graphOverride: graph,
      region,
      bitmap,
      outputPath,
      includeBase64: true,
    });

    assert.ok(result.base64, 'Expected base64 payload from frontend screenshot renderer.');
    const functionBuffer = Buffer.from(result.base64, 'base64');

    const directBuffer = await captureDirectFrontendScreenshot({
      frontendUrl: frontendServer.url,
      backendUrl: backendServer.url,
      graphId: graph.id,
      graphOverride: graph,
      region,
      bitmap,
    });

    buffersMatch = pngBuffersMatch(functionBuffer, directBuffer);
    if (buffersMatch) {
      break;
    }

    await delay(120);
  }

  assert.equal(buffersMatch, true, 'Expected MCP screenshot output to match direct frontend capture exactly.');
  await rm(outputPath, { force: true });
});

test('frontend screenshot function respects requested bitmap dimensions', async () => {
  assert.ok(frontendServer);
  assert.ok(backendServer);

  const graph = createBaseGraph();
  graph.nodes.push(
    createInlineNode({
      id: 'only',
      x: 10,
      y: 20,
      cardWidth: 320,
      cardHeight: 120,
    })
  );
  backendServer.setGraph(graph);

  const bitmap = {
    width: 640,
    height: 360,
  };

  const result = await renderGraphRegionScreenshotFromFrontend({
    frontendUrl: frontendServer.url,
    backendUrl: backendServer.url,
    graphId: graph.id,
    graphOverride: graph,
    region: {
      x: -20,
      y: -20,
      width: 640,
      height: 360,
    },
    bitmap,
    includeBase64: true,
  });

  assert.ok(result.base64, 'Expected base64 payload from frontend screenshot renderer.');
  const image = PNG.sync.read(Buffer.from(result.base64, 'base64'));
  assert.equal(image.width, bitmap.width);
  assert.equal(image.height, bitmap.height);
});

test('frontend screenshot function works with backend graph loading when no override is provided', async () => {
  assert.ok(frontendServer);
  assert.ok(backendServer);

  const graph = createBaseGraph();
  graph.id = `backend-loaded-${Date.now()}`;
  graph.nodes.push(
    createInlineNode({
      id: 'backend-node',
      x: 120,
      y: 90,
      outputs: ['output'],
    })
  );
  backendServer.setGraph(graph);

  const result = await renderGraphRegionScreenshotFromFrontend({
    frontendUrl: frontendServer.url,
    backendUrl: backendServer.url,
    graphId: graph.id,
    region: {
      x: 0,
      y: 0,
      width: 800,
      height: 500,
    },
    bitmap: {
      width: 800,
      height: 500,
    },
    includeBase64: true,
  });

  assert.ok(result.base64, 'Expected base64 screenshot when loading graph from backend.');
  const image = PNG.sync.read(Buffer.from(result.base64, 'base64'));
  assert.equal(image.width, 800);
  assert.equal(image.height, 500);
});
