import { themeCss } from '@factwright/ui/theme';
import { defineConfig, type Plugin } from 'vite';

/** The design system's colors, type and spacing, as a stylesheet the popup imports. */
const THEME = 'virtual:theme.css';

function theme(): Plugin {
  return {
    name: 'factwright-theme',
    resolveId: (id) => (id === THEME ? `\0${THEME}` : undefined),
    load: (id) => (id === `\0${THEME}` ? themeCss() : undefined),
  };
}

/**
 * The extension's pages and its background, built once for both browsers. scripts/build.ts adds
 * each browser's manifest. Everything is a file of the extension's own: the browsers' rules for
 * extensions allow no inline scripts, and nothing is loaded from anywhere else.
 */
export default defineConfig({
  plugins: [theme()],
  base: '',
  build: {
    outDir: 'dist/build',
    emptyOutDir: true,
    modulePreload: { polyfill: false },
    // Unminified: the page reader is sent into pages as one function, so nothing of it may move
    // outside it, and the stores' reviewers read the code as it's built.
    minify: false,
    // Browsers that run Manifest V3 extensions, as far back as each manifest allows.
    target: ['chrome127', 'firefox140'],
    rolldownOptions: {
      input: {
        popup: 'popup.html',
        setup: 'setup.html',
        sidepanel: 'sidepanel.html',
        background: 'src/background.ts',
      },
      output: {
        entryFileNames: (chunk) =>
          chunk.name === 'background' ? 'background.js' : 'assets/[name]-[hash].js',
      },
    },
  },
});
