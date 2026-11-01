import { defineConfig } from 'vite';
export default defineConfig({
  base: '/mirc-rfo/',
  build: { outDir: 'dist', emptyOutDir: true, sourcemap: false, chunkSizeWarningLimit: 2000, target: 'es2020' },
  server: { host: '127.0.0.1' },
  preview: { host: '127.0.0.1' },
});
