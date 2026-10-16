import { Fragment, type ReactNode } from 'react';
import { cx } from '../cx.ts';
import styles from './Markdown.module.css';

export interface MarkdownProps {
  text: string;
  /** How far to push headings down, so a document's "#" fits under the page's own headings. */
  headingOffset?: number;
  className?: string;
}

/*
 * What this shows comes from Claude, and through it from job pages, which come from anywhere. So
 * it reads text a character at a time, in one pass, where patterns that backtrack could take
 * minutes on text made for it.
 */

/** Whether the character at `at` is one /\s/ matches: a space, tab or line break, of any kind. */
function isSpace(text: string, at: number): boolean {
  const code = text.charCodeAt(at);
  return (
    (code >= 0x09 && code <= 0x0d) ||
    code === 0x20 ||
    code === 0xa0 ||
    code === 0x1680 ||
    (code >= 0x2000 && code <= 0x200a) ||
    code === 0x2028 ||
    code === 0x2029 ||
    code === 0x202f ||
    code === 0x205f ||
    code === 0x3000 ||
    code === 0xfeff
  );
}

const isDigit = (text: string, at: number) => text.charAt(at) >= '0' && text.charAt(at) <= '9';

/** Where the spaces starting at `at` end. */
function spacesEnd(text: string, at: number): number {
  let end = at;
  while (end < text.length && isSpace(text, end)) end++;
  return end;
}

const link = (url: string, children: ReactNode, key: string) => (
  <a key={key} href={url} target="_blank" rel="noreferrer">
    {children}
  </a>
);

/** An inline mark found at a place: where it ends, and how it shows. */
interface Mark {
  end: number;
  render: (key: string) => ReactNode;
}

/** Whether a mark can start at `at`: at the start, or after a space or "(". */
const startsWord = (text: string, at: number) =>
  at === 0 || text[at - 1] === '(' || isSpace(text, at - 1);

/** Whether a mark can end just before `at`: at the end, or before a space or one of ").,;:!?". */
const endsWord = (text: string, at: number) =>
  at >= text.length || isSpace(text, at) || ').,;:!?'.includes(text.charAt(at));

/** How long the "https://", "http://" or, with `mail`, "mailto:" at `at` is, or 0. */
function schemeLength(text: string, at: number, mail: boolean): number {
  if (text.startsWith('https://', at)) return 8;
  if (text.startsWith('http://', at)) return 7;
  return mail && text.startsWith('mailto:', at) ? 7 : 0;
}

/**
 * Finds the next character `is` accepts, at or after `from`, or -1. Asked again from further on,
 * it keeps its answer while that's still ahead, so asked from places that only move forward, it
 * reads the text once.
 */
function seeker(text: string, is: (at: number) => boolean): (from: number) => number {
  let searched = -1;
  let found = -1;
  return (from) => {
    if (searched < 0 || from < searched || (found >= 0 && found < from)) {
      searched = from;
      found = -1;
      for (let at = from; at < text.length; at++) {
        if (is(at)) {
          found = at;
          break;
        }
      }
    }
    return found;
  };
}

/** `Code`: one or more characters between backticks. */
function codeAt(text: string, at: number): Mark | null {
  if (at + 1 >= text.length || text[at + 1] === '`') return null;
  const close = text.indexOf('`', at + 1);
  if (close < 0) return null;
  const code = text.slice(at + 1, close);
  return { end: close + 1, render: (key) => <code key={key}>{code}</code> };
}

/**
 * Links, "[text](address)", in one text. Many "[" can share the "]" after them, and many
 * addresses the space or ")" that ends them, so each of those is looked for once, rather than
 * once for every "[" before it.
 */
function linkReader(text: string): (at: number) => Mark | null {
  const nextClose = seeker(text, (at) => text[at] === ']');
  const nextStop = seeker(text, (at) => text[at] === ')' || isSpace(text, at));
  return (at) => {
    // 1 to 500 characters of text up to the first "]", then "(" and a web or email address with
    // 1 to 2,048 characters after its scheme, up to a ")": the limits links had before.
    const close = nextClose(at + 1);
    if (close < at + 2 || close > at + 501 || text[close + 1] !== '(') return null;
    const start = close + 2;
    const scheme = schemeLength(text, start, true);
    if (!scheme) return null;
    const stop = nextStop(start + scheme);
    if (stop <= start + scheme || stop > start + scheme + 2048 || text[stop] !== ')') return null;
    const label = text.slice(at + 1, close);
    const url = text.slice(start, stop);
    return { end: stop + 1, render: (key) => link(url, inline(label, key), key) };
  };
}

/** Whether the character at `at` ends a bare address: a space, "<" or ")". */
const endsAddress = (text: string, at: number) =>
  text[at] === '<' || text[at] === ')' || isSpace(text, at);

/** Punctuation after a bare address, which ends its sentence rather than the address. */
const AFTER_ADDRESS = '.,;:';

