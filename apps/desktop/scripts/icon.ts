// Draws the app's icons from Factwright's mark: on the Mac's icon grid for the Mac app and the
// Dock while developing (build/icon.png), and as a square for Windows (build/icon-win.png). The
// installers build them in. Run it again after changing the mark.
import { mkdirSync, writeFileSync } from 'node:fs';
import { appIconPng } from '@factwright/ui/brand';

const BUILD = new URL('../build/', import.meta.url);
mkdirSync(BUILD, { recursive: true });
writeFileSync(new URL('icon.png', BUILD), await appIconPng({ size: 1024, shape: 'mac' }));
writeFileSync(new URL('icon-win.png', BUILD), await appIconPng({ size: 256, shape: 'square' }));
