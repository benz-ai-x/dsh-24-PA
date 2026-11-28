import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.mjs', 'tests/e2e/**/*.e2e.mjs'],
    testTimeout: 300_000,
    hookTimeout: 300_000,
    pool: 'forks',
    // The CLI gateway starts processes only through a subprocess service (#310): name a stand-in for every test file.
    setupFiles: ['tests/helpers/install-subprocess.mjs'],
    fileParallelism: false,
  },
});
