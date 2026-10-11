import { defineConfig } from 'vite';

/** The preload script: the narrow bridge between the window and the main process. */
export default defineConfig({
  build: {
    ssr: 'src/preload/index.ts',
    outDir: 'out/preload',
    target: 'node22',
    sourcemap: true,
    // Sandboxed windows only run preload scripts as CommonJS.
    rolldownOptions: { output: { format: 'cjs', entryFileNames: 'index.cjs' } },
  },
  ssr: { noExternal: [/^@factwright\//] },
});
