/**
 * What the user said they don't have, in the fact bank's gaps.md: its Doesn't have section,
 * which is settled, so Claude never claims it and never asks about it again. Factwright's tools
 * add a row for each "no" the user gives Claude, and the window lists them, so one can be taken
 * back.
 */

import { oneLine } from './answered.ts';
import { type FactBlock, factBlocks } from './facts.ts';

/** Where the fact bank keeps its gaps. */
export const GAPS_FILE = 'facts/gaps.md';

/** One thing the user said they don't have: a row of the section's table, or an item of its list. */
export interface GapRow {
  /** Which of the section's rows it is, from 0. */
  index: number;
  /** Its line, as written, without its line ending. */
  line: string;
  topic: string;
  /** What the user answered, as written. */
  answer: string;
  /** The day they said so, as YYYY-MM-DD, when the row gives one. */
  date: string | null;
}

/** The Doesn't have section, and the rows in it. */
export interface DoesntHave {
  /** Its heading as written, such as "Doesn't have (don't claim, don't ask again)". */
  title: string;
  rows: GapRow[];
}

/** A row to add: what it's about, what the user answered, and when. */
export interface NewGap {
  topic: string;
  answer: string;
  date: string;
}

/** The text's lines, each with its line ending, so joining them gives the text back. */
const linesOf = (text: string): string[] => text.match(/[^\n]*\n|[^\n]+$/g) ?? [];

/** A line without its ending. */
const bare = (line: string) => line.replace(/\r?\n$/, '');

/** The line ending a file mostly uses: Windows's, or "\n". */
function endingOf(text: string): string {
  const windows = text.split('\r\n').length - 1;
  return windows > text.split('\n').length - 1 - windows ? '\r\n' : '\n';
}

