import { readFileSync } from 'node:fs';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

export default defineConfig({
  root: 'web',
  plugins: [svelte()],
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    host: true,
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
});
