import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    globals: true,
    // With no `exclude` set, vitest's default only excludes node_modules/
    // dist/.git/etc — it was also picking up mobile/'s Jest test suite
    // (jest.useFakeTimers() etc, fails outright under vitest), backend/limit's
    // own ts-node-based tests (its package.json runs them via
    // `ts-node tests/runner.ts`, not vitest), backend/'s Rust workspace, and
    // load-tests/'s k6 scripts (which aren't test-framework files at all —
    // they're run with `k6 run`). All of those have their own runners; only
    // this app's own test files should run under vitest.
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      'mobile/**',
      'backend/**',
      'load-tests/**',
      'infrastructure/**',
    ],
  },
});
