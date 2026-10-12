import { defineConfig } from 'vitest/config';

// Each test file runs the real Worker locally, in workerd, which takes a moment to start.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
