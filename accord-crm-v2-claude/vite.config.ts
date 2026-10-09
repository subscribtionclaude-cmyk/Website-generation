import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/',
  plugins: [react()],
  build: { outDir: 'dist', sourcemap: false, target: 'es2020', chunkSizeWarningLimit: 900 },
  test: { include: ['tests/unit/**/*.test.ts'], environment: 'node' },
});
