import { defineConfig } from 'vite';

/** The main process: Electron's Node side, which owns the window and talks to Claude Code. */
export default defineConfig({
  build: {
    ssr: 'src/main/index.ts',
    outDir: 'out/main',
    target: 'node22',
    sourcemap: true,
    rolldownOptions: { output: { format: 'es', entryFileNames: 'index.js' } },
  },
  // The workspace packages are TypeScript source, so they're bundled in rather than imported.
  ssr: { noExternal: [/^@factwright\//] },
});
