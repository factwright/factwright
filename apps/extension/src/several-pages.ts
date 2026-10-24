import { type FieldKind, type FieldReply, fieldKind, fieldPart } from '@factwright/core';
import { type FormValues, type NewAnswer, newAnswers, sentAnswers } from './fill.ts';
import type { FieldFilled, FieldValue, PageAdder, PageForm } from './page/form.ts';

/**
 * An application that runs over several pages in one tab, as Workday's does, as the panel goes
 * along with it: what each page gave, kept for when you mark the job applied, the page it went on
 * to, which the panel offers to fill, and its parts for each job and school, which the panel
 * offers to add one to for each on file. The page's own function reads which page it's on and
 * presses a button that adds a part (page/form.ts); this is what the panel makes of it.
 */

/** An answer to one of a form's own questions, as Mark as applied sends it. */
export interface SentAnswer {
  question: string;
  text: string;
}

/**
 * What an application's earlier pages gave, in a tab, as it goes on to the next: the answers to
 * their own questions, to keep with the job once you mark it applied, and the new answers you
 * gave, to offer to keep then.
 */
export interface Earlier {
  /** The job they were for, or null when it isn't one you saved. */
  job: string | null;
  /** The address of the page they came from last, which Workday keeps from page to page. */
  url: string;
  sent: SentAnswer[];
  offers: NewAnswer[];
}

export const NO_EARLIER: Earlier = { job: null, url: '', sent: [], offers: [] };

