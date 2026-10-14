/** A Markdown list item, with the items indented under it. */
export interface ListItem {
  text: string;
  sub: string[];
}

/** The lines under one "## " heading. */
export interface Section {
  /** The heading as written, such as "Company sentiment (2026-10-09)". */
  title: string;
  lines: string[];
}

const ESCAPED_PIPE = '\\|';
const PLACEHOLDER = '\u0001';

function tableCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .replaceAll(ESCAPED_PIPE, PLACEHOLDER)
    .split('|')
    .map((cell) => cell.trim().replaceAll(PLACEHOLDER, '|'));
}

/**
 * Reads the first table in Markdown text. Each row becomes an object keyed by its lowercase
 * column heading, and an escaped pipe ("\|") stays inside its cell.
 */
export function markdownTable(text: string | null): Record<string, string>[] {
  if (!text) return [];
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex(
    (line, i) => line.trim().startsWith('|') && /^\s*(?:\|\s*)?:?-{2,}/.test(lines[i + 1] ?? ''),
  );
  if (start < 0) return [];
  const headings = tableCells(lines[start] ?? '').map((heading) => heading.toLowerCase());
  const rows: Record<string, string>[] = [];
  for (let i = start + 2; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (!line.trim().startsWith('|')) break;
    const cells = tableCells(line);
    rows.push(Object.fromEntries(headings.map((heading, k) => [heading, cells[k] ?? ''])));
  }
  return rows;
}

/** A character that ends a line: a "." in a pattern never matches one. */
const LINE_BREAK = /[\n\r\u2028\u2029]/;

/**
 * A "## " heading's text, such as "Company sentiment (2026-10-09)", or undefined for any other
 * line. It reads a line as /^##\s+(.+?)\s*$/ would, in one pass, as that pattern slows down
 * badly on a long run of spaces or tabs. A heading of spaces alone has no text.
 */
export function sectionHeading(line: string): string | undefined {
  if (!/^##\s/.test(line)) return undefined;
  const rest = line.slice(3);
  const text = rest.trim();
  // Its words can't run across a line break. A heading of spaces alone counts only if one of
  // them isn't a line break.
  if (text) return LINE_BREAK.test(text) ? undefined : text;
  return /[^\n\r\u2028\u2029]/.test(rest) ? '' : undefined;
}

/**
 * Text without a "(…)" at its end, such as a date: "company sentiment (2026-10-09)" becomes
 * "company sentiment". The "(…)" starts at the first "(" after the ")" before the last one, as
 * the pattern /\s*\([^)]*\)\s*$/ would take it, but it's read in one pass.
 */
function withoutTrailingNote(text: string): string {
  const trimmed = text.trimEnd();
  const close = trimmed.length - 1;
  if (close < 1 || trimmed[close] !== ')') return text;
  const open = trimmed.indexOf('(', trimmed.lastIndexOf(')', close - 1) + 1);
  return open >= 0 && open < close ? trimmed.slice(0, open).trimEnd() : text;
}

/**
 * Splits Markdown text at its "## " headings. Each section is keyed by its lowercase heading,
 * minus a trailing "(…)", so "## Company sentiment (2026-10-09)" is "company sentiment". Text
 * before the first heading is under "".
 */
export function markdownSections(text: string): Map<string, Section> {
  const top: Section = { title: '', lines: [] };
  const sections = new Map([['', top]]);
  let current = top;
  for (const line of text.split(/\r?\n/)) {
    const heading = sectionHeading(line);
    if (heading === undefined) {
      current.lines.push(line);
      continue;
    }
    const key = withoutTrailingNote(heading.toLowerCase()).trim();
    let section = sections.get(key);
    if (!section) {
      section = { title: heading, lines: [] };
      sections.set(key, section);
    }
    current = section;
  }
  return sections;
}

/**
 * Reads the top-level items of a Markdown list, each with the items indented under it. Wrapped
 * lines join the item they continue, and a stray paragraph counts as an item of its own.
 */
export function markdownItems(lines: readonly string[]): ListItem[] {
  const items: ListItem[] = [];
  let continuing = false;
  for (const raw of lines) {
    if (!raw.trim() || raw.startsWith('#')) {
      continuing = false;
      continue;
    }
    // After the marker's spaces, the text starts at a visible character: "\s+(.*)" would read a
    // long run of spaces again for each way to split it between the two.
    const bullet = raw.match(/^(\s*)(?:[-*+]|\d+[.)])\s+((?:\S.*)?)$/);
    const last = items.at(-1);
    const indent = bullet?.[1] ?? '';
    const text = (bullet?.[2] ?? raw).trim();
    if (bullet && (indent.length < 2 || !last)) {
      items.push({ text, sub: [] });
    } else if (bullet && last) {
      last.sub.push(text);
    } else if (last && (continuing || /^\s{2,}/.test(raw))) {
      const lastSub = last.sub.length - 1;
      if (lastSub >= 0) last.sub[lastSub] += ` ${text}`;
      else last.text += ` ${text}`;
    } else {
      items.push({ text, sub: [] });
    }
    continuing = true;
  }
  return items;
}
