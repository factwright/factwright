import { firstDate } from './dates.ts';
import { type ListItem, markdownItems, markdownSections } from './markdown.ts';

/** The four parts of a fit score: the work itself, the role's shape, the tech stack, and the must-haves. */
export const SCORE_PARTS = ['work', 'role', 'stack', 'reqs'] as const;

export type ScorePartKey = (typeof SCORE_PARTS)[number];

/** How well the user's facts cover one piece of the job's work. */
export type EvidenceMark = 'yes' | 'part' | 'no';

export interface Evidence {
  mark: EvidenceMark | null;
  text: string;
}

export interface ScorePart {
  key: ScorePartKey;
  points: number;
  max: number;
  /** The reason for the points, in a sentence. */
  why: string | null;
  /** For the work part: each piece of the job's core work, marked proven, partly or missing. */
  items: Evidence[];
}

/** What people say about working at the company, from reviews, talk and news. */
export type Mood = 'loved' | 'liked' | 'mixed' | 'disliked' | 'hated' | 'thin' | 'skipped';

export interface Sentiment {
  date: string | null;
  from: 'fit-check' | 'job-notes';
  mood: Mood | null;
  summary: string | null;
  points: ListItem[];
}

/** A fit check's write-up, read from its fit-check.md. */
export interface FitReport {
  date: string | null;
  /** Such as "Strong". */
  verdict: string | null;
  total: number | null;
  /** The score's parts, in order, or null when the write-up only gave the total. */
  parts: ScorePart[] | null;
  /** Whether the job passed the user's hard filters, such as pay or location. */
  filters: { pass: boolean; text: string; details: string[] } | null;
  why: ListItem[];
  gaps: ListItem[];
  /** Things to watch for. */
  flags: ListItem[];
  sentiment: Sentiment | null;
}

const PART_NAMES: Readonly<Record<string, ScorePartKey>> = {
  work: 'work',
  role: 'role',
  stack: 'stack',
  req: 'reqs',
  reqs: 'reqs',
  requirements: 'reqs',
};

/** A part as fit checks write it: "work 33/40", "Role shape: 15/25" or "reqs 15 / 15". */
const PART = String.raw`(work|role|stack|reqs?|requirements)(?:\s+(?:match|shape))?\s*:?\s*(\d{1,3})\s*\/\s*(\d{1,3})`;

const MOODS: Readonly<Record<string, Mood>> = {
  loved: 'loved',
  liked: 'liked',
  mixed: 'mixed',
  disliked: 'disliked',
  hated: 'hated',
  'thin data': 'thin',
  'not enough data': 'thin',
  skipped: 'skipped',
};

const MOOD_START =
  /^(loved|liked|mixed|disliked|hated|thin data|not enough data|skipped)\b[\s.:;,–—-]*/i;

/** Marks at the start of an evidence line. "~" needs a space after it, so "~8.5 years" stays text. */
const MARKS: readonly (readonly [RegExp, EvidenceMark])[] = [
  [/^(?:✓|✔|✅|☑)️?\s*|^yes\s*[:–—-]\s*/i, 'yes'],
  [/^(?:~|≈|◐)\s+|^partly\s*[:–—-]\s*|^partial\s*[:–—-]\s*/i, 'part'],
  [/^(?:✗|✘|❌)️?\s*|^×\s+|^(?:no|none|missing)\s*[:–—-]\s*/i, 'no'],
];

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** Drops a bold label such as "**Overall:**" from the start of a line. */
const dropLabel = (text: string) => text.replace(/^\*\*[^*]+?:\*\*\s*/, '');

/** A "- **Name:** value" line's value. */
function field(text: string, name: string): string | null {
  return text.match(new RegExp(`^- \\*\\*${name}:\\*\\*\\s*(.+)$`, 'mi'))?.[1]?.trim() ?? null;
}

/** Reads a verdict and score written as "Strong, 82". */
export function parseVerdict(
  text: string | null | undefined,
): { verdict: string; score: number } | null {
  // The verdict ends on a letter, so the spaces before the comma can only be read one way.
  const match = text?.match(/^\s*([A-Za-z](?:[A-Za-z ]*[A-Za-z])?)\s*,\s*(\d+)/);
  if (!match?.[1] || !match[2]) return null;
  return { verdict: match[1], score: Number(match[2]) };
}

function partsFrom(text: string | null): Map<ScorePartKey, ScorePart> {
  const parts = new Map<ScorePartKey, ScorePart>();
  for (const match of (text ?? '').matchAll(new RegExp(`\\b${PART}`, 'gi'))) {
    const key = PART_NAMES[(match[1] ?? '').toLowerCase()];
    if (!key || parts.has(key)) continue;
    parts.set(key, { key, points: Number(match[2]), max: Number(match[3]), why: null, items: [] });
  }
  return parts;
}

