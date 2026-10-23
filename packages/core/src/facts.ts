/**
 * The fact bank, read the way the skills write it (facts/README.md): Markdown files where each
 * claim is a "### " heading, then its tags in backticks, its resume wording as a "> " quote, and
 * its details. Each heading starts a block that runs to the next one, so one claim or section can
 * be shown, changed or deleted while the rest of its file stays exactly as written.
 */

/** One heading of level 1 to 3 and the lines under it, up to the next such heading. */
export interface FactBlock {
  /** Which block of its file it is, from 0. */
  index: number;
  /** The heading's level, 1 to 3, or 0 for text before a file's first heading. */
  level: 0 | 1 | 2 | 3;
  /** The heading's words, without its #s: empty for text before the first heading. */
  title: string;
  /** The block exactly as written, from its heading to the blank lines before the next one. */
  text: string;
  /** A claim's tags in order, such as ["live", "solo", "high"], or null for any other block. */
  tags: string[] | null;
  /** What's under the heading, less a claim's tags, without blank lines around it. */
  body: string;
}

/** The tags a claim can have, by what they say about it, as facts/README.md defines them. */
export const FACT_TAGS = {
  status: ['live', 'shipped', 'beta', 'built', 'in-progress', 'pre-launch', 'plan-only'],
  ownership: ['solo', 'led-and-built', 'took-over', 'led-team'],
  confidence: ['high', 'medium', 'low'],
} as const;

/** The tag, first among a claim's tags, on one drafted from the user's files and not checked. */
export const UNCONFIRMED = 'unconfirmed';

// Every pattern here takes time in step with the line it reads, so no line, however long, stalls
// the app: none has a run of repeats that can match the same text two ways.
const HEADING = /^(#{1,3})[ \t]+(\S.*)$/;
/** A code block's opening: three or more backticks with no backtick after them, or tildes. */
const FENCE_OPEN = /^( {0,3})(`{3,}(?=[^`]*$)|~{3,})/;
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;
/** A claim's tags line starts with one, as the profile's count of facts reads them. */
const TAGGED = /^`[a-z-]+`/;
/** The tags at the start of a line: words in backticks with spaces between. */
const TAG_RUN = /^(?:`[^`\n]+`[ \t]*)+/;
const QUOTE = /^ {0,3}>/;
const SOURCE = /^(\s*[-*+][ \t]+\*\*Source:\*\*)[ \t]*(.*)$/;
/** A list item or quote, which can follow a quote with no blank line and not run into it. */
const OWN_BLOCK = /^\s*(?:[-*+]|\d+[.)])[ \t]/;

/** The text's lines, each with its line ending, so joining them gives the text back. */
const linesOf = (text: string): string[] => text.match(/[^\n]*\n|[^\n]+$/g) ?? [];

/** A line without its ending. */
const bare = (line: string) => line.replace(/\r?\n$/, '');

/** The line endings and blank lines at the end of a block, which keep it apart from the next. */
function trailingOf(text: string): string {
  let end = text.length;
  while (end > 0 && ' \t\r\n'.includes(text[end - 1] ?? '')) end--;
  // They start with the ending of the block's last line with words on it.
  const newline = text.indexOf('\n', end);
  if (newline < 0) return '';
  return text.slice(text[newline - 1] === '\r' && newline - 1 >= end ? newline - 1 : newline);
}

/** The line ending a file mostly uses: Windows's, or "\n". */
function endingOf(text: string): string {
  const windows = text.split('\r\n').length - 1;
  return windows > text.split('\n').length - 1 - windows ? '\r\n' : '\n';
}

/** Text with its line endings made the file's own. */
const withEnding = (text: string, ending: string) => text.replace(/\r?\n/g, ending);

/** Lines with the blank ones at either end left off. */
function trimBlank(lines: readonly string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && !(lines[start] ?? '').trim()) start++;
  while (end > start && !(lines[end - 1] ?? '').trim()) end--;
  return lines.slice(start, end);
}

/** The tags at the start of a line, and anything after them. */
function tagsOf(line: string): { tags: string[]; note: string } {
  const run = line.match(TAG_RUN)?.[0] ?? '';
  return {
    tags: [...run.matchAll(/`([^`\n]+)`/g)].map((match) => match[1] ?? ''),
    note: line.slice(run.length).trim(),
  };
}

