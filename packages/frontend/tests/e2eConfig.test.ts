import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_E2E_BACKEND_URL,
  DEFAULT_E2E_FRONTEND_URL,
  resolveE2EConfig,
} from './e2e/support/config.ts';
import { DEFAULT_BACKEND_PROXY_TARGET, resolveBackendProxyTarget } from '../vite.config.ts';

test('resolveE2EConfig defaults to dedicated local backend/frontend URLs for browser tests', () => {
  const config = resolveE2EConfig({});

  assert.equal(config.backendUrl, DEFAULT_E2E_BACKEND_URL);
  assert.equal(config.frontendUrl, DEFAULT_E2E_FRONTEND_URL);
  assert.match(config.backendUrl, /:3300$/);
  assert.match(config.frontendUrl, /:5273$/);
});

test('resolveE2EConfig honors explicit environment overrides', () => {
  const config = resolveE2EConfig({
    K8V_E2E_BACKEND_URL: 'http://127.0.0.1:9300',
    K8V_E2E_FRONTEND_URL: 'http://127.0.0.1:9301',
    K8V_E2E_START_TIMEOUT_MS: '9100',
    K8V_E2E_ASSERT_TIMEOUT_MS: '4200',
  });

  assert.equal(config.backendUrl, 'http://127.0.0.1:9300');
  assert.equal(config.frontendUrl, 'http://127.0.0.1:9301');
  assert.equal(config.startTimeoutMs, 9100);
  assert.equal(config.assertTimeoutMs, 4200);
});

test('resolveBackendProxyTarget follows K8V_BACKEND_URL for managed frontend test servers', () => {
  assert.equal(
    resolveBackendProxyTarget({ K8V_BACKEND_URL: 'http://127.0.0.1:9300' }),
    'http://127.0.0.1:9300'
  );
  assert.equal(resolveBackendProxyTarget({ K8V_BACKEND_URL: '   ' }), DEFAULT_BACKEND_PROXY_TARGET);
});
