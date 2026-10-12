import { slug } from './keys.ts';
import { markdownTable } from './markdown.ts';
import type { SentAnswer } from './tracker.ts';

/** One of Claude's suggested answers, from a job's answers.md. */
export interface SuggestedAnswer {
  question: string;
  /** The answer, as Markdown: for a choice question, the pick. */
  answer: string;
  /** For a choice question, why that pick. */
  why: string | null;
}

/** One question on an application, with Claude's suggestion and what the user actually sent. */
export interface ApplicationAnswer {
  question: string;
  suggested: string | null;
  /** For a choice question, why Claude picked what it did. */
  why: string | null;
  sent: SentAnswer | null;
}

/**
 * A question reduced to its words, so the same question matches however it's numbered,
 * punctuated or marked as required: "1. Why Acme? *" and "Why Acme" are the same.
 */
export function questionKey(question: string): string {
  return question
    .toLowerCase()
    .replace(/^\s*(?:q(?:uestion)?\s*)?\d+\s*[.):-]\s+/, '')
    .replace(/\(\s*(?:required|optional)\s*\)/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * The key a question matches among others: the same words, or, for a question Claude shortened
 * or the user trimmed, one that holds the other and is most of its length.
 */
function matching(key: string, keys: Iterable<string>): string | undefined {
  let close: string | undefined;
  for (const each of keys) {
    if (each === key) return each;
    const [short, long] = each.length < key.length ? [each, key] : [key, each];
    if (!close && long.includes(short) && short.length >= long.length * 0.6) close = each;
  }
  return close;
}

/**
 * Claude's suggestions in a job's answers.md: each "## question" with the answer under it, and
 * each row of a table of picks, such as "| Question | Pick | Why |". A question answered twice
 * keeps the later answer, since answers.md is added to.
 */
export function readSuggestedAnswers(markdown: string | null | undefined): SuggestedAnswer[] {
  if (!markdown) return [];
  const found = new Map<string, SuggestedAnswer>();
  const add = (question: string, answer: string, why: string | null = null) => {
    const key = questionKey(question);
    if (key && answer) found.set(matching(key, found.keys()) ?? key, { question, answer, why });
  };
  const sections: { heading: string; lines: string[] }[] = [];
  for (const line of markdown.split(/\r?\n/)) {
    const heading = line.match(/^##\s+(.+?)\s*$/)?.[1];
    if (heading !== undefined) sections.push({ heading, lines: [] });
    else sections.at(-1)?.lines.push(line);
  }
  for (const { heading, lines } of sections) {
    const text = lines.join('\n').trim();
    const rows = markdownTable(text).filter((row) => row.question?.trim());
    if (rows.length === 0) {
      add(heading, text);
      continue;
    }
    for (const row of rows) {
      const pick = (row.pick ?? row.answer ?? '').trim();
      add(row.question?.trim() ?? '', pick, row.why?.trim() || null);
    }
  }
  return [...found.values()];
}

/**
 * Every question on a job's application: the ones the user pasted, in order, then any others
 * Claude answered or the user recorded an answer for, each with Claude's suggestion and what the
 * user actually sent.
 */
export function applicationAnswers(
  questions: readonly string[],
  suggested: readonly SuggestedAnswer[],
  sent: readonly SentAnswer[],
): ApplicationAnswer[] {
  const byKey = new Map<string, ApplicationAnswer>();
  const entry = (question: string) => {
    const key = questionKey(question);
    if (!key) return null;
    const known = matching(key, byKey.keys());
    if (known) return byKey.get(known) ?? null;
    const added: ApplicationAnswer = { question, suggested: null, why: null, sent: null };
    byKey.set(key, added);
    return added;
  };
  for (const question of questions) entry(question);
  for (const each of suggested) {
    const found = entry(each.question);
    if (!found) continue;
    found.suggested = each.answer;
    found.why = each.why;
  }
  for (const each of sent) {
    const found = entry(each.question);
    if (found) found.sent = each;
  }
  return [...byKey.values()];
}

/** The shape of a question's ID, which names its answer's file: a date, then words. */
export const ASK_ID = /^\d{4}-\d{2}-\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * A new question's ID: the day it was asked and its first few words, such as
 * "2026-10-12-what-should-i-expect-from", made unique among the job's other questions.
 */
export function askId(question: string, on: string, taken: readonly string[]): string {
  const words = slug(question).split('-').filter(Boolean).slice(0, 6).join('-') || 'question';
  const base = `${on}-${words}`;
  let id = base;
  for (let n = 2; taken.includes(id); n++) id = `${base}-${n}`;
  return id;
}
