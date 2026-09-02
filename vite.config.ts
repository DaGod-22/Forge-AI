import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: false,
    allowedHosts: true,
    watch: { ignored: ['**/workspace/**', '**/.forge/**', '**/dist/**'] }
  },
  preview: {
    host: '0.0.0.0',
    allowedHosts: true
  },
  build: {
    outDir: 'dist/client',
    sourcemap: true
  },
  test: {
    exclude: ['node_modules/**', 'dist/**', 'workspace/**', '.forge/**']
  }
});
