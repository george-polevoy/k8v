import process from 'node:process';

const DEFAULT_BACKEND_URL = process.env.K8V_BACKEND_URL ?? 'http://127.0.0.1:3000';
const DEFAULT_FRONTEND_URL = process.env.K8V_FRONTEND_URL ?? 'http://127.0.0.1:5173';

export function textResult(payload: unknown) {
  return {
    content: [
      {
        type: 'text' as const,
        text: typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2),
      },
    ],
  };
}

function sanitizeBaseUrl(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

export async function requestJson<T>(
  baseUrl: string,
  endpoint: string,
  init?: RequestInit
): Promise<T> {
  const normalizedBaseUrl = sanitizeBaseUrl(baseUrl);
  const response = await fetch(`${normalizedBaseUrl}${endpoint}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });

  const raw = await response.text();
  let parsed: unknown = {};
  if (raw) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = { raw };
    }
  }

  if (!response.ok) {
    const message =
      typeof (parsed as { error?: unknown }).error === 'string'
        ? (parsed as { error: string }).error
        : `Request failed (${response.status} ${response.statusText})`;
    throw new Error(message);
  }

  return parsed as T;
}

export async function requestBinary(
  baseUrl: string,
  endpoint: string,
  init?: RequestInit
): Promise<{ buffer: Buffer; headers: Headers }> {
  const normalizedBaseUrl = sanitizeBaseUrl(baseUrl);
  const response = await fetch(`${normalizedBaseUrl}${endpoint}`, init);

  if (!response.ok) {
    const raw = await response.text();
    let errorMessage = `Request failed (${response.status} ${response.statusText})`;
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as { error?: unknown };
        if (typeof parsed.error === 'string' && parsed.error.trim()) {
          errorMessage = parsed.error;
        }
      } catch {
        // Keep default error message.
      }
    }
    throw new Error(errorMessage);
  }

  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    headers: response.headers,
  };
}

export function resolveBackendUrl(explicitUrl?: string): string {
  return sanitizeBaseUrl(explicitUrl ?? DEFAULT_BACKEND_URL);
}

export function resolveFrontendUrl(explicitUrl?: string): string {
  return sanitizeBaseUrl(explicitUrl ?? DEFAULT_FRONTEND_URL);
}
