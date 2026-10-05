import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.mjs', 'tests/e2e/**/*.e2e.mjs'],
    testTimeout: 300_000,
    hookTimeout: 300_000,
    pool: 'forks',
    fileParallelism: false,
  },
});
