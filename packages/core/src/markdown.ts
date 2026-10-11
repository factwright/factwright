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
    (line, i) => line.trim().startsWith('|') && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1] ?? ''),
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
    const heading = line.match(/^##\s+(.+?)\s*$/)?.[1];
    if (heading === undefined) {
      current.lines.push(line);
      continue;
    }
    const key = heading
      .toLowerCase()
      .replace(/\s*\([^)]*\)\s*$/, '')
      .trim();
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
    const bullet = raw.match(/^(\s*)(?:[-*+]|\d+[.)])\s+(.*)$/);
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
