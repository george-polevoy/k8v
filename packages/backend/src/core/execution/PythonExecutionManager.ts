import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { spawn, type ChildProcess, type ChildProcessByStdio } from 'node:child_process';
import type { Readable } from 'node:stream';
import type { ExecutionResult } from './types.js';

const DEFAULT_IDLE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_STARTUP_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_REQUESTS_PER_WORKER = 100;
const DEFAULT_REQUEST_PADDING_MS = 2_000;

const PYTHON_WORKER_SCRIPT = String.raw`
import base64
import builtins
import importlib
import io
import json
import os
import sys
import uuid

SERVICE_CWD = os.environ.get("K8V_SERVICE_CWD", "").strip()
SERVICE_CWD_REAL = os.path.realpath(SERVICE_CWD) if SERVICE_CWD else ""


class AttrDict(dict):
    def __getattr__(self, key):
        if key in self:
            return self[key]
        raise AttributeError(key)

    def __setattr__(self, key, value):
        self[key] = value


def to_attr(value):
    if isinstance(value, dict):
        wrapped = AttrDict()
        for key, item in value.items():
            wrapped[key] = to_attr(item)
        return wrapped
    if isinstance(value, list):
        return [to_attr(item) for item in value]
    return value


def to_plain(value):
    if isinstance(value, AttrDict):
        return {key: to_plain(item) for key, item in value.items()}
    if isinstance(value, dict):
        return {key: to_plain(item) for key, item in value.items()}
    if isinstance(value, list):
        return [to_plain(item) for item in value]
    return value


def clear_local_modules():
    if not SERVICE_CWD_REAL:
        return

    to_delete = []
    for module_name, module in list(sys.modules.items()):
        module_file = getattr(module, "__file__", None)
        if not module_file:
            continue

        try:
            module_real = os.path.realpath(module_file)
            if os.path.commonpath([SERVICE_CWD_REAL, module_real]) == SERVICE_CWD_REAL:
                to_delete.append(module_name)
        except Exception:
            continue

    for module_name in to_delete:
        sys.modules.pop(module_name, None)

    importlib.invalidate_caches()


PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


def to_png_data_url(raw_bytes):
    return "data:image/png;base64," + base64.b64encode(raw_bytes).decode("ascii")


def try_parse_png_base64(value):
    try:
        decoded = base64.b64decode(value, validate=True)
    except Exception:
        return None

    if decoded.startswith(PNG_SIGNATURE):
        return to_png_data_url(decoded)

    return None


def normalize_graphics_output(value):
    if value is None:
        raise ValueError("graphics output is None")

    if isinstance(value, str):
        candidate = value.strip()
        if not candidate:
            raise ValueError("graphics output string is empty")

        if candidate.startswith("data:image/"):
            return candidate

        parsed = try_parse_png_base64(candidate)
        if parsed is not None:
            return parsed

        return candidate

    if isinstance(value, (bytes, bytearray, memoryview)):
        return to_png_data_url(bytes(value))

    if hasattr(value, "savefig"):
        buffer = io.BytesIO()
        value.savefig(buffer, format="png", transparent=True)
        return to_png_data_url(buffer.getvalue())

    if hasattr(value, "save"):
        buffer = io.BytesIO()
        value.save(buffer, format="PNG")
        return to_png_data_url(buffer.getvalue())

    raise TypeError(f"Unsupported graphics output type: {type(value).__name__}")


def execute_request(request):
    marker = request.get("marker", f"<{uuid.uuid4()}>")
    text_output_lines = []
    graphics_outputs = []
    text_output_buffer = ""
    original_builtin_print = builtins.print
    outputs = AttrDict()

    def append_text_chunk(chunk):
        nonlocal text_output_buffer
        if chunk is None:
            return
        normalized = str(chunk).replace("\r\n", "\n").replace("\r", "\n")
        text_output_buffer += normalized
        while "\n" in text_output_buffer:
            line, text_output_buffer = text_output_buffer.split("\n", 1)
            text_output_lines.append(line)

    def flush_text_buffer():
        nonlocal text_output_buffer
        if text_output_buffer:
            text_output_lines.append(text_output_buffer)
            text_output_buffer = ""

    def log_fn(*args, **kwargs):
        sep = kwargs.get("sep", " ")
        end = kwargs.get("end", "\n")
        target_file = kwargs.get("file")
        if target_file not in (None, sys.stdout, sys.stderr):
            original_builtin_print(*args, **kwargs)
            return
        append_text_chunk(sep.join(str(arg) for arg in args) + str(end))

    def output_graphics(data):
        graphics_outputs.append(normalize_graphics_output(data))

    execution_globals = {
        "__builtins__": __builtins__,
        "inputs": to_attr(request.get("inputs", {})),
        "outputs": outputs,
        "print": log_fn,
        "log": log_fn,
        "outputGraphics": output_graphics,
        "outputImage": output_graphics,
        "outputPng": output_graphics,
        "outputPNG": output_graphics,
    }

    try:
        clear_local_modules()
        builtins.print = log_fn
        exec(request.get("code", ""), execution_globals, execution_globals)
        flush_text_buffer()
        result = {
            "outputs": to_plain(outputs),
            "textOutput": "\n".join(text_output_lines) if text_output_lines else None,
            "graphicsOutput": graphics_outputs[-1] if graphics_outputs else None,
        }
    except Exception as error:
        flush_text_buffer()
        result = {
            "outputs": {},
            "textOutput": f"Error: {str(error)}",
            "graphicsOutput": None,
        }
    finally:
        builtins.print = original_builtin_print

    sys.stdout.write(marker + json.dumps(result) + marker + "\n")
    sys.stdout.flush()


for line in sys.stdin:
    if not line:
        break
    try:
        request = json.loads(line)
    except Exception:
        continue
    execute_request(request)
`;

