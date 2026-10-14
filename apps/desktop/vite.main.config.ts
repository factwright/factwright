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
  // Everything is bundled in, the workspace's TypeScript included, except Electron itself and
  // node-pty, whose native code is loaded at run time.
  ssr: { noExternal: true, external: ['electron', 'node-pty'] },
  // Only Factwright's own releases are built with its sync server, as release.yml sets for them
  // alone. A copy built anywhere else has none, so it never syncs through Factwright's.
  define: { __SYNC_SERVER__: JSON.stringify(process.env.FACTWRIGHT_SYNC_SERVER ?? '') },
});
