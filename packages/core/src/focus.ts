import { parsePay } from './pay.ts';

/**
 * A focus for one job search: what that search looks for, on top of what the user wants in
 * Profile, for that search alone. The app keeps it in the workspace by an ID, types only the ID
 * when it starts the search, and the job search reads it with the search_focus tool.
 */

/** Where each focus is kept, by its ID: searches/focus/<id>.json. */
export const FOCUS_FOLDER = 'searches/focus';

export const focusFile = (id: string) => `${FOCUS_FOLDER}/${id}.json`;

/** A focus's ID: the day it was made and a few hex digits, such as "2026-10-20-a3f9". */
export const FOCUS_ID = /^\d{4}-\d{2}-\d{2}-[0-9a-f]{4,8}$/;

/**
 * How far along a company is, and how big: its id, how the dialog names it, what it means, and
 * how a search's name says it.
 */
export const FOCUS_STAGES = [
  ['early', 'Early startup', 'Up to Series A, under about 50 people', 'early startups'],
  ['growing', 'Growing startup', 'Series B and on, about 50 to 500 people', 'growing startups'],
  [
    'established',
    'Established company',
    'Mid-size, about 500 to 5,000 people',
    'established companies',
  ],
  ['big', 'Big company', '5,000 people or more, often public', 'big companies'],
  [
    'public',
    'Public sector or nonprofit',
    'Government, nonprofits and schools',
    'public sector and nonprofits',
  ],
] as const;

export type FocusStage = (typeof FOCUS_STAGES)[number][0];

/** Where the job is worked, as Profile says it. */
export const FOCUS_WORKPLACES = [
  ['remote', 'Remote'],
  ['hybrid', 'Hybrid'],
  ['onsite', 'On-site'],
] as const;

export type FocusWorkplace = (typeof FOCUS_WORKPLACES)[number][0];

/** How recently a job was posted, in days, or 0 for any time, with how the dialog and a name say it. */
export const FOCUS_POSTED = [
  [0, 'Any time', ''],
  [3, 'Past 3 days', 'past 3 days'],
  [7, 'Past week', 'past week'],
  [14, 'Past 2 weeks', 'past 2 weeks'],
  [30, 'Past month', 'past month'],
] as const;

export type FocusPosted = (typeof FOCUS_POSTED)[number][0];

/** The most a focus holds. */
export const FOCUS_LIMITS = {
  /** Industries to look in, and to leave out, each. */
  industries: 10,
  /** Characters in each industry. */
  industry: 60,
  /** Characters in what else the user wrote. */
  notes: 500,
  /** The most yearly pay a focus takes, in dollars. */
  pay: 10_000_000,
} as const;

/**
 * What one search looks for, on top of what the user wants in Profile: the kinds of company, a
 * pay range, where the job is worked, industries to look in or leave out, how recently it was
 * posted, and anything else, in the user's own words. Their deal-breakers still apply.
 */
export interface SearchFocus {
  stages: FocusStage[];
  /** The least and the most yearly pay, in dollars. */
  payMin: number | null;
  payMax: number | null;
  workplaces: FocusWorkplace[];
  /** Only jobs in these industries. */
  industries: string[];
  /** No jobs in these industries. */
  avoid: string[];
  /** Posted within this many days, or 0 for any time. */
  posted: FocusPosted;
  /** Anything else for this search, as the user wrote it. */
  notes: string;
}

/** No focus: the search looks for what Profile says, as ever. */
export const NO_FOCUS: SearchFocus = {
  stages: [],
  payMin: null,
  payMax: null,
  workplaces: [],
  industries: [],
  avoid: [],
  posted: 0,
  notes: '',
};

/** Whether a focus asks for anything. */
export const isFocused = (focus: SearchFocus) =>
  focus.stages.length > 0 ||
  focus.payMin !== null ||
  focus.payMax !== null ||
  focus.workplaces.length > 0 ||
  focus.industries.length > 0 ||
  focus.avoid.length > 0 ||
  focus.posted !== 0 ||
  focus.notes.trim() !== '';

/** A yearly amount the user typed, such as "$150,000" or "150k", in dollars, or null. */
export function payAmount(text: string): number | null {
  const range = parsePay(text);
  return range && range.min === range.max ? range.min : null;
}

