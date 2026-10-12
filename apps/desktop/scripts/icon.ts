// Draws the app's icon from Factwright's mark, on the Mac's icon grid. Installers will build it
// into the app from build/icon.png, and until then `pnpm dev` shows it in the Dock. Run it again
// after changing the mark.
import { mkdirSync, writeFileSync } from 'node:fs';
import { appIconPng } from '@factwright/ui/brand';

const BUILD = new URL('../build/', import.meta.url);
mkdirSync(BUILD, { recursive: true });
writeFileSync(new URL('icon.png', BUILD), await appIconPng({ size: 1024, shape: 'mac' }));