/** A bare web address, starting a word and running to a space, "<" or ")". */
function addressAt(text: string, at: number): Mark | null {
  const scheme = startsWord(text, at) ? schemeLength(text, at, false) : 0;
  if (!scheme) return null;
  let end = at + scheme;
  while (end < text.length && !endsAddress(text, end)) end++;
  while (end > at + scheme && AFTER_ADDRESS.includes(text.charAt(end - 1))) end--;
  if (end === at + scheme) return null;
  const url = text.slice(at, end);
  return { end, render: (key) => link(url, url, key) };
}

/** **Bold**: one or more characters, none of them "*", between pairs of them. */
function boldAt(text: string, at: number): Mark | null {
  if (text[at + 1] !== '*') return null;
  const close = text.indexOf('*', at + 2);
  if (close <= at + 2 || text[close + 1] !== '*') return null;
  const inner = text.slice(at + 2, close);
  return { end: close + 2, render: (key) => <strong key={key}>{inline(inner, key)}</strong> };
}

/** *Italic*: starting a word, with no space just inside its first "*", and ending one. */
function italicAt(text: string, at: number): Mark | null {
  if (at + 1 >= text.length || text[at + 1] === '*' || isSpace(text, at + 1)) return null;
  if (!startsWord(text, at)) return null;
  const close = text.indexOf('*', at + 2);
  if (close < 0 || !endsWord(text, close + 1)) return null;
  const inner = text.slice(at + 1, close);
  return { end: close + 1, render: (key) => <em key={key}>{inline(inner, key)}</em> };
}

/**
 * Text with its inline marks, as React elements: code, links, bare addresses, bold and italic.
 * It reads the text from the left and takes the first mark that fits at each place. Each kind of
 * mark reads ahead only to the first place it could end, and doesn't read that stretch again for
 * a later mark, so each character is read a few times at most.
 */
function inline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const linkAt = linkReader(text);
  let plain = 0;
  let at = 0;
  while (at < text.length) {
    let mark: Mark | null = null;
    switch (text[at]) {
      case '`':
        mark = codeAt(text, at);
        break;
      case '[':
        mark = linkAt(at);
        break;
      case 'h':
        mark = addressAt(text, at);
        break;
      case '*':
        mark = boldAt(text, at) ?? italicAt(text, at);
        break;
    }
    if (!mark) {
      at++;
      continue;
    }
    if (at > plain) nodes.push(text.slice(plain, at));
    nodes.push(mark.render(`${keyPrefix}.${nodes.length}`));
    at = mark.end;
    plain = at;
  }
  if (plain < text.length) nodes.push(text.slice(plain));
  return nodes;
}

/** Lines joined with line breaks, each with its inline marks. */
function lines(list: readonly string[], key: string): ReactNode[] {
  return list.map((line, i) => (
    <Fragment key={`${key}.${i}`}>
      {i > 0 && <br />}
      {inline(line, `${key}.${i}`)}
    </Fragment>
  ));
}

/** A "# Heading" line's level and text: one to six "#", a space, then its text. */
function headingOf(line: string): { level: number; text: string } | null {
  let level = 0;
  while (line[level] === '#') level++;
  if (level < 1 || level > 6 || !isSpace(line, level)) return null;
  return { level, text: line.slice(spacesEnd(line, level)) };
}

interface Item {
  /** How many spaces come before its marker. */
  indent: number;
  ordered: boolean;
  text: string;
}

/** A list item's line: "-", "*", "+", "1." or "1)", then a space, then its text. */
function itemOf(line: string): Item | null {
  const indent = spacesEnd(line, 0);
  const ordered = isDigit(line, indent);
  let at = indent + 1;
  if (ordered) {
    while (isDigit(line, at)) at++;
    if (line[at] !== '.' && line[at] !== ')') return null;
    at++;
  } else if (line[indent] !== '-' && line[indent] !== '*' && line[indent] !== '+') {
    return null;
  }
  if (!isSpace(line, at)) return null;
  return { indent, ordered, text: line.slice(spacesEnd(line, at)) };
}

const cells = (line: string) => {
  let row = line.trim();
  if (row.startsWith('|')) row = row.slice(1);
  if (row.endsWith('|')) row = row.slice(0, -1);
  return row.split('|').map((cell) => cell.trim());
};

/** Whether a line is a table's row: a "|" after any spaces. */
const isRow = (line: string) => line[spacesEnd(line, 0)] === '|';

/** Whether a line is the rule under a table's header, such as "|---|---|" or ":--". */
function isRule(line: string): boolean {
  let at = spacesEnd(line, 0);
  if (line[at] === '|') at = spacesEnd(line, at + 1);
  if (line[at] === ':') at++;
  return line[at] === '-' && line[at + 1] === '-';
}

const isTableStart = (all: readonly string[], i: number) =>
  isRow(all[i] ?? '') && isRule(all[i + 1] ?? '');

/** A quote's line without its ">" and a space after it. */
const unquoted = (line: string) => line.slice(isSpace(line, 1) ? 2 : 1);