/** Whether words are the Doesn't have section's title, however its apostrophe and note go. */
const isDoesntHaveTitle = (title: string) =>
  /^(?:does ?n[’']?t|does not) have\b/.test(title.toLowerCase().replace(/\s+/g, ' '));

/** Whether a block is the Doesn't have section, as the window shows the file's blocks. */
export const isDoesntHave = (block: Pick<FactBlock, 'level' | 'title'>) =>
  block.level >= 1 && isDoesntHaveTitle(block.title);

// Every pattern here takes time in step with the line it reads.
const HEADING = /^ {0,3}(#{1,6})[ \t]+(\S.*)$/;
/** A line that's a section's name in bold, such as "**Doesn't have** (settled)". */
const BOLD_LINE = /^ {0,3}\*\*([^*\n]{1,200})\*\*/;
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;
const TABLE_ROW = /^ {0,3}\|/;
/** A table's separator row, such as |---|:---:|. */
const SEPARATOR = /^ {0,3}\|?[ \t]*:?-{2,}/;
const LIST_ITEM = /^( {0,3})(?:[-*+]|(\d{1,9})([.)]))[ \t]+(\S.*)$/;
const DATE = /\b(\d{4}-\d{2}-\d{2})\b/;

/** A bold line's section level: below every heading, so any heading ends it. */
const BOLD_LEVEL = 7;

/** A line's heading, as a section starts: its level, and its words. Null for any other line. */
function headingOf(line: string): { level: number; title: string } | null {
  const heading = line.match(HEADING);
  if (heading) {
    return { level: heading[1]?.length ?? 1, title: (heading[2] ?? '').replace(/[ \t#]+$/, '') };
  }
  const bold = line.match(BOLD_LINE);
  return bold ? { level: BOLD_LEVEL, title: (bold[1] ?? '').trim() } : null;
}

/** Whether a line closes a code block opened with a fence. */
function closes(line: string, fence: string): boolean {
  const match = line.match(/^ {0,3}(`{3,}|~{3,})[ \t]*$/);
  return !!match?.[1] && match[1][0] === fence[0] && match[1].length >= fence.length;
}

/** A table row's cells, with an escaped pipe ("\|") kept inside its cell. */
function cellsOf(line: string): string[] {
  const inner = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return inner
    .replaceAll('\\|', '\u0001')
    .split('|')
    .map((cell) => cell.trim().replaceAll('\u0001', '|'));
}

/** A value made safe for a table cell: one line, with its pipes escaped. */
const cell = (text: string) => oneLine(text).replaceAll('|', '\\|');

interface Found {
  title: string;
  /** Where its lines start among the file's: its heading, or its name in bold. */
  start: number;
  lines: string[];
  /** Each row's place among the section's lines, and what it says. */
  rows: { at: number; topic: string; answer: string; date: string | null }[];
  /** Where a new row goes among the section's lines, and in what form. */
  next: { at: number; form: 'table' | 'list' | 'new'; ordered?: { number: number; mark: string } };
}

/**
 * The Doesn't have section of a gaps file, with its rows, or null when it has none: under a
 * heading of any level, or a line with its name in bold, up to the next heading as high as its
 * own, or any heading for a bold one. A heading of three #s or fewer ends it too, as the window
 * shows each of those as a section of its own. Nothing in a code block counts.
 */
function find(text: string): Found | null {
  const lines = linesOf(text);
  let fence: string | null = null;
  let start = -1;
  let level = 0;
  let title = '';
  let end = lines.length;
  for (const [i, line] of lines.entries()) {
    const content = bare(line);
    if (fence) {
      if (closes(content, fence)) fence = null;
      continue;
    }
    const open = content.match(FENCE_OPEN)?.[1];
    if (open) {
      fence = open;
      continue;
    }
    const heading = headingOf(content);
    if (!heading) continue;
    if (start < 0) {
      if (isDoesntHaveTitle(heading.title)) {
        start = i;
        level = heading.level;
        title = heading.title;
      }
      continue;
    }
    if (heading.level <= Math.max(level, 3)) {
      end = i;
      break;
    }
  }
  if (start < 0) return null;
  const section = lines.slice(start, end);
  return { title, start, lines: section, ...rowsOf(section) };
}

/** A list item's topic and answer: "**Topic:** answer (date)", "Topic: answer", or a topic alone. */
function itemParts(item: string): { topic: string; answer: string } {
  const bold = item.match(/^\*\*([^*]{1,300})\*\*:?[ \t]*(.*)$/);
  if (bold) {
    return { topic: (bold[1] ?? '').replace(/:$/, '').trim(), answer: (bold[2] ?? '').trim() };
  }
  const split = item.indexOf(': ');
  return split > 0
    ? { topic: item.slice(0, split).trim(), answer: item.slice(split + 2).trim() }
    : { topic: item.trim(), answer: '' };
}

/**
 * The rows of a section's first table, or else of its list's top-level items, and where a new
 * row goes: after the last, or in a new table after the section's words.
 */
function rowsOf(lines: readonly string[]): Pick<Found, 'rows' | 'next'> {
  const content = lines.map(bare);
  const head = content.findIndex(
    (line, i) => i > 0 && TABLE_ROW.test(line) && SEPARATOR.test(content[i + 1] ?? ''),
  );
  if (head > 0) {
    const rows: Found['rows'] = [];
    let at = head + 2;
    for (; at < content.length && TABLE_ROW.test(content[at] ?? ''); at++) {
      const [topic = '', answer = '', ...rest] = cellsOf(content[at] ?? '');
      const date = rest.join(' ').match(DATE)?.[1] ?? null;
      rows.push({ at, topic, answer, date });
    }
    return { rows, next: { at, form: 'table' } };
  }
  const rows: Found['rows'] = [];
  let indent: string | null = null;
  let last = -1;
  let ordered: { number: number; mark: string } | undefined;
  for (const [at, line] of content.entries()) {
    const item = at > 0 ? line.match(LIST_ITEM) : null;
    if (!item) continue;
    // Only the list's own items count: one indented under another is part of that one.
    indent ??= item[1] ?? '';
    if ((item[1] ?? '') !== indent) continue;
    const text = item[4] ?? '';
    rows.push({ at, ...itemParts(text), date: text.match(DATE)?.[1] ?? null });
    last = at;
    ordered = item[2] ? { number: Number(item[2]), mark: item[3] ?? '.' } : undefined;
  }
  // A new item goes after the last one's own lines, such as an item indented under it.
  let after = last + 1;
  while (after < content.length && /^\s+\S/.test(content[after] ?? '')) after++;
  if (rows.length > 0) {
    return { rows, next: { at: after, form: 'list', ...(ordered && { ordered }) } };
  }
  // Nothing yet: a table goes after the heading and any words under it.
  let end = content.length;
  while (end > 1 && !(content[end - 1] ?? '').trim()) end--;
  return { rows, next: { at: end, form: 'new' } };
}

/** What the user said they don't have, from gaps.md's text, or null when it has no such section. */
export function doesntHave(text: string): DoesntHave | null {
  const found = find(text);
  if (!found) return null;
  return {
    title: found.title,
    rows: found.rows.map(({ at, topic, answer, date }, index) => ({
      index,
      line: bare(found.lines[at] ?? ''),
      topic,
      answer,
      date,
    })),
  };
}

/** Whether the section already has a row on this topic, whatever its case and spacing. */
export function hasGap(text: string, topic: string): boolean {
  const key = (value: string) => oneLine(value).toLowerCase();
  return doesntHave(text)?.rows.some((row) => key(row.topic) === key(topic)) ?? false;
}

const TABLE_HEAD = ['| Topic | Their answer | Date |', '|---|---|---|'];

const tableRow = ({ topic, answer, date }: NewGap) =>
  `| ${cell(topic)} | ${cell(answer)} | ${cell(date)} |`;

/** A new gaps file, with the sections facts/README.md gives it and one row. */
export function newGapsFile(gap: NewGap): string {
  return [
    '# Gaps',
    '',
    "## Doesn't have",
    ...TABLE_HEAD,
    tableRow(gap),
    '',
    '## Needs confirmation',
    '',
    '## Open questions',
    '',
  ].join('\n');
}

/**
 * The gaps file with a row added to its Doesn't have section: after its table's last row, in
 * its list, or in a new table, set apart from the words before it. A file without the section
 * gets one before its other sections.
 */
export function withGap(text: string, gap: NewGap): string {
  const ending = endingOf(text);
  const found = find(text);
  if (!found) {
    const section = ["## Doesn't have", ...TABLE_HEAD, tableRow(gap), '', ''].join(ending);
    const blocks = factBlocks(text, { claims: false });
    const before = blocks.findIndex((block) => block.level === 2);
    if (before < 0) {
      const spacer =
        text === '' || /\n[ \t]*\r?\n$/.test(text)
          ? ''
          : text.endsWith('\n')
            ? ending
            : ending + ending;
      return `${text}${spacer}${section.trimEnd()}${ending}`;
    }
    return [
      ...blocks.slice(0, before).map((block) => block.text),
      section,
      ...blocks.slice(before).map((block) => block.text),
    ].join('');
  }
  const { start, next } = found;
  const lines = linesOf(text);
  const topic = oneLine(gap.topic);
  const answer = oneLine(gap.answer);
  const item = next.ordered
    ? `${next.ordered.number + 1}${next.ordered.mark} **${topic}:** ${answer} (${gap.date})`
    : `- **${topic}:** ${answer} (${gap.date})`;
  // A new table can't run on from a line of words: Markdown would read it as more words.
  const before = bare(found.lines[next.at - 1] ?? '');
  const apart = next.form === 'new' && next.at > 1 && before.trim() !== '';
  const added =
    next.form === 'table'
      ? [tableRow(gap)]
      : next.form === 'list'
        ? [item]
        : [...(apart ? [''] : []), ...TABLE_HEAD, tableRow(gap)];
  const at = start + next.at;
  // The line before ends with a line ending, so what's added starts on a line of its own.
  const previous = lines[at - 1];
  if (previous !== undefined && !previous.endsWith('\n')) lines[at - 1] = previous + ending;
  lines.splice(at, 0, ...added.map((line) => `${line}${ending}`));
  return lines.join('');
}

/**
 * The gaps file without one of the Doesn't have section's rows, if it still reads as the window
 * saw it: at its place, or else the one row that reads that way. Null when it changed or went.
 */
export function withoutGap(text: string, row: Pick<GapRow, 'index' | 'line'>): string | null {
  const found = find(text);
  if (!found) return null;
  const same = (at: number) => bare(found.lines[at] ?? '') === row.line;
  let target = found.rows[row.index];
  if (!target || !same(target.at)) {
    const alike = found.rows.filter((each) => same(each.at));
    target = alike.length === 1 ? alike[0] : undefined;
  }
  if (!target) return null;
  const lines = linesOf(text);
  lines.splice(found.start + target.at, 1);
  return lines.join('');
}
