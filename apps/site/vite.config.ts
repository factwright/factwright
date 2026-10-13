import { defineConfig, type Plugin } from 'vite';
import { siteThemeCss } from './scripts/theme.ts';

/** The design system's colors, type and spacing, as a stylesheet the page imports. */
const THEME = 'virtual:theme.css';

function theme(): Plugin {
  return {
    name: 'factwright-theme',
    resolveId: (id) => (id === THEME ? `\0${THEME}` : undefined),
    load: (id) => (id === `\0${THEME}` ? siteThemeCss() : undefined),
  };
}

/**
 * factwright.com: a static page, its download pages and its "not found" page, built on the app's
 * design system.
 */
export default defineConfig({
  plugins: [theme()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // One small script, loaded by every page, so there's nothing to preload.
    modulePreload: { polyfill: false },
    rolldownOptions: {
      input: {
        index: 'index.html',
        download: 'download.html',
        downloadMac: 'download/mac.html',
        downloadWindows: 'download/windows.html',
        notFound: '404.html',
      },
    },
  },
});
