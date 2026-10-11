import { themeCss } from './theme.ts';

const CSS = themeCss();

/** Puts Factwright's colors, type and base styles on the page. Render it once, at the root. */
export function ThemeStyle() {
  return <style>{CSS}</style>;
}
