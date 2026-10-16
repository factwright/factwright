// Draws the extension's icons from Factwright's app icon: the toolbar's, the extensions page's and
// the store's. Run it again after changing the mark: `pnpm --filter @factwright/extension icons`.
import { mkdirSync, writeFileSync } from 'node:fs';
import { appIconPng } from '@factwright/ui/brand';
import { ICON_SIZES } from '../src/manifest.ts';

const ICONS = new URL('../public/icons/', import.meta.url);
mkdirSync(ICONS, { recursive: true });
for (const size of ICON_SIZES) {
  // The Mac's rounded square leaves the margin the stores ask for, so it reads as an icon anywhere.
  writeFileSync(new URL(`${size}.png`, ICONS), await appIconPng({ size, shape: 'mac' }));
}
