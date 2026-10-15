/**
 * Facts the user gave as answers while Claude worked, as Factwright's tools file them: a claim
 * tagged `unconfirmed`, whose Source says it was the user's answer, with the questions and
 * answers it rests on, word for word. And where any claim came from, read back for the window.
 */

import { type FactBlock, UNCONFIRMED } from './facts.ts';

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
 * Marks that change how text shows without showing themselves: the ones that reorder it from
 * right to left, and a space of no width. Words in the fact bank could otherwise read one way
 * and say another.
 */
const INVISIBLE = /[\u061c\u200b\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g;

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

/** Where a claim came from, as its Source line and any questions under it say. */
export type ClaimOrigin =
  /** The user's answer to Claude, in a run on a job or any other. */
  | { kind: 'answer'; date: string; context: string | null; asked: Asked[] }
  /** Drafted from what the user shared: a resume, their notes, LinkedIn or a screenshot. */
  | { kind: 'shared'; what: SharedKind; file: string | null; date: string | null }
  /** Anything else, such as "Alex 2026-10-12", as written. */
  | { kind: 'other'; text: string };

export type SharedKind = 'resume' | 'notes' | 'linkedin' | 'screenshot';

const SHARED: Readonly<Record<string, SharedKind>> = {
  resume: 'resume',
  notes: 'notes',
  linkedin: 'linkedin',
  screenshot: 'screenshot',
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
