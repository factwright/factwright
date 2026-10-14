import { decodeEntities, htmlToText, withoutTags } from './posting.ts';

/** Hacker News's monthly threads, newest first, from the whoishiring account, through Algolia. */
export const HN_THREADS_URL =
  'https://hn.algolia.com/api/v1/search_by_date?tags=story,author_whoishiring&hitsPerPage=40';

/** Where Algolia gives a whole thread: the story and every comment, as JSON. */
export const hnItemUrl = (id: string) =>
  `https://hn.algolia.com/api/v1/items/${encodeURIComponent(id)}`;

/** A thread's page on Hacker News itself. */
export const hnThreadLink = (id: string) =>
  `https://news.ycombinator.com/item?id=${encodeURIComponent(id)}`;

export interface HnThread {
  id: string;
  title: string;
  /** The month it's for, as YYYY-MM. */
  month: string;
}

/** One job post: a top-level comment in the thread. */
export interface HnPost {
  id: number;
  /** Its first line, which by the thread's rules names the company, role and location. */
  header: string;
  date: string | null;
  text: string;
}

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const field = (value: unknown, key: string) => (isObject(value) ? value[key] : undefined);

/** "Ask HN: Who is hiring? (October 2026)" is the thread for 2026-10. */
function monthOf(title: string): string | null {
  const match = title.match(/\((\w+) (\d{4})\)/);
  const month = MONTHS.indexOf(match?.[1]?.toLowerCase() ?? '');
  return match?.[2] && month >= 0 ? `${match[2]}-${String(month + 1).padStart(2, '0')}` : null;
}

/**
 * The "Who is hiring?" thread for a month (YYYY-MM) from Algolia's list of threads, or the
 * newest one when no month is given. Null when the list doesn't have it.
 */
export function hiringThread(answer: unknown, month?: string): HnThread | null {
  const hits = field(answer, 'hits');
  for (const hit of Array.isArray(hits) ? hits : []) {
    const title = field(hit, 'title');
    const id = field(hit, 'objectID');
    if (typeof title !== 'string' || typeof id !== 'string') continue;
    if (!/^Ask HN: Who is hiring\?/i.test(title)) continue;
    const found = monthOf(title);
    if (found && (!month || month === found)) return { id, title, month: found };
  }
  return null;
}

/**
 * A link's full address, where Hacker News shortened the text it shows. Each piece but the last
 * ends where a link closes, and holds the link's opening tag: read this way, a link left open
 * costs no more than its own length, where one pattern for the whole link would read to the end
 * of the post again for each.
 */
function withFullLinks(html: string): string {
  const pieces = html.split(/<\/a>/i);
  const rest = pieces.pop() ?? '';
  return pieces.map(withFullLink).join('') + rest;
}

/**
 * A piece of a post that ends where a link closed, with that link's full address. The link is
 * its first "<a " tag with an address, and its text runs to the end of the piece.
 */
function withFullLink(piece: string): string {
  const opening = /<a\s/gi;
  for (let open = opening.exec(piece); open; open = opening.exec(piece)) {
    const end = piece.indexOf('>', open.index);
    if (end < 0) break;
    const href = [...piece.slice(open.index, end).matchAll(/href="([^"]*)"/gi)].at(-1)?.[1];
    if (href === undefined) {
      // Any other "<a " before this tag's end shares its end, and has no address either.
      opening.lastIndex = end + 1;
      continue;
    }
    const url = decodeEntities(href);
    const label = decodeEntities(withoutTags(piece.slice(end + 1)));
    const cut = label.replace(/(\.\.\.|…)$/, '');
    const full = label === url || url.startsWith(cut) ? url : `${label} (${url})`;
    return piece.slice(0, open.index) + full;
  }
  return `${piece}</a>`;
}

/**
 * The job posts in a thread: its top-level comments, each as plain text with full links. Posts
 * that were deleted or flagged have no text and are left out.
 */
export function readHnThread(answer: unknown): { title: string; posts: HnPost[] } | null {
  const title = field(answer, 'title');
  const children = field(answer, 'children');
  if (typeof title !== 'string' || !Array.isArray(children)) return null;
  const posts = children.flatMap((child): HnPost[] => {
    const id = field(child, 'id');
    const html = field(child, 'text');
    if (typeof id !== 'number' || typeof html !== 'string' || !html.trim()) return [];
    const text = htmlToText(withFullLinks(html).replace(/<p>/gi, '\n\n'));
    const date = field(child, 'created_at');
    return [
      {
        id,
        header: text.split('\n')[0]?.trim() || `Post ${id}`,
        date: typeof date === 'string' ? date.slice(0, 10) : null,
        text,
      },
    ];
  });
  return { title, posts };
}

/** A thread's job posts as one Markdown file, each word for word, under its first line. */
export function hnThreadMarkdown(
  thread: HnThread,
  posts: readonly HnPost[],
  savedOn: string,
): string {
  const parts = [
    `# ${thread.title}`,
    '',
    `- **Thread:** ${hnThreadLink(thread.id)}`,
    `- **Saved:** ${savedOn} by Factwright, ${posts.length} job ${posts.length === 1 ? 'post' : 'posts'}, word for word`,
  ];
  posts.forEach((post, i) => {
    const body = post.text.split('\n').slice(1).join('\n').trim();
    parts.push(
      '',
      `## ${i + 1}. ${post.header} (hn ${post.id})`,
      '',
      `- **Post:** ${hnThreadLink(String(post.id))}${post.date ? ` · ${post.date}` : ''}`,
      ...(body ? ['', body] : []),
    );
  });
  return `${parts.join('\n')}\n`;
}
