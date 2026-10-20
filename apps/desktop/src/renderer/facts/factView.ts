import {
  type Asked,
  claimOrigin,
  FACT_TAGS,
  type FactBlock,
  shortDate,
  UNCONFIRMED,
} from '@factwright/core';
import type { Tone } from '@factwright/ui';
import type { FactBank, FactFile } from '../../shared/facts.ts';

/** How a tag reads, and what it means, as facts/README.md defines it. */
export interface TagInfo {
  label: string;
  meaning: string;
  tone: Tone;
}

export const TAG_INFO: Readonly<Record<string, TagInfo>> = {
  [UNCONFIRMED]: {
    label: 'Unverified',
    meaning: 'You haven’t verified it yet, so your Claude asks you before using it.',
    tone: 'amber',
  },
  live: { label: 'Live', meaning: 'In use now: “runs”, “built”, “in production”.', tone: 'green' },
  shipped: {
    label: 'Shipped',
    meaning: 'Released or delivered, maybe to some people only.',
    tone: 'green',
  },
  beta: { label: 'Beta', meaning: 'In a trial, said exactly as the fact says.', tone: 'blue' },
  built: {
    label: 'Built',
    meaning: 'Finished, not released: “built”, never “launched”.',
    tone: 'blue',
  },
  'in-progress': { label: 'In progress', meaning: '“Building” or “leading”.', tone: 'violet' },
  'pre-launch': {
    label: 'Pre-launch',
    meaning: 'A side project that isn’t public yet.',
    tone: 'violet',
  },
  'plan-only': { label: 'Plan only', meaning: 'Never claimed.', tone: 'gray' },
  solo: {
    label: 'Solo',
    meaning: 'You did it alone. Help from tools still counts.',
    tone: 'slate',
  },
  'led-and-built': {
    label: 'Led and built',
    meaning: 'You did the core of it and led others.',
    tone: 'slate',
  },
  'took-over': {
    label: 'Took over',
    meaning: 'You inherited it, then rebuilt or finished it. Never “from scratch”.',
    tone: 'slate',
  },
  'led-team': {
    label: 'Led the team',
    meaning: 'Your team did it: “led the team that delivered”.',
    tone: 'slate',
  },
  high: { label: 'High confidence', meaning: 'Used as written.', tone: 'teal' },
  medium: {
    label: 'Medium confidence',
    meaning: 'Hedged with “about” or “~”, and kept out of headline numbers.',
    tone: 'amber',
  },
  low: { label: 'Low confidence', meaning: 'Your Claude asks you before using it.', tone: 'red' },
};

/** A tag as it reads, or as written when it's one of the user's own. */
export const tagInfo = (tag: string): TagInfo =>
  TAG_INFO[tag] ?? { label: tag, meaning: '', tone: 'gray' };

export const isClaim = (block: FactBlock) => block.tags !== null;

export const isUnconfirmed = (block: FactBlock) => block.tags?.includes(UNCONFIRMED) ?? false;

/** Whether a block has anything to show: text before a file's first heading can be blank. */
export const hasContent = (block: FactBlock) => block.level > 0 || block.body.trim() !== '';

/** A block's key on the page, from its file and its place in it. */
export const blockKey = (path: string, block: Pick<FactBlock, 'index'>) => `${path}#${block.index}`;

/** How many claims the bank has, how many wait to be confirmed, and in how many files. */
export function bankCounts(bank: FactBank): { claims: number; unconfirmed: number; files: number } {
  const files = bank.files.filter((file) => file.kind === 'claims');
  const claims = files.flatMap((file) => file.blocks.filter(isClaim));
  return {
    claims: claims.length,
    unconfirmed: claims.filter(isUnconfirmed).length,
    files: files.length,
  };
}

/**
 * Whether a block has every word searched for, in any order: in its title, its text, or what
 * its tags read as, such as "Led and built". A file's own title doesn't count, as the file's
 * name heads what's found in it anyway: only what its opening says.
 */
export function blockMatches(block: FactBlock, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const labels = (block.tags ?? []).map((tag) => tagInfo(tag).label);
  const text = (block.level === 1 ? [block.body] : [block.title, block.text, ...labels])
    .join('\n')
    .toLowerCase();
  return words.every((word) => text.includes(word));
}

/** The blocks of one file that a search shows. */
export interface FoundIn {
  file: FactFile;
  blocks: FactBlock[];
}

/**
 * What a search finds, file by file. A block `keep` names stays either way, such as one being
 * changed, whose new words may not match.
 */
