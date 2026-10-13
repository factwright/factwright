import { defineConfig } from '@playwright/test';
import config from './playwright.config.ts';

/** The installed app's own tests. Run `pnpm dist:mac` or `pnpm dist:win` first. */
export default defineConfig({
  ...config,
  testMatch: '**/packaged.e2e.ts',
  testIgnore: [],
});
