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
    // La bibliothèque de reconnaissance faciale (≈ 1,5 Mo), chargée à part au premier usage sur la tablette.
    chunkSizeWarningLimit: 1600,
    // Deux pages : le front (index.html) et la séance de sport sur la télé (tele-sport.html, WebView de HomeHub TV).
    rollupOptions: {
      input: { main: 'web/index.html', teleSport: 'web/tele-sport.html' },
    },
  },
  server: {
    host: true,
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
});
