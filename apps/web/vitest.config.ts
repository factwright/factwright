import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['src/test-setup.ts'],
    // The vault's tests run the real sync server, in workerd, which takes a moment to start.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
