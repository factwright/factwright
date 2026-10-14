// Draws the pictures the installers show, from Factwright's brand. With no options: the Mac disk
// image window's background (build/background.png, and @2x for Retina), around where
// build/disk-image.json puts its icons; run it again after changing either. With --win: the
// header of the window Windows shows while installing, one per screen scaling
// (build/install-header-<percent>.bmp), which `pnpm dist:win` draws each time, as they're big.
import { readFileSync, writeFileSync } from 'node:fs';
import { type DiskImageLayout, diskImagePng, installHeaderBmp } from '@factwright/ui/brand';

const BUILD = new URL('../build/', import.meta.url);

/** The screen scalings Windows offers, in percent. build/installer.nsh picks among them. */
const SCALINGS = [100, 125, 150, 175, 200, 250, 300];

if (process.argv.includes('--win')) {
  for (const percent of SCALINGS) {
    writeFileSync(new URL(`install-header-${percent}.bmp`, BUILD), installHeaderBmp(percent / 100));
  }
} else {
  const layout: DiskImageLayout = JSON.parse(
    readFileSync(new URL('disk-image.json', BUILD), 'utf8'),
  );
  writeFileSync(new URL('background.png', BUILD), await diskImagePng(layout, 1));
  writeFileSync(new URL('background@2x.png', BUILD), await diskImagePng(layout, 2));
}