/** A page's address, as an application keeps it from page to page: without its ? or #. */
function addressOf(url: string): string {
  try {
    const { origin, pathname } = new URL(url);
    return `${origin}${pathname}`;
  } catch {
    return url.split(/[?#]/)[0] ?? url;
  }
}

/**
 * What an application's earlier pages gave, for a page of it, only when it's the same
 * application: the same job, when both are jobs you saved, or else the same address, as Workday's
 * keeps its own from page to page. Another job's give nothing.
 */
export function forApplication(earlier: Earlier, job: string | null, url: string): Earlier {
  if (earlier === NO_EARLIER) return NO_EARLIER;
  const same =
    earlier.job !== null && job !== null
      ? earlier.job === job
      : addressOf(earlier.url) === addressOf(url);
  return same ? earlier : NO_EARLIER;
}

/** Answers to a form's own questions, a later one in place of an earlier one to the same question. */
export function joinSent(
  earlier: readonly SentAnswer[],
  later: readonly SentAnswer[],
): SentAnswer[] {
  const asked = new Set(later.map((each) => each.question));
  return [...earlier.filter((each) => !asked.has(each.question)), ...later];
}

/** New answers to offer to keep, a later one in place of an earlier one of the same kind. */
export function joinOffers(
  earlier: readonly NewAnswer[],
  later: readonly NewAnswer[],
): NewAnswer[] {
  const kinds = new Set(later.map((each) => each.kind));
  return [...earlier.filter((each) => !kinds.has(each.kind)), ...later];
}

/** A page of an application, as the panel filled it, with what its fields held when last read. */
export interface FilledPage {
  form: PageForm;
  replies: readonly FieldReply[];
  /** How filling each field went, by its key. */
  filled: ReadonlyMap<string, FieldFilled>;
  values: readonly FieldValue[] | null;
  /** The job it's for, or null when it isn't one you saved. */
  job: string | null;
  /** Whether it's a form the panel only gives answers to copy for, as LinkedIn's. */
  copyOnly: boolean;
}

/**
 * What a page of an application that runs over several, and its earlier pages, gave, as you last
 * left their fields, for the next page the panel fills in the same tab. Nothing, for a form on one
 * page.
 */
export function carriedOn(page: FilledPage, earlier: Earlier): Earlier {
  if (!page.form.step || page.copyOnly) return NO_EARLIER;
  const values = page.values ?? [];
  return {
    job: page.job ?? earlier.job,
    url: page.form.url,
    sent: joinSent(earlier.sent, sentAnswers(page.form, page.replies, values)),
    offers: joinOffers(earlier.offers, newAnswers(page.form, page.replies, values, page.filled)),
  };
}

/** The page an application went on to, by the name its steps give it, with how many fields it has. */
export interface NextPage {
  step: string;
  fields: number;
}

/**
 * The page an application went on to, as what the panel last read of the tab says: another of its
 * steps than the form's. Null while it's on the form's own, or the form isn't one of several.
 */
export const nextPageOf = (form: PageForm, read: FormValues | null): NextPage | null =>
  read?.step && read.step !== form.step ? { step: read.step, fields: read.fields } : null;

/** A page's site, as its address says, or "" for one that isn't an address. */
function siteOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}

/**
 * Whether what the panel read of the tab is still the form it filled: the page at the form's
 * address, but for what's after its #, or on an application that runs over several pages, the
 * same step of it on the same site, as one that loads each page anew may give the same page
 * another address each time you come back to it.
 */
export function onSamePage(form: PageForm, read: Pick<FormValues, 'url' | 'step'>): boolean {
  if (read.url.split('#')[0] === form.url.split('#')[0]) return true;
  return form.step !== '' && read.step === form.step && siteOf(read.url) === siteOf(form.url);
}

/** A part of a form for each job, or for each school. */
export type Part = 'job' | 'school';

/** The kinds of field a part for a job, or a school, asks once for each. */
const ONE_EACH: Record<Part, FieldKind[]> = {
  job: ['current-title', 'current-company'],
  school: ['school', 'degree'],
};

/**
 * How many parts for a job, or for a school, a form has now: as many as it asks one job's title or
 * company, or one school's name or degree, in such a part.
 */
export function partsOf(form: PageForm, part: Part): number {
  return Math.max(
    ...ONE_EACH[part].map(
      (kind) =>
        form.fields.filter((field) => fieldPart(field) === part && fieldKind(field) === kind)
          .length,
    ),
  );
}

/**
 * Which part of the form a button that adds one adds to, a job's, a school's, or neither, by the
 * part it's in itself, never one around that, as Workday's My Experience is around its Websites.
 */
export function adderPart(adder: PageAdder): Part | null {
  return fieldPart({
    question: adder.words,
    hint: '',
    control: 'text',
    type: '',
    autocomplete: '',
    name: '',
    section: adder.section.split(' › ').at(-1) ?? '',
  });
}

/** The most parts the panel adds to a form at once, for jobs or schools on file: more take another click. */
const MOST_PARTS = 10;

/** An offer to add a part to a form for each job, or school, on file it has none for yet. */
export interface PartsOffer {
  adder: PageAdder;
  /** How many it adds. */
  more: number;
  /** What the panel says of it. */
  says: string;
  /** Its button's words. */
  label: string;
}

/** What a part of the form is for, as many as there are: "job" or "jobs", "school" or "schools". */
const partWord = (count: number, part: Part) => `${part}${count === 1 ? '' : 's'}`;

/**
 * The offers to add a part to a form for each job, or school, on file that it has none for yet,
 * as Workday's My Experience starts with one, or none: where it has a button that adds one, and
 * Factwright has more on file (`blocks`, as the app says, or none from an app before it) than the
 * form has parts.
 */
export function partsOffers(
  form: PageForm,
  blocks: { jobs: number; schools: number } | undefined,
): PartsOffer[] {
  if (!blocks) return [];
  return (['job', 'school'] as const).flatMap((part) => {
    const adder = form.adders.find((each) => adderPart(each) === part);
    // With the parts it saved, that are no fields anymore, as SmartRecruiters' jobs.
    const has = partsOf(form, part) + (adder?.saved ?? 0);
    const want = part === 'job' ? blocks.jobs : blocks.schools;
    if (!adder || want <= has) return [];
    const more = Math.min(want - has, MOST_PARTS);
    return [
      {
        adder,
        more,
        says: `Factwright has ${want} ${partWord(want, part)} on file, and ${adder.section} has room for ${has === 0 ? 'none' : has} yet. Add a part for each of the others, and Factwright fills them in.`,
        label: `Add ${more} for your other ${partWord(more, part)}`,
      },
    ];
  });
}
