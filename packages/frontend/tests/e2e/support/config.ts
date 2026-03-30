function parseDuration(value: string | undefined, fallbackMs: number): number {
  if (!value) {
    return fallbackMs;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackMs;
}

type Environment = Record<string, string | undefined>;

function readConfiguredUrl(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : fallback;
}

export const DEFAULT_E2E_BACKEND_PORT = '3300';
export const DEFAULT_E2E_FRONTEND_PORT = '5273';
export const DEFAULT_E2E_BACKEND_URL = `http://127.0.0.1:${DEFAULT_E2E_BACKEND_PORT}`;
export const DEFAULT_E2E_FRONTEND_URL = `http://127.0.0.1:${DEFAULT_E2E_FRONTEND_PORT}`;

export interface E2EConfig {
  backendUrl: string;
  frontendUrl: string;
  startTimeoutMs: number;
  assertTimeoutMs: number;
}

export function resolveE2EConfig(env: Environment = process.env): E2EConfig {
  return {
    backendUrl: readConfiguredUrl(env.K8V_E2E_BACKEND_URL, DEFAULT_E2E_BACKEND_URL),
    frontendUrl: readConfiguredUrl(env.K8V_E2E_FRONTEND_URL, DEFAULT_E2E_FRONTEND_URL),
    startTimeoutMs: parseDuration(env.K8V_E2E_START_TIMEOUT_MS, 60_000),
    assertTimeoutMs: parseDuration(env.K8V_E2E_ASSERT_TIMEOUT_MS, 12_000),
  };
}

const E2E_CONFIG = resolveE2EConfig();

export const E2E_BACKEND_URL = E2E_CONFIG.backendUrl;
export const E2E_FRONTEND_URL = E2E_CONFIG.frontendUrl;
export const E2E_START_TIMEOUT_MS = E2E_CONFIG.startTimeoutMs;
export const E2E_ASSERT_TIMEOUT_MS = E2E_CONFIG.assertTimeoutMs;
