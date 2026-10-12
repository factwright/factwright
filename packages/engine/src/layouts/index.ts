import type { Layout } from '../schema.ts';
import { banner } from './banner.ts';
import { classic } from './classic.ts';
import { compact } from './compact.ts';
import { elegant } from './elegant.ts';
import { executive } from './executive.ts';
import { minimal } from './minimal.ts';
import { modern } from './modern.ts';
import type { Theme } from './parts.ts';
import { timeline } from './timeline.ts';

/** Each layout's styles and body. */
export const THEMES: Record<Layout, Theme> = {
  timeline,
  executive,
  modern,
  classic,
  elegant,
  compact,
  minimal,
  banner,
};
