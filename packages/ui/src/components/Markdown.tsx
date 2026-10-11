import { Fragment, type ReactNode } from 'react';
import { cx } from '../cx.ts';
import styles from './Markdown.module.css';

export interface MarkdownProps {
  text: string;
  /** How far to push headings down, so a document's "#" fits under the page's own headings. */
  headingOffset?: number;
  className?: string;
}

interface Inline {
  pattern: RegExp;
  render: (match: RegExpExecArray, key: string) => ReactNode;
}

const link = (url: string, children: ReactNode, key: string) => (
  <a key={key} href={url} target="_blank" rel="noreferrer">
    {children}
  </a>
);

/** Inline marks, tried in order at each spot: code, links, bare addresses, bold, italic. */
const INLINE: readonly Inline[] = [
  { pattern: /`([^`]+)`/, render: (match, key) => <code key={key}>{match[1]}</code> },
  {
    pattern: /\[([^\]]+)\]\(((?:https?:\/\/|mailto:)[^\s)]+)\)/,
    render: (match, key) => link(match[2] ?? '', inline(match[1] ?? '', key), key),
  },
  {
    pattern: /(?<=^|[\s(])https?:\/\/[^\s<)]*[^\s<).,;:]/,
    render: (match, key) => link(match[0], match[0], key),
  },
  {
    pattern: /\*\*([^*]+)\*\*/,
    render: (match, key) => <strong key={key}>{inline(match[1] ?? '', key)}</strong>,
  },
  {
    pattern: /(?<=^|[\s(])\*([^*\s][^*]*?)\*(?=[\s).,;:!?]|$)/,
    render: (match, key) => <em key={key}>{inline(match[1] ?? '', key)}</em>,
  },
];

/** Text with its inline marks, as React elements. */
function inline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let rest = text;
  while (rest) {
    let first: { match: RegExpExecArray; rule: Inline } | undefined;
    for (const rule of INLINE) {
      const match = rule.pattern.exec(rest);
      if (match && (!first || match.index < first.match.index)) first = { match, rule };
    }
    if (!first) {
      nodes.push(rest);
      break;
    }
    const { match, rule } = first;
    if (match.index > 0) nodes.push(rest.slice(0, match.index));
    nodes.push(rule.render(match, `${keyPrefix}.${nodes.length}`));
    rest = rest.slice(match.index + match[0].length);
  }
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

const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;

const cells = (line: string) =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());

const isTableStart = (all: readonly string[], i: number) =>
  /^\s*\|/.test(all[i] ?? '') && /^\s*\|?\s*:?-{2,}/.test(all[i + 1] ?? '');

const isBlockStart = (all: readonly string[], i: number) => {
  const line = all[i] ?? '';
  return /^```|^#{1,6}\s|^>\s?/.test(line) || LIST_ITEM.test(line) || isTableStart(all, i);
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
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
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
      const level = Math.min(6, (heading[1]?.length ?? 1) + headingOffset);
      const Tag = `h${level}` as 'h3';
      out.push(<Tag key={key}>{inline(heading[2] ?? '', key)}</Tag>);
      i++;
    } else if (isTableStart(all, i)) {
      const head = cells(line);
      const rows: string[][] = [];
      for (i += 2; i < all.length && /^\s*\|/.test(all[i] ?? ''); i++)
        rows.push(cells(all[i] ?? ''));
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
    } else if (LIST_ITEM.test(line)) {
      const items: { depth: number; text: string; ordered: boolean }[] = [];
      while (i < all.length) {
        const current = all[i] ?? '';
        const item = current.match(LIST_ITEM);
        const last = items.at(-1);
        if (item) {
          const depth = Math.min(3, Math.floor((item[1]?.length ?? 0) / 2));
          items.push({ depth, text: item[3] ?? '', ordered: /^\d/.test(item[2] ?? '') });
        } else if (last && /^\s{2,}\S/.test(current)) {
          last.text += ` ${current.trim()}`;
        } else {
          break;
        }
        i++;
      }
      out.push(list(nest(items), key));
    } else if (/^>\s?/.test(line)) {
      const quote: string[] = [];
      for (; i < all.length && /^>\s?/.test(all[i] ?? ''); i++) {
        quote.push((all[i] ?? '').replace(/^>\s?/, ''));
      }
      out.push(<blockquote key={key}>{lines(quote, key)}</blockquote>);
    } else if (!line.trim()) {
      i++;
    } else {
      const paragraph: string[] = [];
      for (; i < all.length && (all[i] ?? '').trim() && !isBlockStart(all, i); i++) {
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