/** Text with no line breaks or other control characters, which a name or a list never holds. */
const CONTROL = /\p{Cc}/u;

/** Some of a list's options, each once, in the list's own order, or null for anything else. */
function picked<T extends string | number>(
  options: readonly (readonly [T, ...unknown[]])[],
  value: unknown,
): T[] | null {
  if (!Array.isArray(value)) return null;
  const ids = options.map(([id]) => id);
  if (!value.every((each) => ids.includes(each)) || new Set(value).size !== value.length) {
    return null;
  }
  return ids.filter((id) => value.includes(id));
}

/** Industries as the user typed them: short names, each once, or null for anything else. */
function industries(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > FOCUS_LIMITS.industries) return null;
  const names: string[] = [];
  for (const each of value) {
    if (typeof each !== 'string' || CONTROL.test(each)) return null;
    const name = each.trim();
    if (!name || name.length > FOCUS_LIMITS.industry) return null;
    if (!names.some((known) => known.toLowerCase() === name.toLowerCase())) names.push(name);
  }
  return names;
}

const pay = (value: unknown): number | null | undefined =>
  value === null
    ? null
    : Number.isInteger(value) && (value as number) > 0 && (value as number) <= FOCUS_LIMITS.pay
      ? (value as number)
      : undefined;

/**
 * A focus as the dialog sent it or its file keeps it, checked: known options, each once, short
 * industries, whole yearly pay with the lower end first, and notes of up to 500 characters.
 * Anything else is null.
 */
export function readFocus(value: unknown): SearchFocus | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const fields = value as Record<string, unknown>;
  const stages = picked(FOCUS_STAGES, fields.stages);
  const workplaces = picked(FOCUS_WORKPLACES, fields.workplaces);
  const posted = FOCUS_POSTED.find(([days]) => days === fields.posted)?.[0];
  const payMin = pay(fields.payMin);
  const payMax = pay(fields.payMax);
  const included = industries(fields.industries);
  const avoid = industries(fields.avoid);
  const notes = typeof fields.notes === 'string' ? fields.notes.trim() : null;
  if (!stages || !workplaces || posted === undefined || !included || !avoid) return null;
  if (payMin === undefined || payMax === undefined) return null;
  if (payMin !== null && payMax !== null && payMin > payMax) return null;
  if (notes === null || notes.length > FOCUS_LIMITS.notes) return null;
  return { stages, payMin, payMax, workplaces, industries: included, avoid, posted, notes };
}

/** Dollars, short: "$150k", or "$1.2m". */
const short = (dollars: number) =>
  dollars >= 1_000_000
    ? `$${Number((dollars / 1_000_000).toFixed(1))}m`
    : `$${Math.round(dollars / 1000)}k`;

/** The pay part of a focus's name: "$150k–$200k", "$150k and up", or "up to $200k". */
export function focusPay({ payMin, payMax }: Pick<SearchFocus, 'payMin' | 'payMax'>) {
  if (payMin !== null && payMax !== null) return `${short(payMin)}–${short(payMax)}`;
  if (payMin !== null) return `${short(payMin)} and up`;
  return payMax !== null ? `up to ${short(payMax)}` : null;
}

/**
 * A focus in a few words, as Found by names its search after the place: "early startups,
 * $150k–$200k, remote". Industries and what else the user wrote stay out, to keep it short.
 */
export function focusName(focus: SearchFocus): string {
  const stage = new Map(FOCUS_STAGES.map(([id, , , words]) => [id, words]));
  const workplace = new Map(FOCUS_WORKPLACES.map(([id, label]) => [id, label.toLowerCase()]));
  const posted = FOCUS_POSTED.find(([days]) => days === focus.posted)?.[2] ?? '';
  return [
    ...focus.stages.map((id) => stage.get(id)),
    focusPay(focus),
    ...focus.workplaces.map((id) => workplace.get(id)),
    posted,
  ]
    .filter(Boolean)
    .join(', ');
}

/** A focus from its file's text, or null when there's none, or it doesn't read. */
export function focusOf(text: string | null): SearchFocus | null {
  if (!text) return null;
  try {
    return readFocus(JSON.parse(text));
  } catch {
    return null;
  }
}
