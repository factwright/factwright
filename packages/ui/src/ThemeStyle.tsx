import { namedThemesCss, themeCss } from './theme.ts';

const CSS = themeCss();

/** Puts Factwright's colors, type and base styles on the page. Render it once, at the root. */
export function ThemeStyle() {
  return <style>{CSS}</style>;
}

/** Adds the themes beyond light and dark, for a page that offers them. Render it after ThemeStyle. */
export function NamedThemesStyle() {
  return <style>{namedThemesCss()}</style>;
}
