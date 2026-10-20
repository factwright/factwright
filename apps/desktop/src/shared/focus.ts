import { parsePay } from '@factwright/core';
import { WORKPLACES, type Workplace } from './about.ts';

/** How far along a company is, and how big, for a search that wants one or more. */
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

/** How recently a job was posted, in days, or any time. */
export const FOCUS_POSTED = [
  [0, 'Any time', ''],
  [3, 'Past 3 days', 'past 3 days'],
  [7, 'Past week', 'past week'],
  [14, 'Past 2 weeks', 'past 2 weeks'],
  [30, 'Past month', 'past month'],
] as const;

export type FocusPosted = (typeof FOCUS_POSTED)[number][0];

/**
 * What one search looks for, on top of what the user wants in Profile, for that search alone:
 * the kinds of company, a pay range, where the job is worked, industries to look in or leave
 * out, how recently it was posted, and anything else, in the user's own words. Their
 * deal-breakers still apply.
 */
export interface SearchFocus {
  stages: FocusStage[];
  /** The least and the most yearly pay, in dollars. */
  payMin: number | null;
  payMax: number | null;
  workplaces: Workplace[];
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

/** Dollars, short: "$150k", or "$1.2m". */
const short = (dollars: number) =>
  dollars >= 1_000_000
    ? `$${Number((dollars / 1_000_000).toFixed(1))}m`
    : `$${Math.round(dollars / 1000)}k`;

/** The pay part of a focus's name: "$150k–$200k", "$150k and up", or "up to $200k". */
function payWords({ payMin, payMax }: SearchFocus): string | null {
  if (payMin !== null && payMax !== null) return `${short(payMin)}–${short(payMax)}`;
  if (payMin !== null) return `${short(payMin)} and up`;
  return payMax !== null ? `up to ${short(payMax)}` : null;
}

/**
 * A focus in a few words, as Found by names its search after the place: "early startups,
 * $150k–$200k, remote". Industries and anything else the user wrote stay out, to keep it short.
 */
export function focusName(focus: SearchFocus): string {
  const stage = new Map(FOCUS_STAGES.map(([id, , , words]) => [id, words]));
  const posted = FOCUS_POSTED.find(([days]) => days === focus.posted)?.[2] ?? '';
  return [
    ...focus.stages.map((id) => stage.get(id)),
    payWords(focus),
    ...focus.workplaces.map((id) => WORKPLACES.find(([each]) => each === id)?.[1].toLowerCase()),
    posted,
  ]
    .filter(Boolean)
    .join(', ');
}
