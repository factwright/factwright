import {
  DARK,
  FONTS,
  LIGHT,
  type Palette,
  RADII,
  SPACE,
  TEXT_SIZES,
  TONE_COLORS,
  TONES,
} from './tokens.ts';

/**
 * The CSS behind every component: the colors as variables for both themes, plus type, spacing,
 * radii and a few base styles. The page follows the system theme unless an element sets
 * data-theme="light" or "dark", which applies to everything inside it.
 */
export function themeCss(): string {
  return [
    `:root, [data-theme="light"] { ${colorVariables(LIGHT, 'light')} }`,
    `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { ${colorVariables(DARK, 'dark')} } }`,
    `[data-theme="dark"] { ${colorVariables(DARK, 'dark')} }`,
    `:root { ${scaleVariables()} }`,
    BASE_CSS,
  ].join('\n');
}

function colorVariables(palette: Palette, mode: 'light' | 'dark'): string {
  const colors = Object.entries(palette).map(([name, value]) => `--fw-${kebab(name)}: ${value};`);
  const tones = TONES.flatMap((tone) => {
    const { fg, bg } = TONE_COLORS[tone][mode];
    return [`--fw-tone-${tone}-fg: ${fg};`, `--fw-tone-${tone}-bg: ${bg};`];
  });
  return [`color-scheme: ${mode};`, ...colors, ...tones].join(' ');
}

function scaleVariables(): string {
  return [
    `--fw-font-sans: ${FONTS.sans};`,
    `--fw-font-mono: ${FONTS.mono};`,
    ...Object.entries(TEXT_SIZES).map(([name, value]) => `--fw-text-${name}: ${value};`),
    ...Object.entries(SPACE).map(([step, value]) => `--fw-space-${step}: ${value};`),
    ...Object.entries(RADII).map(([name, value]) => `--fw-radius-${name}: ${value};`),
  ].join(' ');
}

function kebab(name: string): string {
  return name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

const BASE_CSS = `
*, *::before, *::after { box-sizing: border-box; }
body, [data-theme] {
  background: var(--fw-bg);
  color: var(--fw-text);
}
body {
  margin: 0;
  font-family: var(--fw-font-sans);
  font-size: var(--fw-text-base);
  line-height: 1.45;
  -webkit-font-smoothing: antialiased;
}
:focus-visible { outline: 2px solid var(--fw-accent); outline-offset: 2px; }
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}`;
