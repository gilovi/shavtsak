import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative asset paths so the build can be hosted under any sub-path (e.g. GitHub Pages).
  base: './',
  test: { environment: 'node' },
});
