import { defineConfig, type UserConfig } from 'vite';
import react from '@vitejs/plugin-react';

type Environment = Record<string, string | undefined>;

export const DEFAULT_BACKEND_PROXY_TARGET = 'http://localhost:3000';

function readConfiguredValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function resolveBackendProxyTarget(env: Environment = process.env): string {
  return readConfiguredValue(env.K8V_BACKEND_URL) ?? DEFAULT_BACKEND_PROXY_TARGET;
}

export function createViteConfig(env: Environment = process.env): UserConfig {
  return {
    plugins: [react()],
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) {
              return undefined;
            }

            if (id.includes('/@pixi/') || id.includes('/pixi.js/')) {
              return 'vendor-pixi';
            }

            if (
              id.includes('/react-markdown/') ||
              id.includes('/remark-gfm/') ||
              id.includes('/remark-math/') ||
              id.includes('/rehype-katex/') ||
              id.includes('/katex/')
            ) {
              return 'vendor-markdown';
            }

            if (id.includes('/reactflow/')) {
              return 'vendor-reactflow';
            }

            return undefined;
          },
        },
      },
    },
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: resolveBackendProxyTarget(env),
          changeOrigin: true,
        },
      },
    },
  };
}

export default defineConfig(createViteConfig());