const isBlockStart = (all: readonly string[], i: number) => {
  const line = all[i] ?? '';
  return (
    line.startsWith('```') ||
    line.startsWith('>') ||
    headingOf(line) !== null ||
    itemOf(line) !== null ||
    isTableStart(all, i)
  );
};

interface ListNode {
  text: string;
  ordered: boolean;
  children: ListNode[];
}

/** Items indented under each other become lists inside lists. */
function nest(items: readonly { depth: number; text: string; ordered: boolean }[]): ListNode[] {
  const root: ListNode[] = [];
  const open: { depth: number; list: ListNode[] }[] = [{ depth: -1, list: root }];
  for (const item of items) {
    while ((open.at(-1)?.depth ?? -1) >= item.depth) open.pop();
    const parent = open.at(-1) ?? { depth: -1, list: root };
    const node: ListNode = { text: item.text, ordered: item.ordered, children: [] };
    parent.list.push(node);
    open.push({ depth: item.depth, list: node.children });
  }
  return root;
}

function list(nodes: readonly ListNode[], key: string): ReactNode {
  const Tag = nodes[0]?.ordered ? 'ol' : 'ul';
  return (
    <Tag key={key}>
      {nodes.map((node, i) => (
        <li key={`${key}.${i}`}>
          {inline(node.text, `${key}.${i}`)}
          {node.children.length > 0 && list(node.children, `${key}.${i}.list`)}
        </li>
      ))}
    </Tag>
  );
}

function blocks(text: string, headingOffset: number): ReactNode[] {
  const all = text.replace(/\r\n?/g, '\n').split('\n');
  const out: ReactNode[] = [];
  let i = 0;
  while (i < all.length) {
    const line = all[i] ?? '';
    const key = `b${i}`;
    const heading = headingOf(line);
    if (line.startsWith('```')) {
      const code: string[] = [];
      for (i++; i < all.length && !(all[i] ?? '').startsWith('```'); i++) code.push(all[i] ?? '');
      i++;
      out.push(
        <pre key={key}>
          <code>{code.join('\n')}</code>
        </pre>,
      );
    } else if (heading) {
      const level = Math.min(6, heading.level + headingOffset);
      const Tag = `h${level}` as 'h3';
      out.push(<Tag key={key}>{inline(heading.text, key)}</Tag>);
      i++;
    } else if (isTableStart(all, i)) {
      const head = cells(line);
      const rows: string[][] = [];
      for (i += 2; i < all.length && isRow(all[i] ?? ''); i++) rows.push(cells(all[i] ?? ''));
      out.push(
        <div key={key} className={styles.table}>
          <table>
            <thead>
              <tr>
                {head.map((cell, k) => (
                  <th key={`${key}.h${k}`}>{inline(cell, `${key}.h${k}`)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, r) => (
                <tr key={`${key}.r${r}`}>
                  {head.map((_, k) => (
                    <td key={`${key}.r${r}.${k}`}>{inline(row[k] ?? '', `${key}.r${r}.${k}`)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
    } else if (itemOf(line)) {
      const items: { depth: number; text: string; ordered: boolean }[] = [];
      while (i < all.length) {
        const current = all[i] ?? '';
        const item = itemOf(current);
        const last = items.at(-1);
        const indent = spacesEnd(current, 0);
        if (item) {
          const depth = Math.min(3, Math.floor(item.indent / 2));
          items.push({ depth, text: item.text, ordered: item.ordered });
        } else if (last && indent >= 2 && indent < current.length) {
          // A line with text, indented under an item, continues it.
          last.text += ` ${current.trim()}`;
        } else {
          break;
        }
        i++;
      }
      out.push(list(nest(items), key));
    } else if (line.startsWith('>')) {
      const quote: string[] = [];
      for (; i < all.length && (all[i] ?? '').startsWith('>'); i++) {
        quote.push(unquoted(all[i] ?? ''));
      }
      out.push(<blockquote key={key}>{lines(quote, key)}</blockquote>);
    } else if (!line.trim()) {
      i++;
    } else {
      // Every line that starts a block is read as that block above, so this one starts a
      // paragraph. Taking it first, whatever it is, means the loop always moves on.
      const paragraph = [line];
      for (i++; i < all.length && (all[i] ?? '').trim() && !isBlockStart(all, i); i++) {
        paragraph.push(all[i] ?? '');
      }
      out.push(<p key={key}>{lines(paragraph, key)}</p>);
    }
  }
  return out;
}

/**
 * Shows Markdown, such as a saved posting or a fit check, as formatted text. It builds the
 * page from React elements and never from HTML, so nothing in the text can add markup or
 * scripts. Links open outside the app.
 */
export function Markdown({ text, headingOffset = 2, className }: MarkdownProps) {
  return <div className={cx(styles.markdown, className)}>{blocks(text, headingOffset)}</div>;
}

/** One line of Markdown's inline marks, such as **bold** and `code`, without a paragraph. */
export function MarkdownLine({ text }: { text: string }) {
  return <>{inline(text, 'line')}</>;
}
