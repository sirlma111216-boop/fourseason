import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 개발 중에는 Vite(5173)가 화면을, wrangler dev(8787)가 방 서버를 맡는다.
// /api 와 /ws 요청은 8787로 넘긴다.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 800,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:8787', changeOrigin: false },
      '/ws': { target: 'ws://127.0.0.1:8787', ws: true },
    },
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    testTimeout: 60000,
  },
} as never);
