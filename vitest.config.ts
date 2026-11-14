import { defineConfig } from 'vitest/config';

// Config séparée de vite.config.ts (dont la racine est web/) pour que les tests couvrent tout le projet.
export default defineConfig({
  test: {
    include: ['server/**/*.test.ts', 'shared/**/*.test.ts', 'web/src/**/*.test.ts', 'extension/src/**/*.test.ts', 'scripts/**/*.test.ts'],
  },
});