const PYTHON_SERVICE_SCRIPT = String.raw`
import json
import os
import queue
import socket
import socketserver
import subprocess
import sys
import threading
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

CONFIG = json.loads(os.environ.get("K8V_PYTHON_SERVICE_CONFIG", "{}"))
WORKER_SCRIPT = os.environ.get("K8V_PYTHON_WORKER_SCRIPT", "")
SERVICE_CWD = os.environ.get("K8V_SERVICE_CWD", "").strip()
MAX_REQUESTS_PER_WORKER = max(1, int(CONFIG.get("maxRequestsPerWorker", 100)))


class WorkerTimeoutError(Exception):
    pass


class WorkerTransportError(Exception):
    pass


class WorkerCrashedError(Exception):
    pass


class WorkerProcess:
    def __init__(self, worker_id):
        self.worker_id = worker_id
        self.request_count = 0
        self.retire_when_idle = False
        self.process = subprocess.Popen(
            [sys.executable, "-u", "-c", WORKER_SCRIPT],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
            cwd=SERVICE_CWD or None,
            env={**os.environ, "K8V_SERVICE_CWD": SERVICE_CWD},
        )
        self._lock = threading.Lock()
        self._event = None
        self._marker = None
        self._result = None
        self._error = None
        self._stderr_tail = ""
        self._closed = False
        self._stdout_thread = threading.Thread(target=self._stdout_loop, daemon=True)
        self._stderr_thread = threading.Thread(target=self._stderr_loop, daemon=True)
        self._stdout_thread.start()
        self._stderr_thread.start()

    def _stdout_loop(self):
        try:
            for line in self.process.stdout:
                self._handle_stdout_line(line)
        finally:
            self._signal_closed()

    def _stderr_loop(self):
        try:
            for line in self.process.stderr:
                self._stderr_tail = (self._stderr_tail + line)[-4000:]
        finally:
            self._signal_closed()

    def _handle_stdout_line(self, line):
        with self._lock:
            if not self._marker:
                return
            start = line.find(self._marker)
            if start == -1:
                return
            end = line.find(self._marker, start + len(self._marker))
            if end == -1:
                return
            payload = line[start + len(self._marker):end]
            try:
                self._result = json.loads(payload)
            except Exception as error:
                self._error = f"Worker returned invalid JSON: {error}"
            if self._event:
                self._event.set()

    def _signal_closed(self):
        with self._lock:
            self._closed = True
            if self._event and not self._event.is_set():
                self._error = self._error or self._build_exit_error()
                self._event.set()

    def _build_exit_error(self):
        code = self.process.poll()
        suffix = f"Worker exited with code {code}" if code is not None else "Worker exited unexpectedly"
        stderr = self._stderr_tail.strip()
        return suffix + (f"\n{stderr}" if stderr else "")

    def is_alive(self):
        return self.process.poll() is None

    def execute(self, code, inputs, timeout_ms):
        marker = f"<{uuid.uuid4()}>"
        payload = json.dumps({
            "marker": marker,
            "code": code,
            "inputs": inputs,
        })
        with self._lock:
            if self._closed or self.process.poll() is not None:
                raise WorkerCrashedError(self._build_exit_error())
            self._marker = marker
            self._result = None
            self._error = None
            self._event = threading.Event()
            try:
                self.process.stdin.write(payload + "\n")
                self.process.stdin.flush()
            except Exception as error:
                raise WorkerTransportError(str(error))
            event = self._event

        if not event.wait(max(timeout_ms, 1) / 1000.0):
            raise WorkerTimeoutError("Script execution timed out")

        with self._lock:
            result = self._result
            error = self._error
            self._marker = None
            self._result = None
            self._error = None
            self._event = None

        if error:
            raise WorkerCrashedError(error)

        self.request_count += 1
        return result

    def should_recycle(self):
        return self.request_count >= MAX_REQUESTS_PER_WORKER or self.retire_when_idle

    def terminate(self):
        if self.process.poll() is not None:
            return
        try:
            self.process.kill()
        except Exception:
            return
        try:
            self.process.wait(timeout=1)
        except Exception:
            pass


class WorkerPool:
    def __init__(self, worker_count):
        self._lock = threading.Lock()
        self._idle = queue.Queue()
        self._workers = []
        self._desired_count = max(1, int(worker_count))
        self._next_worker_id = 1
        self._requests_served = 0
        self._ensure_worker_count_locked()

    def _spawn_worker_locked(self):
        worker = WorkerProcess(self._next_worker_id)
        self._next_worker_id += 1
        self._workers.append(worker)
        self._idle.put(worker)
        return worker

    def _remove_worker_locked(self, worker):
        self._workers = [candidate for candidate in self._workers if candidate is not worker]

    def _ensure_worker_count_locked(self):
        while len(self._workers) < self._desired_count:
            self._spawn_worker_locked()

    def configure(self, worker_count):
        with self._lock:
            self._desired_count = max(1, int(worker_count))
            self._ensure_worker_count_locked()
            while len(self._workers) > self._desired_count:
                try:
                    worker = self._idle.get_nowait()
                except queue.Empty:
                    break
                worker.retire_when_idle = True
                worker.terminate()
                self._remove_worker_locked(worker)

    def acquire(self):
        return self._idle.get()

    def release(self, worker):
        replacement_needed = False
        with self._lock:
            self._requests_served += 1
            if not worker.is_alive() or worker.should_recycle():
                worker.terminate()
                self._remove_worker_locked(worker)
                replacement_needed = len(self._workers) < self._desired_count
            else:
                self._idle.put(worker)

            if replacement_needed:
                self._spawn_worker_locked()

    def discard(self, worker):
        with self._lock:
            worker.terminate()
            self._remove_worker_locked(worker)
            self._ensure_worker_count_locked()

    def shutdown(self):
        with self._lock:
            workers = list(self._workers)
            self._workers = []
        for worker in workers:
            worker.terminate()

    def health(self):
        with self._lock:
            worker_count = len(self._workers)
            busy_count = max(0, worker_count - self._idle.qsize())
            return {
                "ok": True,
                "workerCount": worker_count,
                "busyCount": busy_count,
                "desiredWorkerCount": self._desired_count,
                "requestsServed": self._requests_served,
            }


worker_pool = WorkerPool(CONFIG.get("workerCount", 1))


class Handler(BaseHTTPRequestHandler):
    server_version = "k8v-python-service/1.0"

    def do_GET(self):
        if self.path != "/health":
            self._send_json(404, {"error": "Not found"})
            return
        self._send_json(200, worker_pool.health())

    def do_POST(self):
        if self.path == "/configure":
            payload = self._read_json()
            worker_count = payload.get("workerCount", 1)
            worker_pool.configure(worker_count)
            self._send_json(200, worker_pool.health())
            return

        if self.path != "/execute":
            self._send_json(404, {"error": "Not found"})
            return

        payload = self._read_json()
        worker = worker_pool.acquire()
        try:
            result = worker.execute(
                payload.get("code", ""),
                payload.get("inputs", {}),
                int(payload.get("timeoutMs", 30000)),
            )
            worker_pool.release(worker)
            self._send_json(200, result)
        except WorkerTimeoutError as error:
            worker_pool.discard(worker)
            self._send_json(504, {"error": str(error)})
        except Exception as error:
            worker_pool.discard(worker)
            self._send_json(500, {"error": str(error)})

    def log_message(self, _format, *_args):
        return

    def _read_json(self):
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length) if length > 0 else b"{}"
        try:
            return json.loads(raw.decode("utf-8"))
        except Exception:
            return {}

    def _send_json(self, status_code, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


class ThreadingUnixHTTPServer(socketserver.ThreadingMixIn, socketserver.UnixStreamServer):
    daemon_threads = True
    allow_reuse_address = True


def build_server():
    socket_path = CONFIG.get("socketPath")
    if socket_path:
        try:
            os.unlink(socket_path)
        except FileNotFoundError:
            pass
        return ThreadingUnixHTTPServer(socket_path, Handler)

    host = CONFIG.get("host", "127.0.0.1")
    port = int(CONFIG.get("port", 0))
    return ThreadingHTTPServer((host, port), Handler)


server = build_server()
try:
    server.serve_forever()
finally:
    worker_pool.shutdown()
    server.server_close()
`;

