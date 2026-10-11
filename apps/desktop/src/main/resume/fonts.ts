import type { FontUrls } from '@factwright/engine';
import barlowBold from '@factwright/engine/fonts/barlow-bold.woff2?inline';
import caladeaBold from '@factwright/engine/fonts/caladea-bold.woff2?inline';
import sansBold from '@factwright/engine/fonts/factwright-sans-bold.woff2?inline';
import sansItalic from '@factwright/engine/fonts/factwright-sans-italic.woff2?inline';
import sansRegular from '@factwright/engine/fonts/factwright-sans-regular.woff2?inline';
import selawikBold from '@factwright/engine/fonts/selawik-bold.woff2?inline';
import selawikRegular from '@factwright/engine/fonts/selawik-regular.woff2?inline';
import selawikSemibold from '@factwright/engine/fonts/selawik-semibold.woff2?inline';

/**
 * The resume fonts, built into the app as data: URLs, so every resume carries them and prints
 * the same on a Mac as on Windows.
 */
export const RESUME_FONTS: FontUrls = {
  'factwright-sans-regular.woff2': sansRegular,
  'factwright-sans-bold.woff2': sansBold,
  'factwright-sans-italic.woff2': sansItalic,
  'caladea-bold.woff2': caladeaBold,
  'selawik-regular.woff2': selawikRegular,
  'selawik-semibold.woff2': selawikSemibold,
  'selawik-bold.woff2': selawikBold,
  'barlow-bold.woff2': barlowBold,
};
