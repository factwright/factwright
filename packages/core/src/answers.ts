import { slug } from './keys.ts';
import { markdownTable, sectionHeading } from './markdown.ts';
import type { Ask, SentAnswer } from './tracker.ts';

/** One of Claude's suggested answers, from a job's answers.md. */
export interface SuggestedAnswer {
  question: string;
  /** The answer, as Markdown: for a choice question, the pick. */
  answer: string;
  /** For a choice question, why that pick. */
  why: string | null;
  /** Which run wrote it: each run that adds to answers.md starts with a "# " title of its own. */
  batch: number;
}

/** One question on an application, with Claude's suggestion and what the user actually sent. */
export interface ApplicationAnswer {
  question: string;
  /** For a question the form asks more than once, such as "If yes, please explain", which time. */
  nth: number;
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
 * Whether two different questions are close enough to be one that Claude shortened or the user
 * trimmed: one holds the other, and is most of its length.
 */
function close(a: string, b: string): boolean {
  const [short, long] = a.length < b.length ? [a, b] : [b, a];
  return long.includes(short) && short.length >= long.length * 0.6;
}

/**
 * Claude's suggestions in a job's answers.md: each "## question" with the answer under it, and
 * each row of a table of picks, such as "| Question | Pick | Why |", in order. A "# " title,
 * with the lines under it, starts a run's answers and is no answer itself.
 */
export function readSuggestedAnswers(markdown: string | null | undefined): SuggestedAnswer[] {
  if (!markdown) return [];
  const sections: { heading: string | null; batch: number; lines: string[] }[] = [];
  let batch = 0;
  for (const line of markdown.split(/\r?\n/)) {
    if (/^#\s/.test(line)) {
      batch += 1;
      sections.push({ heading: null, batch, lines: [] });
      continue;
    }
    const heading = sectionHeading(line);
    if (heading !== undefined) sections.push({ heading, batch, lines: [] });
    else sections.at(-1)?.lines.push(line);
  }
  const found: SuggestedAnswer[] = [];
  const add = (question: string, answer: string, why: string | null, at: number) => {
    if (questionKey(question) && answer) found.push({ question, answer, why, batch: at });
  };
  for (const { heading, batch: at, lines } of sections) {
    if (heading === null) continue;
    const text = lines.join('\n').trim();
    const rows = markdownTable(text).filter((row) => row.question?.trim());
    if (rows.length === 0) {
      add(heading, text, null, at);
      continue;
    }
    for (const row of rows) {
      const pick = (row.pick ?? row.answer ?? '').trim();
      add(row.question?.trim() ?? '', pick, row.why?.trim() || null, at);
    }
  }
  return found;
}

/**
 * Every question on a job's application: each one the user pasted, in order, then any others
 * Claude answered or the user recorded an answer for. Each has Claude's suggestion and what the
 * user actually sent. A suggestion or an answer goes to the question with the same words, or a
 * close one when none has them. A later run's suggestion replaces an earlier one, and a question
 * asked twice in one run takes the next box that asks it.
 */
export function applicationAnswers(
  questions: readonly string[],
  suggested: readonly SuggestedAnswer[],
  sent: readonly SentAnswer[],
): ApplicationAnswer[] {
  type Entry = ApplicationAnswer & { key: string; batch: number };
  const entries: Entry[] = [];
  const add = (question: string, nth?: number): Entry | null => {
    const key = questionKey(question);
    if (!key) return null;
    const asked = entries.filter((entry) => entry.key === key).length;
    const entry = {
      question,
      nth: nth ?? asked,
      suggested: null,
      why: null,
      sent: null,
      key,
      batch: -1,
    };
    entries.push(entry);
    return entry;
  };
  const alike = (key: string) => {
    const same = entries.filter((entry) => entry.key === key);
    return same.length > 0 ? same : entries.filter((entry) => close(entry.key, key));
  };
  for (const question of questions) add(question);
  for (const each of suggested) {
    const key = questionKey(each.question);
    const entry = alike(key).find((one) => one.batch < each.batch) ?? add(each.question);
    if (!entry) continue;
    entry.suggested = each.answer;
    entry.why = each.why;
    entry.batch = each.batch;
  }
  for (const each of sent) {
    const key = questionKey(each.question);
    const same = entries.filter((entry) => entry.key === key && !entry.sent);
    const entry =
      same.find((one) => one.nth === each.nth) ??
      (same.length === 0 ? entries.find((one) => !one.sent && close(one.key, key)) : undefined) ??
      add(each.question, each.nth);
    if (entry) entry.sent = each;
  }
  return entries.map(({ key: _key, batch: _batch, ...answer }) => answer);
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

/**
 * A conversation with Claude about a job: the question that started it, then the user's replies
 * to Claude's answers, each a question of its own, in the order they came.
 */
export interface AskThread {
  ask: Ask;
  replies: Ask[];
}

/**
 * A job's questions for Claude as conversations, in the order they started. A reply whose
 * conversation isn't on file anymore, as when another device removed it, shows as a question of
 * its own, so nothing the user said goes missing.
 */
export function askThreads(asks: readonly Ask[]): AskThread[] {
  const byId = new Map(asks.map((ask) => [ask.id, ask]));
  // The question a conversation started with: the first one back with nothing before it on file.
  // A loop, which the app never makes, leaves each question in it as a start of its own.
  const startOf = (ask: Ask): Ask => {
    const seen = new Set([ask.id]);
    let at = ask;
    for (;;) {
      const before = at.thread === undefined ? undefined : byId.get(at.thread);
      if (!before) return at;
      if (seen.has(before.id)) return ask;
      seen.add(before.id);
      at = before;
    }
  };
  const threads = new Map<string, AskThread>();
  for (const ask of asks) {
    if (startOf(ask).id === ask.id) threads.set(ask.id, { ask, replies: [] });
  }
  for (const ask of asks) {
    const start = startOf(ask).id;
    if (start !== ask.id) threads.get(start)?.replies.push(ask);
  }
  return [...threads.values()];
}

/** The conversation a question or reply is in, or null for one that isn't on file. */
export function askThreadOf(asks: readonly Ask[], id: string): AskThread | null {
  return (
    askThreads(asks).find(
      (thread) => thread.ask.id === id || thread.replies.some((reply) => reply.id === id),
    ) ?? null
  );
}