interface PythonServiceLocation {
  socketPath?: string;
  host?: string;
  port?: number;
}

export interface PythonExecutionManagerOptions {
  idleTtlMs?: number;
  startupTimeoutMs?: number;
  maxRequestsPerWorker?: number;
  requestPaddingMs?: number;
}

interface ManagedPythonExecutionRequest {
  code: string;
  inputs: Record<string, unknown>;
  timeoutMs: number;
  pythonBin: string;
  cwd?: string;
  graphId?: string;
  workerConcurrencyHint?: number;
}

export class PythonExecutionTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PythonExecutionTimeoutError';
  }
}

class PythonServiceUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PythonServiceUnavailableError';
  }
}

class PythonServiceTransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PythonServiceTransportError';
  }
}

class PythonServiceRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PythonServiceRequestError';
  }
}

export class PythonExecutionManager {
  private readonly services = new Map<string, PythonServiceHandle>();
  private readonly idleTtlMs: number;
  private readonly startupTimeoutMs: number;
  private readonly maxRequestsPerWorker: number;
  private readonly requestPaddingMs: number;
  private disposed = false;

  constructor(options: PythonExecutionManagerOptions = {}) {
    this.idleTtlMs = Math.max(1_000, Math.floor(options.idleTtlMs ?? DEFAULT_IDLE_TTL_MS));
    this.startupTimeoutMs = Math.max(
      1_000,
      Math.floor(options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS)
    );
    this.maxRequestsPerWorker = Math.max(
      1,
      Math.floor(options.maxRequestsPerWorker ?? DEFAULT_MAX_REQUESTS_PER_WORKER)
    );
    this.requestPaddingMs = Math.max(
      250,
      Math.floor(options.requestPaddingMs ?? DEFAULT_REQUEST_PADDING_MS)
    );
  }

