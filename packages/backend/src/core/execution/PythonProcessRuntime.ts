import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { ExecutionRequest, ExecutionResult, ExecutionRuntime } from './types.js';

const PYTHON_RUNNER_SCRIPT = `
import json
import base64
import io
import os
import builtins
import sys

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
        for k, v in value.items():
            wrapped[k] = to_attr(v)
        return wrapped
    if isinstance(value, list):
        return [to_attr(v) for v in value]
    return value

def to_plain(value):
    if isinstance(value, AttrDict):
        return {k: to_plain(v) for k, v in value.items()}
    if isinstance(value, dict):
        return {k: to_plain(v) for k, v in value.items()}
    if isinstance(value, list):
        return [to_plain(v) for v in value]
    return value

payload = json.loads(input())
inputs = to_attr(payload.get("inputs", {}))
outputs = AttrDict()
text_output_lines = []
graphics_outputs = []
text_output_buffer = ""

def append_text_chunk(chunk):
    global text_output_buffer
    if chunk is None:
        return
    normalized = str(chunk).replace("\\r\\n", "\\n").replace("\\r", "\\n")
    text_output_buffer += normalized
    while "\\n" in text_output_buffer:
        line, text_output_buffer = text_output_buffer.split("\\n", 1)
        text_output_lines.append(line)

def flush_text_buffer():
    global text_output_buffer
    if text_output_buffer:
        text_output_lines.append(text_output_buffer)
        text_output_buffer = ""

def log_fn(*args, **kwargs):
    sep = kwargs.get("sep", " ")
    end = kwargs.get("end", "\\n")
    target_file = kwargs.get("file")
    if target_file not in (None, sys.stdout, sys.stderr):
        original_builtin_print(*args, **kwargs)
        return
    append_text_chunk(sep.join(str(arg) for arg in args) + str(end))

PNG_SIGNATURE = b"\\x89PNG\\r\\n\\x1a\\n"

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

def output_graphics(data):
    graphics_outputs.append(normalize_graphics_output(data))

def output_png(data):
    graphics_outputs.append(normalize_graphics_output(data))

execution_globals = {
    "__builtins__": __builtins__,
    "inputs": inputs,
    "outputs": outputs,
    "print": log_fn,
    "log": log_fn,
    "outputGraphics": output_graphics,
    "outputImage": output_graphics,
    "outputPng": output_png,
    "outputPNG": output_png,
}

original_builtin_print = builtins.print

try:
    builtins.print = log_fn
    exec(payload.get("code", ""), execution_globals, execution_globals)
    flush_text_buffer()
    result = {
        "outputs": to_plain(outputs),
        "textOutput": "\\n".join(text_output_lines) if text_output_lines else None,
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

result_guid = os.environ.get("K8V_RESULT_GUID", "").strip()
if not result_guid:
    raise RuntimeError("Missing K8V_RESULT_GUID")
result_marker = f"<{result_guid}>"
print(result_marker + json.dumps(result) + result_marker)
`;

export class PythonProcessRuntime implements ExecutionRuntime {
  private readonly pythonBin: string;
  private readonly timeoutRetryCount: number;

  constructor(
    pythonBin: string = process.env.K8V_PYTHON_BIN || 'python3',
    timeoutRetryCount = 1
  ) {
    this.pythonBin = pythonBin;
    this.timeoutRetryCount = Math.max(0, Math.floor(timeoutRetryCount));
  }