/** A code block that's open: its fence, and how far its opening line was indented. */
interface Fence {
  mark: string;
  indent: number;
}

/** One line of a file, as read: whether it's inside a code block, and its heading if it's one. */
interface Scanned {
  /** The line with its ending. */
  line: string;
  /** The line without its ending. */
  content: string;
  heading: { level: 1 | 2 | 3; title: string } | null;
  inCode: boolean;
}

/**
 * Reads a file line by line, keeping track of code blocks, so a heading in a format example
 * isn't taken for one of the file's own. A byte-order mark before the first line is passed over.
 * A heading at the margin ends a code block indented under a list item, as the item ends there.
 * Says, too, whether the text leaves a code block open.
 */
function scan(text: string): { lines: Scanned[]; open: boolean } {
  const lines: Scanned[] = [];
  let fence: Fence | null = null;
  for (const [i, line] of linesOf(text).entries()) {
    const content = bare(line);
    const match = (i === 0 ? content.replace(/^﻿/, '') : content).match(HEADING);
    const heading = match
      ? { level: (match[1]?.length ?? 1) as 1 | 2 | 3, title: (match[2] ?? '').trimEnd() }
      : null;
    const inCode = fence !== null && !(fence.indent > 0 && heading);
    lines.push({ line, content, heading: inCode ? null : heading, inCode });
    if (inCode && fence) {
      const close = content.match(FENCE_CLOSE)?.[1];
      if (close && close[0] === fence.mark[0] && close.length >= fence.mark.length) fence = null;
    } else {
      const open = heading ? null : content.match(FENCE_OPEN);
      fence = open ? { mark: open[2] ?? '', indent: open[1]?.length ?? 0 } : null;
    }
  }
  return { lines, open: fence !== null };
}

/** Whether text leaves a code block open, which would swallow the headings after it. */
export const leavesCodeOpen = (text: string): boolean => scan(text).open;

/**
 * A fact bank file's blocks, in order. Headings inside code blocks, such as a format example,
 * stay part of their block. With `claims` false, as for the bank's gaps and its own README, no
 * block counts as a claim.
 */
export function factBlocks(text: string, { claims = true } = {}): FactBlock[] {
  const raw: { level: FactBlock['level']; title: string; lines: string[] }[] = [];
  let current: (typeof raw)[number] = { level: 0, title: '', lines: [] };
  for (const { line, heading } of scan(text).lines) {
    if (heading) {
      if (current.lines.length > 0) raw.push(current);
      current = { level: heading.level, title: heading.title, lines: [line] };
    } else {
      current.lines.push(line);
    }
  }
  if (current.lines.length > 0) raw.push(current);

  return raw.map(({ level, title, lines }, index) => {
    const under = (level === 0 ? lines : lines.slice(1)).map(bare);
    const first = under.findIndex((line) => line.trim() !== '');
    const tagLine = first >= 0 ? (under[first] ?? '').trim() : '';
    const isClaim = claims && level === 3 && TAGGED.test(tagLine);
    const body = isClaim ? under.slice(first + 1) : under;
    return {
      index,
      level,
      title,
      text: lines.join(''),
      tags: isClaim ? tagsOf(tagLine).tags : null,
      body: trimBlank(body).join('\n'),
    };
  });
}

/** A block as the window last saw it, to change or delete. */
export interface BlockAt {
  index: number;
  text: string;
  /**
   * Whether no other block in the file read the same when the window saw it. Only then can a
   * block that moved be found by its text: one of two copies could be the wrong one.
   */
  unique?: boolean | undefined;
}

/** Whether two blocks say the same, whatever blank lines follow them. */
export const sameBlock = (a: string, b: string) => a.trimEnd() === b.trimEnd();

/**
 * The block a change is for, if it still reads as it did: where it was, or else, for a block the
 * window saw only one of, the one block in the file that reads the same. Null when it changed,
 * went, or can't be told apart from another.
 */
export function findBlock(blocks: readonly FactBlock[], at: BlockAt): FactBlock | null {
  const there = blocks[at.index];
  if (there && sameBlock(there.text, at.text)) return there;
  if (!at.unique) return null;
  const alike = blocks.filter((block) => sameBlock(block.text, at.text));
  return alike.length === 1 ? (alike[0] ?? null) : null;
}

