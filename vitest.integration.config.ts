import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') },
  },
  test: {
    environment: 'node',
    globals: true,
    globalSetup: ['./tests/integration/setup/global-setup.ts'],
    setupFiles: ['./vitest.setup.ts'],
    include: ['tests/integration/**/*.integration.test.ts'],
    testTimeout: 30000,
  },
});
