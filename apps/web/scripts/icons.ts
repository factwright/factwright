// Draws the web view's icons from Factwright's mark: the browser tab's icon, and the home-screen
// icons. Those fill the whole square, since phones round the corners themselves, and keep the
// mark inside the middle that Android's masks keep. Run it again after changing the mark.
import { writeFileSync } from 'node:fs';
import { appIconPng, MARK_SMALL, MARK_VIEWBOX, markSvg } from '@factwright/ui/brand';
import { DARK, LIGHT } from '@factwright/ui/tokens';

const PUBLIC = new URL('../public/', import.meta.url);

/** The tab's icon: the mark's small cut, in the accent color of the system's light or dark setting. */
const tabIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${MARK_VIEWBOX}">
  <title>Factwright</title>
  <style>
    .mark { color: ${LIGHT.accent} }
    @media (prefers-color-scheme: dark) {
      .mark { color: ${DARK.accent} }
    }
  </style>
  <g class="mark">${markSvg(MARK_SMALL, 'currentColor')}</g>
</svg>
`;
writeFileSync(new URL('icon.svg', PUBLIC), tabIcon);

const SIZES = { 'apple-touch-icon.png': 180, 'icon-192.png': 192, 'icon-512.png': 512 };
for (const [name, size] of Object.entries(SIZES)) {
  writeFileSync(
    new URL(name, PUBLIC),
    await appIconPng({ size, shape: 'square', markScale: 0.86 }),
  );
}