/**
 * The file with one block replaced by new text, which keeps the block's blank lines after it and
 * the file's line endings. Null when the block isn't there as it was anymore.
 */
export function replaceBlock(file: string, at: BlockAt, next: string): string | null {
  const blocks = factBlocks(file);
  const block = findBlock(blocks, at);
  if (!block) return null;
  const changed = withEnding(next.trimEnd(), endingOf(file)) + trailingOf(block.text);
  return blocks.map((each) => (each === block ? changed : each.text)).join('');
}

/** The file without one block. Null when the block isn't there as it was anymore. */
export function removeBlock(file: string, at: BlockAt): string | null {
  const blocks = factBlocks(file);
  const block = findBlock(blocks, at);
  if (!block) return null;
  return blocks
    .filter((each) => each !== block)
    .map((each) => each.text)
    .join('');
}

/**
 * A section's heading as it's given, such as "## Staff Engineer (03/2022 – Present)": its words,
 * without the #s, on one line.
 */
export const sectionTitle = (heading: string): string =>
  heading
    .replace(/^[ \t]*#{1,6}(?:[ \t]+|$)/, '')
    .replace(/\s+/g, ' ')
    .trim();

/** A heading's words, as a section is found by them, whatever their case, marks and spacing. */
const headingKey = (heading: string) =>
  sectionTitle(heading)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}+#]+/gu, ' ')
    .trim();

/**
 * The `##` section a heading names, such as a role's in a job's file, "Staff Engineer (03/2022 –
 * Present)", whatever its case, marks and spacing: the first, if the file has two. Null when the
 * file has none.
 */
export function findSection(blocks: readonly FactBlock[], heading: string): FactBlock | null {
  const key = headingKey(heading);
  if (!key) return null;
  return blocks.find((block) => block.level === 2 && headingKey(block.title) === key) ?? null;
}

/**
 * The file with a new claim after its last one, so it lands among the others rather than after
 * the file's closing sections, such as what never to claim. A file without claims gets it at the
 * end. With a section, such as a role's in the file of a job where the user held more than one
 * title, it goes after that section's last claim, or at its end. A section the file doesn't have
 * yet starts with it, where the claim would go without one. A blank line keeps it apart from
 * what's around it.
 */
export function addClaim(file: string, claim: string, section?: string | null): string {
  const blocks = factBlocks(file);
  const title = section ? sectionTitle(section) : '';
  const found = title ? findSection(blocks, title) : null;
  // How many of the file's blocks come before it.
  let split: number;
  if (found) {
    let end = found.index + 1;
    while (end < blocks.length && (blocks[end]?.level ?? 0) > 2) end++;
    const last = blocks.slice(found.index + 1, end).findLastIndex((block) => block.tags !== null);
    split = last < 0 ? end : found.index + 2 + last;
  } else {
    const last = blocks.findLastIndex((block) => block.tags !== null);
    split = last < 0 ? blocks.length : last + 1;
  }
  const ending = endingOf(file);
  const before = blocks
    .slice(0, split)
    .map((block) => block.text)
    .join('');
  const after = blocks
    .slice(split)
    .map((block) => block.text)
    .join('');
  const gap =
    before === '' || /\n[ \t]*\r?\n$/.test(before)
      ? ''
      : before.endsWith('\n')
        ? ending
        : ending + ending;
  const text = found || !title ? claim.trimEnd() : `## ${title}\n\n${claim.trimEnd()}`;
  return `${before}${gap}${withEnding(text, ending)}${ending}${after ? ending : ''}${after}`;
}

/**
 * A claim once the user confirms it, as the skills do it: without `unconfirmed`, and with its
 * Source the user and the date, such as "Alex 2026-10-12". Everything else stays as written.
 * Null when it isn't a claim waiting to be confirmed.
 */
