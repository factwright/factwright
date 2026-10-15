import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // pdf.js asks for its older build in Node. Its current one reads text the same.
    onConsoleLog: (log) => !log.includes('legacy` build'),
  },
});