function markEvidence(text: string): Evidence {
  for (const [pattern, mark] of MARKS) {
    const match = text.match(pattern);
    if (match) return { mark, text: text.slice(match[0].length).trim() };
  }
  return { mark: null, text };
}

function moodOf(text: string): { mood: Mood | null; text: string | null } {
  const match = text.match(MOOD_START);
  if (!match?.[1]) return { mood: null, text: text.trim() || null };
  const rest = text.slice(match[0].length).trim();
  return { mood: MOODS[match[1].toLowerCase()] ?? null, text: rest ? capitalize(rest) : null };
}

function sentimentFrom(title: string, items: ListItem[], date: string | null): Sentiment | null {
  const first = items[0];
  if (!first) return null;
  const base = { date: firstDate(title) ?? date, from: 'fit-check' as const };
  const overall = items.findIndex((item) => /^\*\*(overall|mood)\s*:?\*\*/i.test(item.text));
  const overallItem = items[overall];
  if (overallItem) {
    const { mood, text } = moodOf(
      overallItem.text.replace(/^\*\*(?:overall|mood)\s*:?\*\*\s*:?\s*/i, ''),
    );
    return { ...base, mood, summary: text, points: items.filter((_, i) => i !== overall) };
  }
  // Write-ups from before the Overall line lead with "thin data" or "Skipped" when there's little to say.
  const lead = moodOf(dropLabel(first.text));
  return lead.mood
    ? { ...base, mood: lead.mood, summary: lead.text, points: items.slice(1) }
    : { ...base, mood: null, summary: null, points: items };
}

/**
 * Reads a fit check's write-up: the verdict, the score's parts with their reasons and evidence,
 * the filters, why it fits, the gaps, what to watch for, and what people say about the company.
 */
export function parseFitReport(text: string | null | undefined): FitReport | null {
  if (!text) return null;
  const sections = markdownSections(text);
  const sectionKey = (test: (key: string) => boolean) =>
    [...sections.keys()].find((key) => key && test(key));
  const list = (test: (key: string) => boolean) => {
    const key = sectionKey(test);
    return key === undefined ? [] : markdownItems(sections.get(key)?.lines ?? []);
  };

  const verdictLine = field(text, 'Verdict');
  const head = parseVerdict(verdictLine);
  const date = firstDate(field(text, 'Date'));

  const parts = partsFrom(verdictLine);
  const scoreLine = new RegExp(`^${PART}\\s*[:.–—-]?\\s*(.*)$`, 'i');
  for (const item of list((key) => key.startsWith('score'))) {
    const match = item.text.replace(/\*\*/g, '').match(scoreLine);
    const key = PART_NAMES[(match?.[1] ?? '').toLowerCase()];
    if (!match || !key) continue;
    const why = (match[4] ?? '').trim();
    parts.set(key, {
      key,
      points: Number(match[2]),
      max: Number(match[3]),
      why: why ? capitalize(why) : null,
      items: item.sub.map(markEvidence),
    });
  }
  const ordered = SCORE_PARTS.flatMap((key) => parts.get(key) ?? []);

  const filters = markdownItems(sections.get('')?.lines ?? []).find((item) =>
    /^\*\*Filters:\*\*/i.test(item.text),
  );
  const filterText = filters ? dropLabel(filters.text) : '';
  const sentimentKey = sectionKey((key) => key.includes('sentiment'));
  const sentimentSection = sentimentKey === undefined ? undefined : sections.get(sentimentKey);

  return {
    date,
    verdict: head?.verdict ?? null,
    total: head?.score ?? null,
    parts: ordered.length > 0 ? ordered : null,
    filters: filters
      ? { pass: /^pass\b/i.test(filterText), text: filterText, details: filters.sub }
      : null,
    why: list((key) => key.startsWith('why')),
    gaps: list((key) => key.startsWith('gap')),
    flags: list((key) => key.startsWith('flag') || key.startsWith('watch')),
    sentiment: sentimentSection
      ? sentimentFrom(sentimentSection.title, markdownItems(sentimentSection.lines), date)
      : null,
  };
}

/** Older job notes (job.md) carry one "- **Sentiment (fit check, 2026-10-06):** …" line. */
export function jobNotesSentiment(text: string | null | undefined): Sentiment | null {
  // The "(…)" is read to at most 200 characters, and the text starts at its first visible one, so
  // a "(" left open, or a long run of spaces, isn't read again and again. A line with no text
  // after it has no sentiment.
  const match = text?.match(/^- \*\*Sentiment(?:\s*\(([^)]{0,200})\))?:\*\*\s*(\S.*)$/im);
  if (!match?.[2]) return null;
  const { mood, text: summary } = moodOf(match[2]);
  return { date: firstDate(match[1]), from: 'job-notes', mood, summary, points: [] };
}
