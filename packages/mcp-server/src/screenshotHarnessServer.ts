import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { createServer as createNetServer } from 'node:net';

export interface ScreenshotHarnessServer {
  baseUrl: string;
  stop: () => Promise<void>;
}

const FRONTEND_ROOT = fileURLToPath(new URL('../../frontend', import.meta.url));
const VITE_BIN = fileURLToPath(new URL('../../../node_modules/vite/bin/vite.js', import.meta.url));

async function findFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createNetServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Could not resolve ephemeral port for screenshot harness.'));
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

async function waitForHttp(url: string, timeoutMs = 40_000): Promise<void> {
  const startedAt = Date.now();
  while ((Date.now() - startedAt) < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok || response.status === 404) {
        return;
      }
    } catch {
      // Keep retrying until timeout.
    }

    await delay(250);
  }

  throw new Error(`Timed out waiting for screenshot harness at ${url}`);
}

async function stopChildProcess(child: ChildProcess): Promise<void> {
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

export async function startScreenshotHarnessServer(): Promise<ScreenshotHarnessServer> {
  const port = await findFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(
    process.execPath,
    [
      VITE_BIN,
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
      '--strictPort',
    ],
    {
      cwd: path.resolve(FRONTEND_ROOT),
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
    await waitForHttp(`${baseUrl}/screenshot.html`);
  } catch (error) {
    await stopChildProcess(child);
    throw new Error(
      `Failed to start screenshot harness server.\nstdout:\n${stdout}\nstderr:\n${stderr}\n${String(error)}`
    );
  }

  return {
    baseUrl,
    stop: async () => {
      await stopChildProcess(child);
    },
  };
}

let managedHarnessPromise: Promise<ScreenshotHarnessServer> | null = null;

export async function ensureScreenshotHarnessServer(): Promise<ScreenshotHarnessServer> {
  if (!managedHarnessPromise) {
    managedHarnessPromise = startScreenshotHarnessServer().catch((error) => {
      managedHarnessPromise = null;
      throw error;
    });
  }

  const server = await managedHarnessPromise;
  return server;
}
