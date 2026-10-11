import { defineConfig } from 'vite';

/** The window's screens: a React app built from the design system. */
export default defineConfig({
  root: 'src/renderer',
  base: './',
  build: {
    outDir: '../../out/renderer',
    emptyOutDir: true,
    rolldownOptions: {
      // lucide-react marks its files "use client", which only matters for server rendering.
      onwarn(warning, warn) {
        if (warning.code !== 'MODULE_LEVEL_DIRECTIVE') warn(warning);
      },
    },
  },
});
