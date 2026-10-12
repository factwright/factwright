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

const HEADING = /^(#{1,3})[ \t]+(\S.*?)[ \t]*$/;
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;
/** A claim's tags line starts with one, as the profile's count of facts reads them. */
const TAGGED = /^`[a-z-]+`/;
/** The tags at the start of a line: words in backticks with spaces between. */
const TAG_RUN = /^(?:`[^`\n]+`[ \t]*)+/;
const QUOTE = /^ {0,3}>/;
const SOURCE = /^(\s*[-*+][ \t]+\*\*Source:\*\*)[ \t]*(.*)$/;

/** The text's lines, each with its line ending, so joining them gives the text back. */
const linesOf = (text: string): string[] => text.match(/[^\n]*\n|[^\n]+$/g) ?? [];

/** A line without its ending. */
const bare = (line: string) => line.replace(/\r?\n$/, '');

/** The line endings and blank lines at the end of a block, which keep it apart from the next. */
const trailingOf = (text: string) => text.match(/(?:\r?\n[ \t]*)*$/)?.[0] ?? '';

/** The line ending a file uses: Windows's when it has any, otherwise "\n". */
const endingOf = (text: string) => (text.includes('\r\n') ? '\r\n' : '\n');

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

/** Whether a line opens a code block, or closes the one `fence` opened. */
function fenceAt(line: string, fence: string | null): string | null {
  if (fence) {
    const close = line.match(FENCE_CLOSE)?.[1];
    return close && close[0] === fence[0] && close.length >= fence.length ? null : fence;
  }
  return line.match(FENCE_OPEN)?.[1] ?? null;
}

/** Whether text leaves a code block open, which would swallow the headings after it. */
export function leavesCodeOpen(text: string): boolean {
  let fence: string | null = null;
  for (const line of linesOf(text)) fence = fenceAt(bare(line), fence);
  return fence !== null;
}

/**
 * A fact bank file's blocks, in order. Headings inside code blocks, such as a format example,
 * stay part of their block. With `claims` false, as for the bank's gaps and its own README, no
 * block counts as a claim.
 */
export function factBlocks(text: string, { claims = true } = {}): FactBlock[] {
  const raw: { level: FactBlock['level']; title: string; lines: string[] }[] = [];
  let current: (typeof raw)[number] = { level: 0, title: '', lines: [] };
  let fence: string | null = null;
  for (const line of linesOf(text)) {
    const content = bare(line);
    const heading = fence === null ? content.match(HEADING) : null;
    fence = fenceAt(content, fence);
    if (heading) {
      if (current.lines.length > 0) raw.push(current);
      const level = (heading[1]?.length ?? 1) as 1 | 2 | 3;
      current = { level, title: heading[2] ?? '', lines: [line] };
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
}

/** Whether two blocks say the same, whatever blank lines follow them. */
const sameBlock = (a: string, b: string) => a.trimEnd() === b.trimEnd();

/**
 * The block a change is for, if it still reads as it did: where it was, or else the one block in
 * the file that reads the same. Null when it changed, went, or reads like another one.
 */
export function findBlock(blocks: readonly FactBlock[], at: BlockAt): FactBlock | null {
  const there = blocks[at.index];
  if (there && sameBlock(there.text, at.text)) return there;
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
 * The file with a new claim after its last one, so it lands among the others rather than after
 * the file's closing sections, such as what never to claim. A file without claims gets it at the
 * end. A blank line keeps it apart from what's around it.
 */
export function addClaim(file: string, claim: string): string {
  const blocks = factBlocks(file);
  const last = blocks.findLastIndex((block) => block.tags !== null);
  const ending = endingOf(file);
  const before =
    last < 0
      ? file
      : blocks
          .slice(0, last + 1)
          .map((block) => block.text)
          .join('');
  const after =
    last < 0
      ? ''
      : blocks
          .slice(last + 1)
          .map((block) => block.text)
          .join('');
  const gap =
    before === '' || before.endsWith(ending + ending)
      ? ''
      : before.endsWith(ending)
        ? ending
        : ending + ending;
  return `${before}${gap}${withEnding(claim.trimEnd(), ending)}${ending}${after ? ending : ''}${after}`;
}

/**
 * A claim once the user confirms it, as the skills do it: without `unconfirmed`, and with its
 * Source the user and the date, such as "Alex 2026-10-12". Everything else stays as written.
 * Null when it isn't a claim waiting to be confirmed.
 */
export function confirmClaim(text: string, source: string): string | null {
  const [block, ...others] = factBlocks(text);
  if (!block?.tags?.includes(UNCONFIRMED) || others.length > 0) return null;
  const lines = linesOf(text);
  const ending = endingOf(text);
  const tagAt = lines.findIndex((line, i) => i > 0 && bare(line).trim() !== '');
  const tagLine = lines[tagAt] ?? '';
  lines[tagAt] =
    bare(tagLine)
      .replace(/`unconfirmed`[ \t]*/, '')
      .trimEnd() + tagLine.slice(bare(tagLine).length);

  let fence: string | null = null;
  const sourceAt = lines.findIndex((line) => {
    const inCode = fence !== null;
    fence = fenceAt(bare(line), fence);
    return !inCode && SOURCE.test(bare(line));
  });
  if (sourceAt >= 0) {
    const line = lines[sourceAt] ?? '';
    lines[sourceAt] = bare(line).replace(SOURCE, `$1 ${source}`) + line.slice(bare(line).length);
    return lines.join('');
  }
  // No Source yet: one goes after the claim's last line, before its blank lines.
  return `${lines.join('').trimEnd()}${ending}- **Source:** ${source}${trailingOf(text)}`;
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
  return {
    title: block.title,
    tags,
    tagNote: note,
    wording: quote.map((line) => line.replace(/^ {0,3}>[ \t]?/, '')).join('\n'),
    details: trimBlank(quoteEnd > quoteAt ? after.slice(quoteEnd) : after).join('\n'),
  };
}

/** A claim's text from its parts, in the format facts/README.md gives. */
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
  return [`### ${parts.title.trim()}`, tagLine, ...wording, ...(details ? [details] : [])].join(
    '\n',
  );
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
