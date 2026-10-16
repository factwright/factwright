import { defineConfig } from 'vitest/config';

// The save's tests run the real sync server, in workerd, which takes a moment to start.
export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