  async execute(request: ManagedPythonExecutionRequest): Promise<ExecutionResult> {
    if (this.disposed) {
      throw new Error('PythonExecutionManager is disposed');
    }

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const service = await this.getOrCreateService(request);
      try {
        await service.configure(resolveWorkerConcurrencyHint(request.workerConcurrencyHint));
        return await service.execute(request);
      } catch (error) {
        if (error instanceof PythonServiceUnavailableError && attempt === 1) {
          await this.dropService(service.scopeKey, service);
          continue;
        }
        throw error;
      }
    }

    throw new Error('Python execution service was unavailable');
  }

  async dropGraph(graphId: string): Promise<void> {
    const matchingServices = [...this.services.values()].filter(
      (service) => service.graphId === graphId
    );
    await Promise.allSettled(
      matchingServices.map(async (service) => {
        await this.dropService(service.scopeKey, service);
      })
    );
  }

  async dispose(): Promise<void> {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    const services = [...this.services.values()];
    this.services.clear();
    await Promise.allSettled(services.map(async (service) => service.dispose()));
  }

  getActiveServiceCount(): number {
    return this.services.size;
  }

  private async getOrCreateService(
    request: ManagedPythonExecutionRequest
  ): Promise<PythonServiceHandle> {
    const scopeKey = makeScopeKey(request);
    const existingService = this.services.get(scopeKey);
    if (existingService) {
      await existingService.ensureStarted();
      return existingService;
    }

    const service = new PythonServiceHandle({
      scopeKey,
      graphId: request.graphId,
      pythonBin: request.pythonBin,
      cwd: request.cwd,
      workerCount: resolveWorkerConcurrencyHint(request.workerConcurrencyHint),
      idleTtlMs: this.idleTtlMs,
      startupTimeoutMs: this.startupTimeoutMs,
      maxRequestsPerWorker: this.maxRequestsPerWorker,
      requestPaddingMs: this.requestPaddingMs,
      onDispose: () => {
        if (this.services.get(scopeKey) === service) {
          this.services.delete(scopeKey);
        }
      },
    });
    this.services.set(scopeKey, service);

    try {
      await service.ensureStarted();
      return service;
    } catch (error) {
      await this.dropService(scopeKey, service);
      throw error;
    }
  }

  private async dropService(scopeKey: string, service: PythonServiceHandle): Promise<void> {
    if (this.services.get(scopeKey) === service) {
      this.services.delete(scopeKey);
    }
    await service.dispose();
  }
}

