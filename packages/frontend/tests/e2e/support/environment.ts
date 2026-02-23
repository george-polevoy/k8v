import { ChildProcess, spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { E2E_BACKEND_URL, E2E_FRONTEND_URL, E2E_START_TIMEOUT_MS } from './config.ts';

interface ManagedProcess {
  name: string;
  child: ChildProcess;
  logs: string[];
}

const SUPPORT_DIR = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = path.resolve(SUPPORT_DIR, '..', '..', '..');
const REPO_ROOT = path.resolve(FRONTEND_DIR, '..', '..');
const MAX_LOG_LINES = 160;
const POLL_INTERVAL_MS = 250;

let initialized = false;
let backendProcess: ManagedProcess | null = null;
let frontendProcess: ManagedProcess | null = null;

function recordLog(logs: string[], line: string): void {
  logs.push(line);
  if (logs.length > MAX_LOG_LINES) {
    logs.splice(0, logs.length - MAX_LOG_LINES);
  }
}

function attachProcessLogs(processInfo: ManagedProcess): void {
  const onOutput = (source: 'stdout' | 'stderr') => (chunk: Buffer | string) => {
    const text = String(chunk);
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      recordLog(processInfo.logs, `[${processInfo.name}:${source}] ${trimmed}`);
    }
  };

  processInfo.child.stdout?.on('data', onOutput('stdout'));
  processInfo.child.stderr?.on('data', onOutput('stderr'));
}

function startProcess(name: string, commandArgs: string[], envOverrides: Record<string, string>): ManagedProcess {
  const child = spawn('npm', commandArgs, {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      ...envOverrides,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const processInfo: ManagedProcess = {
    name,
    child,
    logs: [`[${name}] spawn npm ${commandArgs.join(' ')}`],
  };
  attachProcessLogs(processInfo);
  return processInfo;
}

function getRecentLogs(processInfo: ManagedProcess | null): string {
  if (!processInfo || processInfo.logs.length === 0) {
    return '';
  }
  return `\nRecent ${processInfo.name} logs:\n${processInfo.logs.join('\n')}`;
}

async function isHttpReady(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(1_500),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForUrl(url: string, timeoutMs: number, processInfo: ManagedProcess | null): Promise<void> {
  const startedAt = Date.now();
  while ((Date.now() - startedAt) < timeoutMs) {
    if (await isHttpReady(url)) {
      return;
    }

    if (processInfo && processInfo.child.exitCode !== null) {
      throw new Error(
        `Process "${processInfo.name}" exited before ${url} became ready. Exit code: ${processInfo.child.exitCode}.` +
          getRecentLogs(processInfo)
      );
    }

    await delay(POLL_INTERVAL_MS);
  }

  throw new Error(`Timed out waiting for ${url} (${timeoutMs}ms).${getRecentLogs(processInfo)}`);
}

function isDefaultLocalUrl(url: string, expectedPort: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === 'http:' &&
      (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') &&
      parsed.port === expectedPort
    );
  } catch {
    return false;
  }
}

async function stopProcess(processInfo: ManagedProcess | null): Promise<void> {
  if (!processInfo) {
    return;
  }
  if (processInfo.child.exitCode !== null) {
    return;
  }

  processInfo.child.kill('SIGTERM');
  const exited = await Promise.race([
    once(processInfo.child, 'exit').then(() => true),
    delay(4_000).then(() => false),
  ]);

  if (exited) {
    return;
  }

  processInfo.child.kill('SIGKILL');
  await Promise.race([
    once(processInfo.child, 'exit').then(() => undefined),
    delay(2_000).then(() => undefined),
  ]);
}

export async function ensureE2EEnvironment(): Promise<void> {
  if (initialized) {
    return;
  }

  try {
    const backendHealthUrl = `${E2E_BACKEND_URL}/api/graphs`;
    const frontendHealthUrl = E2E_FRONTEND_URL;

    if (!(await isHttpReady(backendHealthUrl))) {
      if (!isDefaultLocalUrl(E2E_BACKEND_URL, '3000')) {
        throw new Error(
          `Backend URL ${E2E_BACKEND_URL} is not reachable and cannot be auto-started. ` +
          'Use a local URL on port 3000 or start the backend manually.'
        );
      }
      backendProcess = startProcess('backend', ['run', 'dev:backend'], { PORT: '3000' });
      await waitForUrl(backendHealthUrl, E2E_START_TIMEOUT_MS, backendProcess);
    }

    if (!(await isHttpReady(frontendHealthUrl))) {
      if (!isDefaultLocalUrl(E2E_FRONTEND_URL, '5173')) {
        throw new Error(
          `Frontend URL ${E2E_FRONTEND_URL} is not reachable and cannot be auto-started. ` +
          'Use a local URL on port 5173 or start the frontend manually.'
        );
      }
      frontendProcess = startProcess(
        'frontend',
        ['run', 'dev:frontend', '--', '--host', '127.0.0.1', '--port', '5173', '--strictPort'],
        {}
      );
      await waitForUrl(frontendHealthUrl, E2E_START_TIMEOUT_MS, frontendProcess);
    }

    initialized = true;
  } catch (error) {
    await stopProcess(frontendProcess);
    await stopProcess(backendProcess);
    frontendProcess = null;
    backendProcess = null;
    initialized = false;
    throw error;
  }
}

export async function shutdownE2EEnvironment(): Promise<void> {
  await stopProcess(frontendProcess);
  await stopProcess(backendProcess);
  frontendProcess = null;
  backendProcess = null;
  initialized = false;
}