export function confirmClaim(text: string, source: string): string | null {
  const [block, ...others] = factBlocks(text);
  if (!block?.tags?.includes(UNCONFIRMED) || others.length > 0) return null;
  const scanned = scan(text).lines;
  const lines = scanned.map((each) => each.line);
  const tagAt = lines.findIndex((line, i) => i > 0 && bare(line).trim() !== '');
  const tagLine = lines[tagAt] ?? '';
  lines[tagAt] =
    bare(tagLine)
      .replace(/`unconfirmed`[ \t]*/g, '')
      .trimEnd() + tagLine.slice(bare(tagLine).length);

  const sourceAt = scanned.findIndex((each) => !each.inCode && SOURCE.test(each.content));
  if (sourceAt >= 0) {
    const line = lines[sourceAt] ?? '';
    // A function, so nothing in the user's name is read as a pattern, such as "$&".
    lines[sourceAt] =
      bare(line).replace(SOURCE, (_, label: string) => `${label} ${source}`) +
      line.slice(bare(line).length);
    return lines.join('');
  }
  // No Source yet: one goes after the claim's last line, before its blank lines.
  return `${lines.join('').trimEnd()}${endingOf(text)}- **Source:** ${source}${trailingOf(text)}`;
}

/** A claim in the parts the window changes, each as written. */
export interface ClaimParts {
  title: string;
  /** Its tags in order, `unconfirmed` included. */
  tags: string[];
  /** Anything after the tags on their line, kept as it was. */
  tagNote: string;
  /** The resume wording: the "> " quote right after the tags, without the "> ". */
  wording: string;
  /** Whether a blank line keeps the details apart from the wording, kept as it was. */
  spaced: boolean;
  /** Everything else under it, as written: Short, Numbers, Keywords, Source and the rest. */
  details: string;
}

/** A claim's parts, to change in a form. */
export function claimParts(block: FactBlock): ClaimParts {
  const under = linesOf(block.text).slice(1).map(bare);
  const tagAt = under.findIndex((line) => line.trim() !== '');
  const { tags, note } = tagsOf((under[tagAt] ?? '').trim());
  const after = under.slice(tagAt + 1);
  const quoteAt = after.findIndex((line) => line.trim() !== '');
  let quoteEnd = quoteAt;
  if (quoteAt >= 0 && QUOTE.test(after[quoteAt] ?? '')) {
    while (quoteEnd < after.length && QUOTE.test(after[quoteEnd] ?? '')) quoteEnd++;
  }
  const quote = after.slice(quoteAt, quoteEnd);
  const rest = quote.length > 0 ? after.slice(quoteEnd) : after;
  return {
    title: block.title,
    tags,
    tagNote: note,
    wording: quote.map((line) => line.replace(/^ {0,3}>[ \t]?/, '')).join('\n'),
    spaced: quote.length > 0 && rest.length > 0 && !(rest[0] ?? '').trim(),
    details: trimBlank(rest).join('\n'),
  };
}

/**
 * A claim's text from its parts, in the format facts/README.md gives. Details that start with
 * a list item follow the wording directly. Anything else gets a blank line first, as it would
 * otherwise run on as part of the quote.
 */
export function claimText(parts: ClaimParts): string {
  const tagLine = [parts.tags.map((tag) => `\`${tag}\``).join(' '), parts.tagNote]
    .filter(Boolean)
    .join(' ');
  const wording = parts.wording.trim()
    ? parts.wording
        .trim()
        .split(/\r?\n/)
        .map((line) => `> ${line}`.trimEnd())
    : [];
  const details = trimBlank(parts.details.split(/\r?\n/)).join('\n');
  const gap = wording.length > 0 && details && (parts.spaced || !OWN_BLOCK.test(details));
  return [
    `### ${parts.title.trim()}`,
    tagLine,
    ...wording,
    ...(gap ? [''] : []),
    ...(details ? [details] : []),
  ].join('\n');
}

/** Any other block in the parts the window changes. */
export interface SectionParts {
  title: string;
  /** Whether a blank line follows the heading, kept as it was. */
  spaced: boolean;
  body: string;
}

/** A section's parts, to change in a form. */
export function sectionParts(block: FactBlock): SectionParts {
  const under = (block.level === 0 ? linesOf(block.text) : linesOf(block.text).slice(1)).map(bare);
  return {
    title: block.title,
    spaced: block.level > 0 && under.length > 1 && !(under[0] ?? '').trim(),
    body: trimBlank(under).join('\n'),
  };
}

/** A section's text from its parts, at its heading's level. */
export function sectionText(level: FactBlock['level'], parts: SectionParts): string {
  const body = trimBlank(parts.body.split(/\r?\n/)).join('\n');
  if (level === 0) return body;
  const heading = `${'#'.repeat(level)} ${parts.title.trim()}`;
  return body ? `${heading}\n${parts.spaced ? '\n' : ''}${body}` : heading;
}
