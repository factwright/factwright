import { defineConfig } from '@playwright/test';

// GitHub's Windows runners are slower than its others, and some runs take twice as long as the
// next, so the app gets longer there to finish a step, such as building a cover letter's PDF.
const SLOW = process.platform === 'win32' ? 3 : 1;

/** End-to-end tests of the built app. Run `pnpm build` first. */
export default defineConfig({
  testDir: '.',
  testMatch: '**/*.e2e.ts',
  // The installed app's own tests run on their own, after the installers are built.
  testIgnore: '**/packaged.e2e.ts',
  // Each test opens its own window of the app, one at a time.
  workers: 1,
  timeout: 60_000 * SLOW,
  expect: { timeout: 10_000 * SLOW },
  reporter: [['list']],
});