  async execute(request: ExecutionRequest): Promise<ExecutionResult> {
    const timeoutMs = request.timeoutMs ?? 30_000;
    const pythonBin = request.pythonBin ?? this.pythonBin;
    const cwd = request.cwd;
    const payload = JSON.stringify({
      code: request.code,
      inputs: request.inputs ?? {},
    });
    try {
      const maxAttempts = this.timeoutRetryCount + 1;
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const resultGuid = randomUUID();
        const resultMarker = `<${resultGuid}>`;
        const { stdout, stderr, timedOut } = await this.runPython(
          payload,
          timeoutMs,
          pythonBin,
          cwd,
          resultGuid
        );

        if (timedOut) {
          if (attempt < maxAttempts) {
            continue;
          }
          const retrySuffix = maxAttempts > 1 ? ` after ${maxAttempts} attempts` : '';
          return {
            outputs: {},
            textOutput: `Error: Script execution timed out${retrySuffix}`,
          };
        }

        const jsonPayload = this.extractResultPayload(stdout, resultMarker);
        const trimmed = jsonPayload?.trim() ?? '';
        if (!trimmed) {
          return {
            outputs: {},
            textOutput: `Error: Python runtime produced no wrapped result payload${stderr ? `\n${stderr.trim()}` : ''}${stdout.trim() ? `\n${stdout.trim()}` : ''}`,
          };
        }

        let parsed: any;
        try {
          parsed = JSON.parse(trimmed);
        } catch {
          return {
            outputs: {},
            textOutput: `Error: Failed to parse python output as JSON${stderr ? `\n${stderr.trim()}` : ''}\n${trimmed}`,
          };
        }

        return {
          outputs: parsed.outputs && typeof parsed.outputs === 'object' ? parsed.outputs : {},
          textOutput: typeof parsed.textOutput === 'string' ? parsed.textOutput : undefined,
          graphicsOutput: typeof parsed.graphicsOutput === 'string' ? parsed.graphicsOutput : undefined,
        };
      }

      return {
        outputs: {},
        textOutput: 'Error: Python runtime did not produce a result',
      };
    } catch (error: any) {
      const errorMessage = error?.message ?? String(error);
      return {
        outputs: {},
        textOutput: `Error: ${errorMessage}`,
      };
    }
  }

  private runPython(
    payload: string,
    timeoutMs: number,
    pythonBin: string,
    cwd: string | undefined,
    resultGuid: string
  ): Promise<{ stdout: string; stderr: string; timedOut: boolean }> {
    return new Promise((resolve, reject) => {
      const child = spawn(
        pythonBin,
        ['-c', PYTHON_RUNNER_SCRIPT],
        {
          stdio: ['pipe', 'pipe', 'pipe'],
          env: {
            ...process.env,
            K8V_RESULT_GUID: resultGuid,
          },
          ...(cwd ? { cwd } : {}),
        }
      );

      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let settled = false;

      const timeoutHandle = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, timeoutMs);

      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        stdout += chunk;
      });
      child.stderr.on('data', (chunk: string) => {
        stderr += chunk;
      });

      child.on('error', (error) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeoutHandle);
        reject(error);
      });

      child.on('close', (code, signal) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeoutHandle);

        if (timedOut) {
          resolve({ stdout, stderr, timedOut: true });
          return;
        }

        if (signal) {
          resolve({
            stdout,
            stderr: `${stderr}${stderr ? '\n' : ''}Process terminated by signal: ${signal}`,
            timedOut: false,
          });
          return;
        }

        if (code !== 0 && !stdout.trim()) {
          resolve({
            stdout,
            stderr: `${stderr}${stderr ? '\n' : ''}Python exited with code ${code}`,
            timedOut: false,
          });
          return;
        }

        resolve({ stdout, stderr, timedOut: false });
      });

      child.stdin.write(payload);
      child.stdin.end();
    });
  }

  private extractResultPayload(
    stdout: string,
    resultMarker: string
  ): string | undefined {
    const startIndex = stdout.indexOf(resultMarker);
    if (startIndex === -1) {
      return undefined;
    }

    const payloadStart = startIndex + resultMarker.length;
    const endIndex = stdout.indexOf(resultMarker, payloadStart);
    if (endIndex === -1) {
      return undefined;
    }

    return stdout.slice(payloadStart, endIndex);
  }
}
