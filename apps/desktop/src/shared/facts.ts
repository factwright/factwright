import {
  addClaim,
  confirmClaim,
  type FactBlock,
  factBlocks,
  findBlock,
  leavesCodeOpen,
  removeBlock,
  replaceBlock,
} from '@factwright/core';

/** How much of the fact bank the app shows and changes. Anything bigger stays as it is. */
export const FACT_LIMITS = {
  /** One block's new text: a claim, or a section such as what never to claim. */
  block: 50_000,
  /** One file. The biggest a skill writes is far smaller. */
  file: 2_000_000,
  /** How many files the page shows. */
  files: 500,
  /** A heading. */
  title: 300,
} as const;

/** What a file in facts/ holds: claims, what the user doesn't have, or how the bank works. */
export type FactFileKind = 'claims' | 'gaps' | 'guide';

/** The files that explain the bank, or list what the user doesn't have, rather than hold claims. */
const NOT_CLAIMS: Readonly<Record<string, FactFileKind>> = {
  'facts/README.md': 'guide',
  'facts/gaps.md': 'gaps',
};

export const factFileKind = (path: string): FactFileKind => NOT_CLAIMS[path] ?? 'claims';

/** One file of the fact bank, as the window shows it. */
export interface FactFile {
  /** Where it is in the workspace, such as "facts/acme-health.md". */
  path: string;
  /** Its first heading, or its name when it has none. */
  title: string;
  kind: FactFileKind;
  blocks: FactBlock[];
}

/** The fact bank, file by file. */
export interface FactBank {
  files: FactFile[];
  /** Files left out, too big to show or past how many the page shows. */
  skipped: string[];
  /** The user's first name, which a fact they add or confirm gives as its source. */
  firstName: string | null;
}

/** A block of a file as the window last read it, to change, delete or confirm. */
export interface FactTarget {
  path: string;
  index: number;
  text: string;
}

/** New text for a block. */
export interface FactChange extends FactTarget {
  next: string;
}

/** A claim to add to a file. */
export interface NewFact {
  path: string;
  text: string;
}

/**
 * The bank as it is after a change, or what stopped it: `changed` when the block changed since
 * the window read it, such as by Claude or another computer.
 */
export type FactResult =
  | { ok: true; bank: FactBank }
  | { ok: false; message: string; changed?: true };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Text up to a length, without control characters other than tabs and line breaks. */
const isText = (value: unknown, max: number): value is string =>
  typeof value === 'string' &&
  value.length <= max &&
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what it refuses.
  !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);

/**
 * A Markdown file in facts/, such as "facts/proven/ai.md": folders and a name any computer can
 * hold, none of them hidden, and no way out of the folder.
 */
export function isFactPath(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 300) return false;
  const parts = value.split('/');
  return (
    parts.length >= 2 &&
    parts[0] === 'facts' &&
    /\.md$/i.test(value) &&
    parts.slice(1).every(
      (part) =>
        part !== '' &&
        !part.startsWith('.') &&
        part.trim() === part &&
        // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what it refuses.
        !/[\\:*?"<>|\u0000-\u001f]/.test(part),
    )
  );
}

export function parseFactTarget(value: unknown): FactTarget | null {
  if (!isRecord(value)) return null;
  const { path, index, text } = value;
  return isFactPath(path) &&
    typeof index === 'number' &&
    Number.isInteger(index) &&
    index >= 0 &&
    isText(text, FACT_LIMITS.file)
    ? { path, index, text }
    : null;
}

export function parseFactChange(value: unknown): FactChange | null {
  const target = parseFactTarget(value);
  const next = isRecord(value) ? value.next : undefined;
  return target && isText(next, FACT_LIMITS.block) && next.trim() ? { ...target, next } : null;
}

export function parseNewFact(value: unknown): NewFact | null {
  if (!isRecord(value)) return null;
  const { path, text } = value;
  return isFactPath(path) && isText(text, FACT_LIMITS.block) && text.trim() ? { path, text } : null;
}

/**
 * What's wrong with new text for a block, in plain words, or null when it fits: one heading at
 * the block's level and what's under it, every code block closed, and for a claim, its tags.
 */
