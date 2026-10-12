import { defineConfig } from 'vite';

/** The sync server, running locally with `pnpm --filter @factwright/server dev`. */
const SERVER = 'http://localhost:8787';

/**
 * The web view: a React app built from the design system, served by the sync server. In
 * development, its API requests go to the sync server running locally.
 */
export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rolldownOptions: {
      // lucide-react marks its files "use client", which only matters for server rendering.
      onwarn(warning, warn) {
        if (warning.code !== 'MODULE_LEVEL_DIRECTIVE') warn(warning);
      },
    },
  },
  server: {
    proxy: {
      // Sign-in only trusts requests from the server's own address, which these stand in for.
      '/api': { target: SERVER, headers: { origin: SERVER } },
    },
  },
});