class PythonServiceHandle {
  readonly scopeKey: string;
  readonly graphId?: string;

  private readonly pythonBin: string;
  private readonly cwd?: string;
  private readonly idleTtlMs: number;
  private readonly startupTimeoutMs: number;
  private readonly maxRequestsPerWorker: number;
  private readonly requestPaddingMs: number;
  private readonly onDispose: () => void;

  private child: ChildProcessByStdio<null, null, Readable> | null = null;
  private location: PythonServiceLocation | null = null;
  private serviceDir: string | null = null;
  private startupPromise: Promise<void> | null = null;
  private idleTimer: NodeJS.Timeout | null = null;
  private disposed = false;
  private inFlightCount = 0;
  private lastUsedAt = Date.now();
  private desiredWorkerCount: number;
  private stderrTail = '';

  constructor(params: {
    scopeKey: string;
    graphId?: string;
    pythonBin: string;
    cwd?: string;
    workerCount: number;
    idleTtlMs: number;
    startupTimeoutMs: number;
    maxRequestsPerWorker: number;
    requestPaddingMs: number;
    onDispose: () => void;
  }) {
    this.scopeKey = params.scopeKey;
    this.graphId = params.graphId;
    this.pythonBin = params.pythonBin;
    this.cwd = params.cwd;
    this.idleTtlMs = params.idleTtlMs;
    this.startupTimeoutMs = params.startupTimeoutMs;
    this.maxRequestsPerWorker = params.maxRequestsPerWorker;
    this.requestPaddingMs = params.requestPaddingMs;
    this.onDispose = params.onDispose;
    this.desiredWorkerCount = params.workerCount;
  }

  async ensureStarted(): Promise<void> {
    if (this.disposed) {
      throw new PythonServiceUnavailableError('Python service is disposed');
    }

    if (!this.startupPromise) {
      this.startupPromise = this.start();
    }

    await this.startupPromise;
  }

