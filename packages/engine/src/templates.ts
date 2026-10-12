import { classic } from './built-in/classic.ts';
import { minimal } from './built-in/minimal.ts';
import type { FontFile } from './fonts.ts';

/** What a template calls the parts of a resume. The PDF and the Word file use the same words. */
export interface SectionTitles {
  summary: string;
  competencies: string;
  experience: string;
  education: string;
  skills: string;
}

/**
 * A template's look in Word, which lays out every resume in one column for applicant systems:
 * its fonts by name, its colors in hex, such as "1F3A5F", and its sizes in half points.
 */
export interface WordTheme {
  /** The font for the name, headings and numbers, such as "Cambria". */
  head: string;
  /** The font for everything else, such as "Calibri". */
  body: string;
  /** Headings, rules, dates and bullets. */
  accent: string;
  /** Bullets' bold lead-ins. */
  accent2: string;
  /** Companies, places and labels. */
  muted: string;
  /** The highlight cards' background. */
  tint: string;
  nameColor: string;
  headlineColor: string;
  /** The rule under the contact line. */
  ruleColor: string;
  /** The name's size, such as 48 for 24 points. */
  nameSize: number;
  nameCaps: boolean;
  /** Whether the name, headline and contact line are centered. */
  center: boolean;
  /** The text's size, such as 21 for 10.5 points. */
  size: number;
}

/**
 * A resume template: its look in a sentence, the fonts it carries, what it calls each part,
 * its look in Word, and its page: styles, and markup in Mustache's syntax that the engine fills
 * in from the resume. See template/view.ts for what the markup can show.
 */
export interface Template {
  /** What resume.json's layout calls it, such as "classic". */
  id: string;
  name: string;
  /** What it looks like, in a sentence. */
  look: string;
  /** The font files it carries, from the engine's own. */
  fonts: readonly FontFile[];
  titles: SectionTitles;
  word: WordTheme;
  css: string;
  /** The page's markup. */
  body: string;
  /** Markup the body and other parts show by name, as {{> name}}. */
  parts: Readonly<Record<string, string>>;
}

/** The templates every user has. A user can add their own to these, in their workspace. */
export const TEMPLATES: readonly Template[] = [classic, minimal];

/** A resume with no layout uses this one. */
export const DEFAULT_TEMPLATE = 'classic';

/** A template's ID, which names its file in the workspace: "classic", or "navy-sidebar". */
export const TEMPLATE_ID = /^[a-z0-9][a-z0-9-]{0,47}$/;

/** A template built into the app, by its ID. */
export const builtInTemplate = (id: string): Template | undefined =>
  TEMPLATES.find((template) => template.id === id);
