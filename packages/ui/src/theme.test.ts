import { describe, expect, it } from 'vitest';
import { namedThemesCss, themeCss } from './theme.ts';
import { isThemeChoice, SYSTEM_THEME, THEMES, themeById, themeShown } from './themes.ts';
import { DARK, LIGHT, TONES } from './tokens.ts';

const css = themeCss();

describe('themeCss', () => {
  it('sets every light color on the root and on data-theme="light"', () => {
    expect(css).toContain(':root, [data-theme="light"] {');
    expect(css).toContain(`--fw-accent-soft: ${LIGHT.accentSoft};`);
    expect(css).toContain(`--fw-control-border: ${LIGHT.controlBorder};`);
  });

  it('switches to dark with the system, unless the page asks for a theme', () => {
    expect(css).toContain(
      '@media (prefers-color-scheme: dark) { :root:not([data-theme]) { color-scheme: dark;',
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

describe('the themes beyond light and dark', () => {
  const named = namedThemesCss();

  it('gives each its own colors, tones and color scheme under its own data-theme', () => {
    const tokyo = themeById('tokyo-night');
    expect(named).toContain(
      `[data-theme="tokyo-night"] { color-scheme: dark; --fw-bg: ${tokyo?.colors.bg};`,
    );
    expect(named).toContain('[data-theme="solarized-light"] { color-scheme: light;');
    expect(named).toContain(`--fw-tone-teal-fg: ${tokyo?.tones.teal.fg};`);
  });

  it('leaves light and dark to themeCss, and themeCss holds none of the rest', () => {
    expect(named).not.toContain('[data-theme="light"]');
    expect(named).not.toContain('[data-theme="dark"]');
    expect(css).not.toContain('tokyo-night');
  });

  it('gives every theme an ID of its own', () => {
    expect(new Set(THEMES.map((theme) => theme.id)).size).toBe(THEMES.length);
  });

  it('takes only the themes it has, or following the system', () => {
    expect(isThemeChoice(SYSTEM_THEME)).toBe(true);
    expect(isThemeChoice('nord')).toBe(true);
    expect(isThemeChoice('neon')).toBe(false);
    expect(isThemeChoice(3)).toBe(false);
    expect(isThemeChoice('__proto__')).toBe(false);
  });

  it('shows the system’s setting when following it, and the theme when one is chosen', () => {
    expect(themeShown(SYSTEM_THEME, true).id).toBe('dark');
    expect(themeShown(SYSTEM_THEME, false).id).toBe('light');
    expect(themeShown('nord', false).id).toBe('nord');
    expect(themeShown('light', true).id).toBe('light');
  });
});
