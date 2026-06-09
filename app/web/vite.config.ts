import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base:'./' so the FastAPI StaticFiles mount at "/" serves the built assets
// with relative URLs (works regardless of the deployed path prefix).
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
});
