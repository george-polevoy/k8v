function parseDuration(value: string | undefined, fallbackMs: number): number {
  if (!value) {
    return fallbackMs;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackMs;
}

export const E2E_BACKEND_URL = process.env.K8V_E2E_BACKEND_URL ?? 'http://localhost:3000';
export const E2E_FRONTEND_URL = process.env.K8V_E2E_FRONTEND_URL ?? 'http://localhost:5173';
export const E2E_START_TIMEOUT_MS = parseDuration(process.env.K8V_E2E_START_TIMEOUT_MS, 60_000);
export const E2E_ASSERT_TIMEOUT_MS = parseDuration(process.env.K8V_E2E_ASSERT_TIMEOUT_MS, 12_000);