  async configure(workerCount: number): Promise<void> {
    if (workerCount === this.desiredWorkerCount) {
      return;
    }

    await this.ensureStarted();
    this.desiredWorkerCount = workerCount;

    try {
      await this.requestJson('POST', '/configure', { workerCount }, this.startupTimeoutMs);
    } catch (error) {
      if (error instanceof PythonServiceTransportError) {
        await this.dispose();
        throw new PythonServiceUnavailableError(error.message);
      }
      throw error;
    }
  }

  async execute(request: ManagedPythonExecutionRequest): Promise<ExecutionResult> {
    await this.ensureStarted();
    this.lastUsedAt = Date.now();
    this.clearIdleTimer();
    this.inFlightCount += 1;

    try {
      const response = await this.requestJson(
        'POST',
        '/execute',
        {
          code: request.code,
          inputs: request.inputs,
          timeoutMs: request.timeoutMs,
        },
        request.timeoutMs + this.requestPaddingMs
      );

      if (response.statusCode === 200) {
        return response.payload as unknown as ExecutionResult;
      }
      if (response.statusCode === 504) {
        throw new PythonExecutionTimeoutError(
          typeof response.payload?.error === 'string'
            ? response.payload.error
            : 'Script execution timed out'
        );
      }

      throw new PythonServiceRequestError(
        typeof response.payload?.error === 'string'
          ? response.payload.error
          : `Python service returned status ${response.statusCode}`
      );
    } catch (error) {
      if (error instanceof PythonServiceTransportError) {
        await this.dispose();
        throw new PythonServiceUnavailableError(error.message);
      }
      throw error;
    } finally {
      this.inFlightCount = Math.max(0, this.inFlightCount - 1);
      this.lastUsedAt = Date.now();
      this.scheduleIdleTimer();
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.clearIdleTimer();
    this.onDispose();

    if (this.child && this.child.exitCode === null && this.child.signalCode === null) {
      this.child.kill('SIGKILL');
      await onceProcessExit(this.child).catch(() => undefined);
    }

    this.child = null;
    this.location = null;

    if (this.serviceDir) {
      await fs.rm(this.serviceDir, { recursive: true, force: true }).catch(() => undefined);
      this.serviceDir = null;
    }
  }

  private async start(): Promise<void> {
    const serviceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'k8vpy-'));
    this.serviceDir = serviceDir;
    this.location =
      process.platform === 'win32'
        ? {
            host: '127.0.0.1',
            port: await allocateTcpPort(),
          }
        : {
            socketPath: path.join(serviceDir, 'svc.sock'),
          };

