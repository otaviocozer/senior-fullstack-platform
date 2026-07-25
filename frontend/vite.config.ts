import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite dev server config. The `/api` prefix is proxied to the backend so the
// frontend can call same-origin relative URLs (VITE_API_BASE defaults to `/api`).
// The `/ws` prefix is proxied with websocket upgrade support.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': {
        target: 'http://api:8000',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://api:8000',
        ws: true,
        changeOrigin: true,
      },
    },
  },
});
