import { defineConfig } from '@playwright/test';

/** End-to-end tests of the built app. Run `pnpm build` first. */
export default defineConfig({
  testDir: '.',
  testMatch: '**/*.e2e.ts',
  // The installed app's own tests run on their own, after the installers are built.
  testIgnore: '**/packaged.e2e.ts',
  // Each test opens its own window of the app, one at a time.
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
});