export function blockProblem(
  next: string,
  level: FactBlock['level'],
  { claim }: { claim: boolean },
): string | null {
  if (leavesCodeOpen(next))
    return 'A code block (```) is left open. Close it on a line of its own.';
  const [first, ...more] = factBlocks(next);
  if (!first) return 'It can’t be empty.';
  if (first.level !== level) {
    return level === 0 ? 'Headings (lines starting with #) can’t go here.' : 'It needs a title.';
  }
  if (first.title.length > FACT_LIMITS.title) return 'The title is too long.';
  if (more.length > 0) {
    return 'Headings (lines starting with #) can’t go inside it. Add another fact for that.';
  }
  if (claim && !first.tags) return 'A fact needs its status, such as live or shipped.';
  return null;
}

/** Where a file goes in the list: the profile, the jobs, then projects, skills, gaps and the guide. */
const ORDER: Readonly<Record<string, number>> = {
  'facts/profile.md': 0,
  'facts/projects.md': 2,
  'facts/skills.md': 3,
  'facts/gaps.md': 4,
  'facts/README.md': 5,
};

/** Fact bank files in the order the page lists them. */
export const inFactOrder = (paths: readonly string[]): string[] =>
  [...paths].sort((a, b) => (ORDER[a] ?? 1) - (ORDER[b] ?? 1) || a.localeCompare(b));

/** A file's name as a title, for a file without a heading: "earlier-roles.md" is "Earlier roles". */
function titleFromName(path: string): string {
  const name = (path.split('/').at(-1) ?? path).replace(/\.md$/i, '').replace(/[-_]+/g, ' ').trim();
  return name ? `${name[0]?.toUpperCase()}${name.slice(1)}` : path;
}

/** A fact bank file as the page shows it, from its path and text. */
export function factFile(path: string, text: string): FactFile {
  const kind = factFileKind(path);
  const blocks = factBlocks(text, { claims: kind === 'claims' });
  const title = blocks.find((block) => block.level === 1)?.title ?? titleFromName(path);
  return { path, title, kind, blocks };
}

/** The first word of the user's name, which a fact they add or confirm gives as its source. */
export const firstNameOf = (name: string): string | null => name.trim().split(/\s+/)[0] || null;

/** What a block that changed since the window read it says, such as one Claude just changed. */
export const CHANGED_SINCE =
  'This changed since you opened it, maybe by your Claude or another computer. It shows as it is now: make your change again.';

/** A file's new text after a change, or what stopped it. */
export type FactEdit = string | { problem: string };

/** The block a change is for, as the window last read it, or what to say when it changed. */
function blockFor(file: string, kind: FactFileKind, at: { index: number; text: string }) {
  return findBlock(factBlocks(file, { claims: kind === 'claims' }), at);
}

/** A file with a block given new text: a claim or a section, at its own heading's level. */
export function withChange(file: string, kind: FactFileKind, change: FactChange): FactEdit {
  const block = blockFor(file, kind, change);
  if (!block) return { problem: CHANGED_SINCE };
  const problem = blockProblem(change.next, block.level, { claim: block.tags !== null });
  return problem
    ? { problem }
    : (replaceBlock(file, block, change.next) ?? { problem: CHANGED_SINCE });
}

/** A file of claims with a new one after its last. */
export function withClaim(file: string, kind: FactFileKind, text: string): FactEdit {
  if (kind !== 'claims') return { problem: 'Facts go in one of your files of facts.' };
  const problem = blockProblem(text, 3, { claim: true });
  return problem ? { problem } : addClaim(file, text);
}

/** A file without a claim. Sections stay: their words can be changed, or cleared. */
export function withoutClaim(file: string, kind: FactFileKind, target: FactTarget): FactEdit {
  const block = blockFor(file, kind, target);
  if (!block) return { problem: CHANGED_SINCE };
  if (!block.tags) return { problem: 'Only a fact can be deleted here.' };
  return removeBlock(file, block) ?? { problem: CHANGED_SINCE };
}

/**
 * A file with a claim drafted from the user's files confirmed: it loses `unconfirmed`, and its
 * source becomes the user and the date, such as "Alex 2026-10-12".
 */
export function withConfirmed(
  file: string,
  kind: FactFileKind,
  target: FactTarget,
  source: string,
): FactEdit {
  const block = blockFor(file, kind, target);
  if (!block) return { problem: CHANGED_SINCE };
  const confirmed = confirmClaim(block.text, source);
  if (!confirmed) return { problem: 'That fact is already confirmed.' };
  return replaceBlock(file, block, confirmed) ?? { problem: CHANGED_SINCE };
}

/** The answer to the window for a change that was stopped. */
export const stopped = (problem: string): FactResult =>
  problem === CHANGED_SINCE
    ? { ok: false, message: problem, changed: true }
    : { ok: false, message: problem };
