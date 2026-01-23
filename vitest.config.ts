import {defineConfig} from 'vitest/config'

export default defineConfig({
  test: {
    experimental: {
      viteModuleRunner: false,
    },
    environment: 'node',
    include: ['**/__tests__/**/*.test.ts'],
    includeSource: ['src/**/*.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov', 'cobertura'],
      reportsDirectory: './coverage'
    },
    globals: true,
    setupFiles: ['./__tests__/setup.ts']
  }
})
