import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the build also works from a GitHub Pages sub-path.
  base: './',
  server: { port: 5180, host: true },
  build: { target: 'esnext' },
});
