import type { Layout } from './schema.ts';

/** A layout as the app offers it: a look the user picks for their resumes. */
export interface Template {
  layout: Layout;
  name: string;
  /** What it looks like, in a sentence. */
  look: string;
  /** How it lays out: one column reads best in applicant systems; the Word file is always one. */
  columns: 1 | 2;
}

/** Every look a resume can have, in the order the app shows them. */
export const TEMPLATES: readonly Template[] = [
  {
    layout: 'classic',
    name: 'Classic',
    look: 'Traditional and all serif, in black and white. The safest choice for formal fields.',
    columns: 1,
  },
  {
    layout: 'timeline',
    name: 'Timeline',
    look: 'A bold name and a date rail down the side, with one warm accent.',
    columns: 1,
  },
  {
    layout: 'executive',
    name: 'Executive',
    look: 'A centered header, serif headings and a strengths block, in navy and gold.',
    columns: 1,
  },
  {
    layout: 'modern',
    name: 'Modern',
    look: 'Two columns under a dark header, with your numbers and skills at the side.',
    columns: 2,
  },
  {
    layout: 'compact',
    name: 'Compact',
    look: 'Section names in the margin and tight spacing, to fit a lot on one page.',
    columns: 1,
  },
  {
    layout: 'minimal',
    name: 'Minimal',
    look: 'Quiet and airy: lots of white space, gray headings and no color.',
    columns: 1,
  },
  {
    layout: 'elegant',
    name: 'Elegant',
    look: 'Serif type with a deep red accent, and plenty of room to breathe.',
    columns: 1,
  },
  {
    layout: 'banner',
    name: 'Banner',
    look: 'A blue banner across the top, with a bold bar over each section.',
    columns: 1,
  },
];

/** A layout's template. */
export const templateOf = (layout: Layout): Template =>
  TEMPLATES.find((each) => each.layout === layout) ?? (TEMPLATES[0] as Template);
