// Draws the pictures the installers show, from Factwright's brand: the Mac disk image window's
// background (build/background.png, and @2x for Retina), around where build/disk-image.json puts
// its icons. electron-builder builds them in. Run it again after changing either.
import { readFileSync, writeFileSync } from 'node:fs';
import { type DiskImageLayout, diskImagePng } from '@factwright/ui/brand';

const BUILD = new URL('../build/', import.meta.url);
const layout: DiskImageLayout = JSON.parse(readFileSync(new URL('disk-image.json', BUILD), 'utf8'));
writeFileSync(new URL('background.png', BUILD), await diskImagePng(layout, 1));
writeFileSync(new URL('background@2x.png', BUILD), await diskImagePng(layout, 2));