export function findFacts(
  bank: FactBank,
  { query, keep }: { query: string; keep?: (path: string, block: FactBlock) => boolean },
): FoundIn[] {
  return bank.files
    .map((file) => ({
      file,
      blocks: file.blocks.filter(
        (block) =>
          hasContent(block) && (blockMatches(block, query) || (keep?.(file.path, block) ?? false)),
      ),
    }))
    .filter((found) => found.blocks.length > 0);
}

/** A claim that waits for the user to verify it, with the file it's in. */
export interface Unverified {
  file: FactFile;
  block: FactBlock;
}

/**
 * Every claim that waits for the user to verify it: the ones from their answers first, newest
 * first (on the same day, the one filed later, which goes after the others), then the ones
 * drafted from their files, in the order the files list them.
 */
export function unverifiedFacts(bank: FactBank): Unverified[] {
  const all = bank.files
    .filter((file) => file.kind === 'claims')
    .flatMap((file) => file.blocks.filter(isUnconfirmed).map((block) => ({ file, block })));
  const answered = (each: Unverified) => {
    const origin = claimOrigin(each.block);
    return origin?.kind === 'answer' ? origin.date : '';
  };
  return all
    .map((each, order) => ({ each, order, date: answered(each) }))
    .sort(
      (a, b) => b.date.localeCompare(a.date) || (a.date ? b.order - a.order : a.order - b.order),
    )
    .map(({ each }) => each);
}

/** Where a claim came from, in a line for the user, and the questions it rests on. */
export interface OriginView {
  text: string;
  asked: Asked[];
}

const SHARED_WORDS = {
  resume: 'your resume',
  notes: 'your notes',
  linkedin: 'your LinkedIn',
  screenshot: 'a screenshot',
  profile: 'Beyond work in your Profile',
} as const;

/**
 * Where a claim came from, for the user: "Your answer while tailoring a resume for Acme, Oct 14",
 * "From your resume alex.pdf, Oct 12", or its Source as written. Null when it gives none.
 */
export function originOf(block: FactBlock, today: string): OriginView | null {
  const origin = claimOrigin(block);
  if (!origin) return null;
  if (origin.kind === 'answer') {
    const when = shortDate(origin.date, today);
    return {
      text: origin.context
        ? `Your answer while ${origin.context}, ${when}`
        : `Your answer, ${when}`,
      asked: origin.asked,
    };
  }
  if (origin.kind === 'shared') {
    const what = SHARED_WORDS[origin.what];
    const file = origin.what === 'resume' && origin.file ? ` ${origin.file}` : '';
    const when = origin.date ? `, ${shortDate(origin.date, today)}` : '';
    return { text: `From ${what}${file}${when}`, asked: [] };
  }
  return { text: `Source: ${origin.text}`, asked: [] };
}

/** A claim's details without where it came from, which shows on its own line. */
export const detailsWithoutOrigin = (details: string) =>
  details
    .split(/\r?\n/)
    .filter((line) => !/^\s*[-*+]\s+\*\*(?:Source|Question|Answer):\*\*/.test(line))
    .join('\n')
    .trim();

/** The tags a claim picks from each list, such as its status: the first of each it has. */
export interface TagPicks {
  status: string;
  ownership: string;
  confidence: string;
}

export function picksOf(tags: readonly string[]): TagPicks {
  const first = (list: readonly string[]) => tags.find((tag) => list.includes(tag)) ?? '';
  return {
    status: first(FACT_TAGS.status),
    ownership: first(FACT_TAGS.ownership),
    confidence: first(FACT_TAGS.confidence),
  };
}

/**
 * A claim's tags with new picks, in the format's order: `unconfirmed` when it had it, then its
 * status, ownership and confidence, then any others it had. Unchanged picks keep its tags as
 * they were, order and all.
 */
export function tagsWith(tags: readonly string[], picks: TagPicks): string[] {
  const was = picksOf(tags);
  if (
    was.status === picks.status &&
    was.ownership === picks.ownership &&
    was.confidence === picks.confidence
  ) {
    return [...tags];
  }
  const replaced = new Set([UNCONFIRMED, was.status, was.ownership, was.confidence]);
  return [
    ...(tags.includes(UNCONFIRMED) ? [UNCONFIRMED] : []),
    ...[picks.status, picks.ownership, picks.confidence].filter(Boolean),
    ...tags.filter((tag) => !replaced.has(tag)),
  ];
}

/** "1 fact", "12 facts". */
export const factCount = (count: number) => (count === 1 ? '1 fact' : `${count} facts`);
