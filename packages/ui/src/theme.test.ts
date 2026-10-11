import { describe, expect, it } from 'vitest';
import { themeCss } from './theme.ts';
import { DARK, LIGHT, TONES } from './tokens.ts';

const css = themeCss();

describe('themeCss', () => {
  it('sets every light color on the root and on data-theme="light"', () => {
    expect(css).toContain(':root, [data-theme="light"] {');
    expect(css).toContain(`--fw-accent-soft: ${LIGHT.accentSoft};`);
    expect(css).toContain(`--fw-control-border: ${LIGHT.controlBorder};`);
  });

  it('switches to dark with the system, unless the page asks for light', () => {
    expect(css).toContain(
      '@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { color-scheme: dark;',
    );
  });

  it('sets every dark color on data-theme="dark"', () => {
    expect(css).toContain('[data-theme="dark"] { color-scheme: dark;');
    expect(css).toContain(`--fw-accent-soft: ${DARK.accentSoft};`);
  });

  it('defines both colors of every tone', () => {
    for (const tone of TONES) {
      expect(css).toContain(`--fw-tone-${tone}-fg:`);
      expect(css).toContain(`--fw-tone-${tone}-bg:`);
    }
  });

  it('defines the type, spacing and radius scales', () => {
    expect(css).toContain('--fw-text-base: 14px;');
    expect(css).toContain('--fw-space-4: 16px;');
    expect(css).toContain('--fw-radius-full: 999px;');
  });
});
