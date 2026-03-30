import { mergeConfig } from 'vite'
import { defineConfig } from 'vitest/config'
import baseConfig from './vitest.config'

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      include: ['**/__tests__/**/*.e2e.test.ts'],
      exclude: ['node_modules/**/*'],
      coverage: {
        provider: 'v8',
        reporter: ['text', 'json', 'html'],
        reportDirectory: './coverage/e2e',
      },
    },
  })
)
