import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const CANVAS_ZOOM_SENSITIVITY = 0.0014;

function readArg(flag, fallback = null) {
  const index = process.argv.indexOf(flag);
  if (index === -1 || index + 1 >= process.argv.length) {
    return fallback;
  }
  return process.argv[index + 1];
}

function hasArg(flag) {
  return process.argv.includes(flag);
}

function loadGraph(graphPath) {
  if (!graphPath) {
    const now = Date.now();
    return {
      id: 'snapshot-graph',
      name: 'Snapshot Graph',
      nodes: [
        {
          id: 'n1',
          type: 'numeric_input',
          position: { x: -260, y: 40 },
          metadata: {
            name: 'Source',
            inputs: [],
            outputs: [{ name: 'value', schema: { type: 'number' } }],
          },
          config: {
            value: 5,
            min: 0,
            max: 10,
            step: 1,
          },
          version: String(now),
        },
        {
          id: 'n2',
          type: 'inline_code',
          position: { x: 40, y: 20 },
          metadata: {
            name: 'Transform',
            inputs: [{ name: 'input', schema: { type: 'number' } }],
            outputs: [{ name: 'output', schema: { type: 'number' } }],
          },
          config: {
            runtime: 'javascript_vm',
            code: 'outputs.output = (inputs.input ?? 0) * 2;',
          },
          version: String(now),
        },
        {
          id: 'n3',
          type: 'inline_code',
          position: { x: 360, y: 60 },
          metadata: {
            name: 'Result',
            inputs: [{ name: 'input', schema: { type: 'number' } }],
            outputs: [{ name: 'output', schema: { type: 'number' } }],
          },
          config: {
            runtime: 'javascript_vm',
            code: 'outputs.output = inputs.input;',
          },
          version: String(now),
        },
      ],
      connections: [
        {
          id: 'c1',
          sourceNodeId: 'n1',
          sourcePort: 'value',
          targetNodeId: 'n2',
          targetPort: 'input',
        },
        {
          id: 'c2',
          sourceNodeId: 'n2',
          sourcePort: 'output',
          targetNodeId: 'n3',
          targetPort: 'input',
        },
      ],
      createdAt: now,
      updatedAt: now,
    };
  }

  const absolutePath = resolve(process.cwd(), graphPath);
  const contents = readFileSync(absolutePath, 'utf8');
  return JSON.parse(contents);
}

async function waitForServer(url, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok || response.status === 404) {
        return;
      }
    } catch {
      // Server is not ready yet.
    }
    await delay(250);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function startDevServer(frontendDir, port) {
  const child = spawn(
    'npm',
    ['run', 'dev', '--', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
    {
      cwd: frontendDir,
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );

  child.stdout.on('data', (chunk) => {
    process.stdout.write(`[vite] ${String(chunk)}`);
  });

  child.stderr.on('data', (chunk) => {
    process.stderr.write(`[vite] ${String(chunk)}`);
  });

  return child;
}

async function stopServer(child) {
  if (!child || child.exitCode !== null) {
    return;
  }

  child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolveExit) => child.once('exit', resolveExit)),
    delay(3000),
  ]);

  if (child.exitCode === null) {
    child.kill('SIGKILL');
  }
}

async function captureSnapshot({ baseUrl, graph, outputPath, width, height, dpr, fullPage, zoom }) {
  const browser = await chromium.launch({
    headless: true,
    args: ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
  });
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: dpr,
  });

  try {
    await context.route(/\/api\/.*/, async (route) => {
      const request = route.request();
      const requestUrl = new URL(request.url());
      const method = request.method();

      if (method === 'GET' && requestUrl.pathname === '/api/graphs/latest') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(graph),
        });
        return;
      }

      if (method === 'GET' && requestUrl.pathname.startsWith('/api/graphs/')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(graph),
        });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: '{}',
      });
    });

    context.on('requestfailed', (request) => {
      process.stderr.write(`[requestfailed] ${request.url()} (${request.failure()?.errorText})\n`);
    });

    const page = await context.newPage();
    page.on('pageerror', (error) => {
      process.stderr.write(`[pageerror] ${error.stack ?? String(error)}\n`);
    });
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        process.stderr.write(`[browser:${msg.type()}] ${msg.text()}\n`);
      }
    });

    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    try {
      await page.waitForSelector('canvas', { state: 'attached', timeout: 20000 });
    } catch (error) {
      const debugPath = outputPath.replace(/\.png$/i, '.debug.png');
      mkdirSync(dirname(debugPath), { recursive: true });
      await page.screenshot({ path: debugPath, fullPage: true });
      throw new Error(
        `Canvas was not rendered. Debug screenshot written to ${debugPath}\n${String(error)}`
      );
    }
    await delay(500);

    const canvas = page.locator('canvas').first();
    const canvasBox = await canvas.boundingBox();

    if (canvasBox && Number.isFinite(zoom) && zoom > 0 && zoom !== 1) {
      const zoomDelta = -Math.log(zoom) / CANVAS_ZOOM_SENSITIVITY;
      await page.mouse.move(
        canvasBox.x + canvasBox.width / 2,
        canvasBox.y + canvasBox.height / 2
      );
      await page.mouse.wheel(0, zoomDelta);
      await delay(250);
    }

    mkdirSync(dirname(outputPath), { recursive: true });
    if (fullPage) {
      await page.screenshot({ path: outputPath, fullPage: true });
    } else if ((await canvas.count()) > 0) {
      await canvas.screenshot({ path: outputPath });
    } else {
      await page.screenshot({ path: outputPath, fullPage: true });
    }
  } finally {
    await context.close();
    await browser.close();
  }
}

async function main() {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const frontendDir = resolve(scriptDir, '..');
  const graphPath = readArg('--graph');
  const outputPath = resolve(
    frontendDir,
    readArg('--out', 'tmp/canvas-snapshot.png')
  );
  const width = Number.parseInt(readArg('--width', '2400'), 10);
  const height = Number.parseInt(readArg('--height', '1350'), 10);
  const dpr = Number.parseFloat(readArg('--dpr', '2'));
  const zoom = Number.parseFloat(readArg('--zoom', '2'));
  const fullPage = hasArg('--full-page');
  const port = Number.parseInt(readArg('--port', '4173'), 10);
  const baseUrl = readArg('--url', `http://127.0.0.1:${port}`);
  const graph = loadGraph(graphPath);

  let serverProcess = null;

  try {
    if (!hasArg('--reuse-server')) {
      serverProcess = startDevServer(frontendDir, port);
      await waitForServer(baseUrl, 45000);
    }

    await captureSnapshot({ baseUrl, graph, outputPath, width, height, dpr, fullPage, zoom });
    process.stdout.write(`Canvas snapshot written to ${outputPath}\n`);
  } finally {
    await stopServer(serverProcess);
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
