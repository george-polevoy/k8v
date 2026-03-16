import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
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
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
