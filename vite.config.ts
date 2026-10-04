import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

export default defineConfig(({ command, mode }) => {
  // The sheet's ID isn't committed: it comes from .env locally and from the SHEET_ID secret in CI.
  if (command === 'build' && !loadEnv(mode, process.cwd()).VITE_SHEET_ID && !process.env.VITE_SHEET_ID)
    throw new Error('VITE_SHEET_ID is not set (see README → Sheet ID).');
  return {
    // Relative asset paths so the build can be hosted under any sub-path (e.g. GitHub Pages).
    base: './',
    test: { environment: 'node' },
  };
});
