import { defineConfig } from 'vite';

export default defineConfig({
  base: process.env.VITE_BASE ?? '/jump-game/',
  worker: { format: 'es' },
  build: { target: 'es2022', chunkSizeWarningLimit: 4000 },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
} as any);