    const configPayload = JSON.stringify({
      ...this.location,
      workerCount: this.desiredWorkerCount,
      maxRequestsPerWorker: this.maxRequestsPerWorker,
    });
    const child = spawn(this.pythonBin, ['-u', '-c', PYTHON_SERVICE_SCRIPT], {
      cwd: this.cwd,
      stdio: ['ignore', 'ignore', 'pipe'],
      env: {
        ...process.env,
        K8V_PYTHON_SERVICE_CONFIG: configPayload,
        K8V_PYTHON_WORKER_SCRIPT: PYTHON_WORKER_SCRIPT,
        K8V_SERVICE_CWD: this.cwd ?? '',
      },
    });
    this.child = child;

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      this.stderrTail = `${this.stderrTail}${chunk}`.slice(-8000);
    });

    child.on('exit', () => {
      if (!this.disposed) {
        this.onDispose();
      }
    });

    try {
      await this.waitForHealthy();
      this.scheduleIdleTimer();
    } catch (error) {
      await this.dispose();
      throw error;
    }
  }

  private async waitForHealthy(): Promise<void> {
    const deadline = Date.now() + this.startupTimeoutMs;
    while (Date.now() < deadline) {
      if (!this.child) {
        throw new PythonServiceUnavailableError('Python service failed to start');
      }
      if (this.child.exitCode !== null || this.child.signalCode !== null) {
        throw new PythonServiceUnavailableError(
          this.buildProcessExitMessage('Python service exited during startup')
        );
      }
      try {
        const response = await this.requestJson('GET', '/health', undefined, 500);
        if (response.statusCode === 200) {
          return;
        }
      } catch (error) {
        if (!(error instanceof PythonServiceTransportError)) {
          throw error;
        }
      }
      await delay(50);
    }

    throw new PythonServiceUnavailableError(
      this.buildProcessExitMessage('Python service failed to become healthy')
    );
  }

  private buildRequestOptions(
    method: string,
    requestPath: string,
    body?: string
  ): http.RequestOptions {
    if (!this.location) {
      throw new PythonServiceTransportError('Python service location is not ready');
    }

    const headers: Record<string, string> = {};
    if (body !== undefined) {
      headers['content-type'] = 'application/json';
      headers['content-length'] = String(Buffer.byteLength(body));
    }

    if (this.location.socketPath) {
      return {
        method,
        path: requestPath,
        socketPath: this.location.socketPath,
        headers,
      };
    }

    return {
      method,
      path: requestPath,
      host: this.location.host,
      port: this.location.port,
      headers,
    };
  }

  private async requestJson(
    method: string,
    requestPath: string,
    payload: unknown,
    timeoutMs: number
  ): Promise<{ statusCode: number; payload: Record<string, unknown> }> {
    if (!this.child) {
      throw new PythonServiceTransportError('Python service process is not running');
    }

    const body = payload === undefined ? undefined : JSON.stringify(payload);
    const options = this.buildRequestOptions(method, requestPath, body);

    return await new Promise((resolve, reject) => {
      const req = http.request(options, (res) => {
        let responseText = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          responseText += chunk;
        });
        res.on('end', () => {
          if (this.child && (this.child.exitCode !== null || this.child.signalCode !== null)) {
            reject(
              new PythonServiceTransportError(
                this.buildProcessExitMessage('Python service exited before responding')
              )
            );
            return;
          }

          try {
            const parsed = responseText.trim()
              ? JSON.parse(responseText)
              : {};
            resolve({
              statusCode: res.statusCode ?? 500,
              payload:
                parsed && typeof parsed === 'object'
                  ? (parsed as Record<string, unknown>)
                  : {},
            });
          } catch (error) {
            reject(
              new PythonServiceTransportError(
                `Python service returned invalid JSON: ${
                  error instanceof Error ? error.message : String(error)
                }`
              )
            );
          }
        });
      });

      req.on('error', (error) => {
        reject(
          new PythonServiceTransportError(
            error instanceof Error ? error.message : String(error)
          )
        );
      });

      req.setTimeout(timeoutMs, () => {
        req.destroy(
          new Error(`Python service request timed out after ${timeoutMs}ms`)
        );
      });

      if (body !== undefined) {
        req.write(body);
      }
      req.end();
    });
  }

  private buildProcessExitMessage(prefix: string): string {
    const status = this.child
      ? `code=${this.child.exitCode} signal=${this.child.signalCode}`
      : 'not running';
    const stderr = this.stderrTail.trim();
    return `${prefix} (${status})${stderr ? `\n${stderr}` : ''}`;
  }

  private scheduleIdleTimer(): void {
    if (this.disposed || this.inFlightCount > 0) {
      return;
    }

    this.clearIdleTimer();
    this.idleTimer = setTimeout(() => {
      if (this.disposed || this.inFlightCount > 0) {
        return;
      }
      if (Date.now() - this.lastUsedAt < this.idleTtlMs) {
        this.scheduleIdleTimer();
        return;
      }
      void this.dispose();
    }, this.idleTtlMs);
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }
}

function makeScopeKey(request: ManagedPythonExecutionRequest): string {
  return JSON.stringify({
    graphId: request.graphId ?? null,
    pythonBin: request.pythonBin,
    cwd: request.cwd ?? null,
  });
}

function resolveWorkerConcurrencyHint(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 1;
  }
  return Math.max(1, Math.floor(value));
}

async function allocateTcpPort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Failed to allocate TCP port')));
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

async function onceProcessExit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  await new Promise<void>((resolve) => {
    child.once('exit', () => resolve());
  });
}

async function delay(ms: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}
