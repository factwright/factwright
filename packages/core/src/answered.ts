/**
 * Facts the user gave as answers while Claude worked, as Factwright's tools file them: a claim
 * tagged `unconfirmed`, whose Source says it was the user's answer, with the questions and
 * answers it rests on, word for word. And where any claim came from, read back for the window.
 */

import { claimParts, claimText, FACT_TAGS, type FactBlock, UNCONFIRMED } from './facts.ts';

/** One question the user answered, and what they answered, as Claude Code reported them. */
export interface Asked {
  question: string;
  answer: string;
}

/** A claim to file from the user's answers. */
export interface AnsweredClaim {
  title: string;
  /** Its tags, as facts/README.md defines them: status, ownership and confidence. */
  status: string;
  ownership: string | null;
  confidence: string;
  /** What resumes say. */
  wording: string;
  short?: string | null | undefined;
  numbers?: string | null | undefined;
  /** What to say, and never to say, such as “led the rollout” / never “built the system”. */
  say?: string | null | undefined;
  keywords?: string | null | undefined;
  /** The day the user answered, as YYYY-MM-DD. */
  date: string;
  /** What Claude was doing, such as "tailoring a resume for Acme Health", or null. */
  context: string | null;
  asked: readonly Asked[];
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what it drops.
const CONTROL = /[\u0000-\u001f\u007f\u0085\u2028\u2029]+/g;

/**
 * Characters that change how text shows without showing themselves: format characters, such as
 * the ones that reorder text from right to left, spaces of no width and the tags that can hide
 * words, and the selectors that change how the character before them looks. Words in the fact
 * bank could otherwise read one way and say another.
 */
const INVISIBLE = /[\p{Cf}\p{Variation_Selector}]/gu;

/**
 * Text on one line: line breaks and other control characters become spaces, runs of spaces one,
 * and marks that don't show go.
 */
export function oneLine(text: string): string {
  return text.replace(INVISIBLE, '').replace(CONTROL, ' ').replace(/\s+/g, ' ').trim();
}

/** The Source a claim filed from an answer gives: "answer 2026-10-14, tailoring a resume for Acme". */
export const answerSource = (date: string, context: string | null) =>
  context ? `answer ${date}, ${oneLine(context)}` : `answer ${date}`;

/**
 * A claim's text, in the format facts/README.md gives, tagged `unconfirmed` and with its
 * Source the user's answer, then each question it rests on with the user's answer.
 */
export function answeredClaimText(claim: AnsweredClaim): string {
  const tags = [UNCONFIRMED, claim.status, claim.ownership, claim.confidence].filter(
    (tag): tag is string => Boolean(tag),
  );
  const detail = (label: string, value: string | null | undefined) =>
    value && oneLine(value) ? [`- **${label}:** ${oneLine(value)}`] : [];
  return [
    `### ${oneLine(claim.title)}`,
    tags.map((tag) => `\`${tag}\``).join(' '),
    `> ${oneLine(claim.wording)}`,
    ...detail('Short', claim.short),
    ...detail('Numbers', claim.numbers),
    ...detail("Say / don't say", claim.say),
    ...detail('Keywords', claim.keywords),
    `- **Source:** ${answerSource(claim.date, claim.context)}`,
    ...claim.asked.flatMap(({ question, answer }) => [
      `- **Question:** ${oneLine(question)}`,
      `- **Answer:** ${oneLine(answer)}`,
    ]),
  ].join('\n');
}

/** A correction to a verified claim, from what the user answered. */
export interface ClaimCorrection {
  /** Its tags in place of the ones it has, by what they say. Those left out stay as they are. */
  status?: string | null | undefined;
  ownership?: string | null | undefined;
  confidence?: string | null | undefined;
  /** What resumes say now. */
  wording: string;
  /** Details in place of its own. Those left out stay as written. */
  short?: string | null | undefined;
  numbers?: string | null | undefined;
  say?: string | null | undefined;
  keywords?: string | null | undefined;
  /** Who said so, and when: the user's first name and the date, such as "Alex 2026-10-25". */
  source: string;
  asked: readonly Asked[];
}

/** The details a correction can give, by their labels in the fact bank's format, in its order. */
const DETAILS = [
  ['short', 'Short'],
  ['numbers', 'Numbers'],
  ['say', "Say / don't say"],
  ['keywords', 'Keywords'],
] as const;

/** A detail's line, such as "- **Numbers:** 12 clinics": its label, then what it says. */
const DETAIL = /^[ \t]*[-*+][ \t]+\*\*([^*\n]+?):\*\*/;

/** The labels that say where a claim came from, which a correction says anew. */
const ORIGIN = ['Source', 'Question', 'Answer'];

/**
 * A verified claim with a correction the user gave in their answers: its new wording, the tags
 * and details given in place of its own, and its Source the user and the date, then the questions
 * and answers it rests on now, in place of any before. Everything else under it stays as written,
 * and it stays verified.
 */
export function correctedClaimText(block: FactBlock, correction: ClaimCorrection): string {
  const parts = claimParts(block);
  const tags = parts.tags.filter((tag) => tag !== UNCONFIRMED);
  const groups: readonly (readonly string[])[] = [
    FACT_TAGS.status,
    FACT_TAGS.ownership,
    FACT_TAGS.confidence,
  ];
  for (const [i, next] of [
    correction.status,
    correction.ownership,
    correction.confidence,
  ].entries()) {
    const group = groups[i] ?? [];
    if (!next) continue;
    const at = tags.findIndex((tag) => group.includes(tag));
    if (at >= 0) {
      tags[at] = next;
      continue;
    }
    // A tag it had none of goes after the ones that come before it: status, then ownership.
    const before = groups.slice(0, i).flat();
    const after = tags.reduce((last, tag, j) => (before.includes(tag) ? j + 1 : last), 0);
    tags.splice(after, 0, next);
  }
  const wanted = new Map<string, string>();
  for (const [key, label] of DETAILS) {
    const value = correction[key];
    if (value && oneLine(value)) wanted.set(label, `- **${label}:** ${oneLine(value)}`);
  }
  const details: string[] = [];
  for (const line of parts.details ? parts.details.split('\n') : []) {
    const label = line.match(DETAIL)?.[1]?.trim() ?? null;
    if (label !== null && ORIGIN.includes(label)) continue;
    const given = label === null ? undefined : wanted.get(label);
    if (given !== undefined && label !== null) {
      details.push(given);
      wanted.delete(label);
      continue;
    }
    details.push(line);
  }
  return claimText({
    ...parts,
    tags,
    wording: oneLine(correction.wording),
    details: [
      ...details,
      ...wanted.values(),
      `- **Source:** ${oneLine(correction.source)}`,
      ...correction.asked.flatMap(({ question, answer }) => [
        `- **Question:** ${oneLine(question)}`,
        `- **Answer:** ${oneLine(answer)}`,
      ]),
    ].join('\n'),
  });
}

/** Where a claim came from, as its Source line and any questions under it say. */
export type ClaimOrigin =
  /** The user's answer to Claude, in a run on a job or any other. */
  | { kind: 'answer'; date: string; context: string | null; asked: Asked[] }
  /**
   * Drafted from what the user shared: a resume, their notes, LinkedIn, a screenshot, or a
   * project they told about in their Profile's Beyond work.
   */
  | { kind: 'shared'; what: SharedKind; file: string | null; date: string | null }
  /** Anything else, such as "Alex 2026-10-12", as written. */
  | { kind: 'other'; text: string };

export type SharedKind = 'resume' | 'notes' | 'linkedin' | 'screenshot' | 'profile';

const SHARED: Readonly<Record<string, SharedKind>> = {
  resume: 'resume',
  notes: 'notes',
  linkedin: 'linkedin',
  screenshot: 'screenshot',
  profile: 'profile',
};

// A list item's label, such as "- **Source:** ", then the rest of its line. Each pattern takes
// time in step with the line it reads.
const LABELLED = /^[ \t]*[-*+][ \t]+\*\*([A-Za-z]+):\*\*([^\n]*)$/;
const ANSWER_SOURCE = /^answer (\d{4}-\d{2}-\d{2})(?:, (\S.*))?$/;
const DATE_AT_END = /(?:^|\s)(\d{4}-\d{2}-\d{2})$/;

/** Where a claim came from, or null when it gives no Source. */
export function claimOrigin(block: Pick<FactBlock, 'text'>): ClaimOrigin | null {
  let source: string | null = null;
  const asked: Asked[] = [];
  let question: string | null = null;
  for (const line of block.text.split(/\r?\n/)) {
    const match = line.match(LABELLED);
    if (!match) continue;
    const [, label, value = ''] = match;
    const text = value.trim();
    if (label === 'Source' && source === null) source = text;
    else if (label === 'Question') question = text;
    else if (label === 'Answer' && question !== null) {
      asked.push({ question, answer: text });
      question = null;
    }
  }
  if (source === null) return null;
  const answer = source.match(ANSWER_SOURCE);
  if (answer?.[1]) {
    return { kind: 'answer', date: answer[1], context: answer[2]?.trim() || null, asked };
  }
  const [word = '', ...rest] = source.split(' ');
  const what = SHARED[word.toLowerCase()];
  if (what) {
    const tail = rest.join(' ').trim();
    const date = tail.match(DATE_AT_END)?.[1] ?? null;
    const file = (date ? tail.slice(0, -date.length) : tail).trim() || null;
    return { kind: 'shared', what, file, date };
  }
  return { kind: 'other', text: source };
}
