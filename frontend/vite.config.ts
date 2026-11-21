import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { env } from 'node:process';

const apiProxy = {
  '/api': {
    target: env.API_PROXY_TARGET ?? 'http://localhost:4000',
    changeOrigin: true,
  },
};

export default defineConfig({
  plugins: [react],
  server: {
    port: 5173,
    proxy: apiProxy,
  },
  preview: {
    host: '0.0.0.0',
    port: 5173,
    proxy: apiProxy,
  },
});
