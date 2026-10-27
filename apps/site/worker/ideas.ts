/**
 * The ideas board behind factwright.com/roadmap: suggestions anyone can send, votes that need no
 * account, and what Steve does with them on the admin page. They're kept in D1, in the tables
 * migrations/0001_ideas.sql makes. This file uses only what D1 and SQLite share, so the tests run
 * it on SQLite.
 */

/** A statement, as D1 prepares one. */
export interface Statement {
  bind(...values: unknown[]): Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta: { changes: number } }>;
}

/** What the board needs of its D1 database. A batch runs as one transaction. */
export interface Db {
  prepare(query: string): Statement;
  batch(statements: Statement[]): Promise<{ results: unknown[]; meta: { changes: number } }[]>;
}

/**
 * Where an idea stands. A new one is a suggestion only the admin page shows. Considering is
 * approved, to vote on, and planned, in progress and shipped are the roadmap. Not planned is off
 * the page, and merged went into another idea, with its votes.
 */
export const STATUSES = [
  'new',
  'considering',
  'planned',
  'in-progress',
  'shipped',
  'not-planned',
  'merged',
] as const;

export type Status = (typeof STATUSES)[number];

/** What the roadmap page shows. */
export const SHOWN: readonly Status[] = ['considering', 'planned', 'in-progress', 'shipped'];

/** Where the admin page can move an idea, approving it if it's new. */
export const MOVES = ['considering', 'planned', 'in-progress', 'shipped', 'not-planned'] as const;

export type Move = (typeof MOVES)[number];

/**
 * What takes votes. A new suggestion does too, for its suggester's own: nobody else knows its ID
 * until it's approved.
 */
const VOTABLE: readonly Status[] = ['new', 'considering', 'planned', 'in-progress'];

/** Closed: whoever suggested it has heard, or won't, so their email is forgotten. */
const CLOSED: readonly Status[] = ['shipped', 'not-planned', 'merged'];

/** How long each part of a suggestion can be, in characters, as the form's fields allow too. */
export const LIMITS = { title: 100, words: 1000, email: 254 } as const;

/**
 * How many suggestions can wait for Steve at once. Past it, a flood of them is turned away until
 * he's caught up, rather than filling the database.
 */
export const WAITING_MAX = 200;

/** How many merged ideas' votes a vote can name, beyond the idea's own. */
export const MOVED_MAX = 40;

/** An idea's ID, as crypto.randomUUID() makes one. */
export const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A vote: SHA-256 of a browser's voter ID and an idea's ID, in hex. */
const HASH = /^[0-9a-f]{64}$/;

/** A version as releases are tagged, as releases.ts reads them: 0.19.0, or 0.20.0-beta.1. */
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/**
 * An address someone could get mail at, roughly: letters, digits and ._+'- before the @, and a
 * domain after it. Steve writes back by hand, so it's a guide, and leaves out anything, such as
 * ? or &, that could add to the email his mail app drafts.
 */
const EMAIL = /^[\p{L}\p{N}._+'-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+$/u;

/**
 * What a title or a few lines can't hold: control characters, but for a new line in the lines,
 * and the marks that turn text around, which could make an idea show as something else.
 */
const UNSHOWN = /(?![\n])\p{Cc}|[‪-‮⁦-⁩]/gu;

/** An idea as the roadmap page shows it. */
export interface Idea {
  id: string;
  title: string;
  words: string;
  status: Status;
  /** The version it shipped in, once it has. */
  version: string | null;
  votes: number;
  /** The ideas merged into it, so a browser that voted for one of them sees its vote here. */
  merged: string[];
}

/** An idea as the admin page shows it, with whoever suggested it's email and its dates. */
export interface AdminIdea extends Idea {
  email: string | null;
  created: string;
  updated: string;
}

/** An idea as the database keeps it. */
interface Row {
  id: string;
  title: string;
  words: string;
  status: Status;
  version: string | null;
  votes: number;
  email: string | null;
  merged_into: string | null;
  created_at: string;
  updated_at: string;
}

/** What the roadmap page reads of an idea's row. */
type Shown = Pick<Row, 'id' | 'title' | 'words' | 'status' | 'version' | 'votes'>;

/** What a request asked for, read and tidied, or what's wrong with it, in words to show. */
export type Checked<T> = { ok: true; value: T } | { ok: false; problem: string };

const fine = <T>(value: T): Checked<T> => ({ ok: true, value });
const wrong = <T>(problem: string): Checked<T> => ({ ok: false, problem });

/** A title, on one line, with each run of spaces as one. */
const oneLine = (text: string) => text.replace(UNSHOWN, '').replace(/\s+/g, ' ').trim();

/** A few lines, with no more than one empty line between them, and no spaces at their ends. */
const someLines = (text: string) =>
  text
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, ' ')
    .replace(UNSHOWN, '')
    .replace(/[^\S\n]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

/** A suggestion as someone sends it from the roadmap page. */
export interface Suggestion {
  title: string;
  words: string;
  /** Where to write back about it, if they'd like to hear. */
  email: string | null;
}

/** Reads the title, the few lines and the email the roadmap page's form sends. */
export function readSuggestion(body: unknown): Checked<Suggestion> {
  const { title, words, email } = asRecord(body);
  const line = readTitle(title);
  if (!line.ok) return line;
  const lines = readWords(words);
  if (!lines.ok) return lines;
  if (!lines.value) return wrong('Add a few lines about it.');
  if (email !== undefined && email !== null && typeof email !== 'string') {
    return wrong('That email doesn’t look right. Check it, or leave it empty.');
  }
  const address = email?.trim() ?? '';
  if (address && (address.length > LIMITS.email || !EMAIL.test(address))) {
    return wrong('That email doesn’t look right. Check it, or leave it empty.');
  }
  return fine({ title: line.value, words: lines.value, email: address || null });
}

/** Reads an idea's title, which it always needs. */
function readTitle(title: unknown): Checked<string> {
  const line = typeof title === 'string' ? oneLine(title) : '';
  if (!line) return wrong('Give the idea a title.');
  if (line.length > LIMITS.title) return wrong(`Keep the title to ${LIMITS.title} characters.`);
  return fine(line);
}

/** Reads an idea's few lines, which Steve can leave empty when he approves it. */
function readWords(words: unknown): Checked<string> {
  if (words !== undefined && words !== null && typeof words !== 'string') {
    return wrong('Add a few lines about it.');
  }
  const lines = someLines(words ?? '');
  if (lines.length > LIMITS.words) return wrong(`Keep it to ${LIMITS.words} characters.`);
  return fine(lines);
}

/**
 * A vote, or taking one back, as a browser sends it: the hash of its voter ID with the idea's,
 * and with each idea merged into it, so a vote that came along with a merge counts as its own.
 */
export interface Vote {
  vote: boolean;
  hash: string;
  moved: string[];
}

/** Reads a vote. */
export function readVote(body: unknown): Checked<Vote> {
  const { vote, hash, moved = [] } = asRecord(body);
  const hashes = Array.isArray(moved) ? moved : null;
  if (
    typeof vote !== 'boolean' ||
    typeof hash !== 'string' ||
    !HASH.test(hash) ||
    !hashes ||
    hashes.length > MOVED_MAX ||
    !hashes.every((each) => typeof each === 'string' && HASH.test(each))
  ) {
    return wrong('That vote didn’t come through right. Reload the page and try again.');
  }
  return fine({
    vote,
    hash,
    moved: [...new Set(hashes as string[])].filter((each) => each !== hash),
  });
}

/** What the admin page changes about an idea. Whatever it leaves out stays as it is. */
export interface Change {
  title?: string;
  words?: string;
  status?: Move;
  /** The version it shipped in. Needed to mark it shipped, unless it already has one. */
  version?: string;
}

/** Reads a change from the admin page. */
export function readChange(body: unknown): Checked<Change> {
  const { title, words, status, version } = asRecord(body);
  const change: Change = {};
  if (title !== undefined) {
    const line = readTitle(title);
    if (!line.ok) return line;
    change.title = line.value;
  }
  if (words !== undefined) {
    const lines = readWords(words);
    if (!lines.ok) return lines;
    change.words = lines.value;
  }
  if (status !== undefined) {
    if (!MOVES.includes(status as Move)) return wrong('That isn’t a status an idea can have.');
    change.status = status as Move;
  }
  if (version !== undefined) {
    if (typeof version !== 'string' || !VERSION.test(version.trim())) {
      return wrong('Say which version it shipped in, such as 0.19.0.');
    }
    change.version = version.trim();
  }
  return fine(change);
}

/** A request's body, as an object, or an empty one when it isn't one. */
function asRecord(body: unknown): Record<string, unknown> {
  return body && typeof body === 'object' && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {};
}

/** When something happened, as the database keeps it. */
const stamp = (at: Date) => at.toISOString();

/** The ideas merged into each idea, from every merged one, which always points at a live one. */
function mergedInto(rows: readonly Pick<Row, 'id' | 'merged_into'>[]): Map<string, string[]> {
  const into = new Map<string, string[]>();
  for (const { id, merged_into } of rows) {
    if (merged_into) into.set(merged_into, [...(into.get(merged_into) ?? []), id]);
  }
  return into;
}

/** An idea as the page shows it, from its row. */
const shownIdea = (row: Shown, merged: Map<string, string[]>): Idea => ({
  id: row.id,
  title: row.title,
  words: row.words,
  status: row.status,
  version: row.version,
  votes: row.votes,
  merged: merged.get(row.id) ?? [],
});

/**
 * The ideas the roadmap page shows, most votes first, then the newest. It never reads anyone's
 * email.
 */
export async function shownIdeas(db: Db): Promise<Idea[]> {
  const [shown, merged] = await db.batch([
    db
      .prepare(
        `SELECT id, title, words, status, version, votes FROM ideas
         WHERE status IN (${SHOWN.map(() => '?').join(', ')})
         ORDER BY votes DESC, created_at DESC`,
      )
      .bind(...SHOWN),
    db.prepare("SELECT id, merged_into FROM ideas WHERE status = 'merged'"),
  ]);
  const into = mergedInto((merged?.results ?? []) as Row[]);
  return ((shown?.results ?? []) as Shown[]).map((row) => shownIdea(row, into));
}

/**
 * Every idea but the merged ones, for the admin page: new suggestions first, oldest first, as
 * they came in, then the rest, most votes first.
 */
export async function allIdeas(db: Db): Promise<AdminIdea[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM ideas
       ORDER BY status = 'new' DESC, CASE WHEN status = 'new' THEN created_at END, votes DESC,
         created_at DESC`,
    )
    .all<Row>();
  const into = mergedInto(results);
  return results
    .filter((row) => row.status !== 'merged')
    .map((row) => ({
      ...shownIdea(row, into),
      email: row.email,
      created: row.created_at,
      updated: row.updated_at,
    }));
}

/**
 * Keeps a new suggestion for Steve to read. Its ID goes back to the browser that sent it alone,
 * which then votes for it. Turned away while too many already wait.
 */
export async function suggest(
  db: Db,
  { title, words, email }: Suggestion,
  at = new Date(),
): Promise<{ id: string } | 'busy'> {
  const waiting = await db
    .prepare("SELECT COUNT(*) AS count FROM ideas WHERE status = 'new'")
    .first<{ count: number }>();
  if ((waiting?.count ?? 0) >= WAITING_MAX) return 'busy';
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO ideas (id, title, words, status, email, created_at, updated_at)
       VALUES (?, ?, ?, 'new', ?, ?, ?)`,
    )
    .bind(id, title, words, email, stamp(at), stamp(at))
    .run();
  return { id };
}

/** Where a browser's vote stands after it's cast or taken back, and the idea's votes. */
export interface Voted {
  voted: boolean;
  votes: number;
}

/** The statuses that take votes, as SQL's IN takes them, and their values to bind. */
const VOTABLE_IN = VOTABLE.map(() => '?').join(', ');

/**
 * Casts a browser's vote for an idea, or takes it back. A browser has one vote per idea: its own,
 * or one that came along when an idea it voted for was merged into this one, which counts as the
 * same. Casting it again, or taking back one that isn't there, changes nothing. It all happens in
 * one batch, which checks the idea still takes votes, so a merge or a move along at the same
 * moment can't leave a vote on an idea that's gone.
 */
export async function castVote(
  db: Db,
  id: string,
  { vote, hash, moved }: Vote,
): Promise<Voted | 'not-found' | 'closed'> {
  const hashes = [hash, ...moved];
  const any = hashes.map(() => '?').join(', ');
  const takes = `EXISTS (SELECT 1 FROM ideas WHERE id = ? AND status IN (${VOTABLE_IN}))`;
  const change = vote
    ? db
        .prepare(
          `INSERT INTO votes (hash, idea) SELECT ?, ?
           WHERE ${takes} AND NOT EXISTS (SELECT 1 FROM votes WHERE idea = ? AND hash IN (${any}))
           ON CONFLICT (hash) DO NOTHING`,
        )
        .bind(hash, id, id, ...VOTABLE, id, ...hashes)
    : db
        .prepare(`DELETE FROM votes WHERE idea = ? AND hash IN (${any}) AND ${takes}`)
        .bind(id, ...hashes, id, ...VOTABLE);
  const [, after] = await db.batch([
    change,
    db
      .prepare(
        `SELECT status, votes,
           EXISTS (SELECT 1 FROM votes WHERE idea = ? AND hash IN (${any})) AS voted
         FROM ideas WHERE id = ?`,
      )
      .bind(id, ...hashes, id),
  ]);
  const idea = after?.results[0] as { status: Status; votes: number; voted: number } | undefined;
  if (!idea || idea.status === 'merged') return 'not-found';
  if (!VOTABLE.includes(idea.status)) return 'closed';
  return { voted: idea.voted === 1, votes: idea.votes };
}

/**
 * Changes an idea from the admin page: its words, approving it, or moving it along. Shipped
 * needs the version it shipped in, and only a shipped idea keeps one. Shipped and not planned
 * close it, which forgets whoever suggested it's email.
 */
export async function changeIdea(
  db: Db,
  id: string,
  change: Change,
  at = new Date(),
): Promise<'changed' | 'not-found' | { problem: string }> {
  const idea = await db.prepare('SELECT * FROM ideas WHERE id = ?').bind(id).first<Row>();
  if (!idea || idea.status === 'merged') return 'not-found';
  const status = change.status ?? idea.status;
  const version = status === 'shipped' ? (change.version ?? idea.version) : null;
  if (status === 'shipped' && !version) {
    return { problem: 'Say which version it shipped in, such as 0.19.0.' };
  }
  const { meta } = await db
    .prepare(
      `UPDATE ideas SET title = ?, words = ?, status = ?, version = ?,
         email = CASE WHEN ? THEN NULL ELSE email END, updated_at = ?
       WHERE id = ? AND status != 'merged'`,
    )
    .bind(
      change.title ?? idea.title,
      change.words ?? idea.words,
      status,
      version,
      CLOSED.includes(status) ? 1 : 0,
      stamp(at),
      id,
    )
    .run();
  // Merged meanwhile, from another tab.
  return meta.changes ? 'changed' : 'not-found';
}

/**
 * Merges an idea into another that's been approved, which takes its votes and anything merged
 * into it before. The merged idea leaves the page, and whoever suggested it's email is forgotten.
 * A browser that voted for both counts twice: the votes can't tell it's the same one. Each step
 * checks both ideas again, so two merges at once, such as each into the other, can't both happen.
 */
export async function mergeIdea(
  db: Db,
  id: string,
  into: string,
  at = new Date(),
): Promise<'merged' | 'not-found' | { problem: string }> {
  if (id === into) return { problem: 'An idea can’t be merged into itself.' };
  const { results } = await db
    .prepare('SELECT * FROM ideas WHERE id IN (?, ?)')
    .bind(id, into)
    .all<Row>();
  const from = results.find((row) => row.id === id);
  const target = results.find((row) => row.id === into);
  if (!from || from.status === 'merged') return 'not-found';
  if (!target || target.status === 'merged' || target.status === 'new') {
    return { problem: 'Merge it into an idea you’ve approved.' };
  }
  const both = `EXISTS (SELECT 1 FROM ideas WHERE id = ?1 AND status != 'merged')
    AND EXISTS (SELECT 1 FROM ideas WHERE id = ?2 AND status NOT IN ('new', 'merged'))`;
  const [, , merged] = await db.batch([
    db.prepare(`UPDATE votes SET idea = ?2 WHERE idea = ?1 AND ${both}`).bind(id, into),
    db
      .prepare(`UPDATE ideas SET merged_into = ?2 WHERE merged_into = ?1 AND ${both}`)
      .bind(id, into),
    db
      .prepare(
        `UPDATE ideas SET status = 'merged', merged_into = ?2, version = NULL, email = NULL,
           updated_at = ?3
         WHERE id = ?1 AND ${both}`,
      )
      .bind(id, into, stamp(at)),
    db
      .prepare(
        `UPDATE ideas SET updated_at = ?3
         WHERE id = ?2 AND EXISTS (SELECT 1 FROM ideas WHERE id = ?1 AND merged_into = ?2)`,
      )
      .bind(id, into, stamp(at)),
  ]);
  return merged?.meta.changes ? 'merged' : 'not-found';
}

/**
 * Deletes an idea: a new suggestion Steve declines, or one on the page, as when whoever suggested
 * it asks. Its votes go with it, its email, and the ideas merged into it, which only held their
 * votes' place.
 */
export async function deleteIdea(db: Db, id: string): Promise<'deleted' | 'not-found'> {
  const live = "EXISTS (SELECT 1 FROM ideas WHERE id = ?1 AND status != 'merged')";
  const [, , deleted] = await db.batch([
    db.prepare(`DELETE FROM votes WHERE idea = ?1 AND ${live}`).bind(id),
    db.prepare(`DELETE FROM ideas WHERE merged_into = ?1 AND ${live}`).bind(id),
    db.prepare("DELETE FROM ideas WHERE id = ?1 AND status != 'merged'").bind(id),
  ]);
  return deleted?.meta.changes ? 'deleted' : 'not-found';
}

/** How many ideas one statement names, well within D1's 100 values to a statement. */
const AT_ONCE = 90;

/**
 * Declines the new suggestions the admin page shows, all at once, as after a flood of them. Only
 * those still new go: one approved meanwhile stays. Gives how many were declined.
 */
export async function declineNew(db: Db, ids: readonly string[]): Promise<number> {
  const statements: Statement[] = [];
  for (let start = 0; start < ids.length; start += AT_ONCE) {
    const some = ids.slice(start, start + AT_ONCE);
    const any = some.map(() => '?').join(', ');
    statements.push(
      db
        .prepare(
          `DELETE FROM votes WHERE idea IN (${any})
           AND idea IN (SELECT id FROM ideas WHERE status = 'new')`,
        )
        .bind(...some),
      db.prepare(`DELETE FROM ideas WHERE id IN (${any}) AND status = 'new'`).bind(...some),
    );
  }
  if (statements.length === 0) return 0;
  const results = await db.batch(statements);
  return results
    .filter((_, index) => index % 2 === 1)
    .reduce((sum, each) => sum + each.meta.changes, 0);
}

/** Forgets the email someone left with an idea, as when they ask. */
export async function forgetEmail(
  db: Db,
  id: string,
  at = new Date(),
): Promise<'forgotten' | 'not-found'> {
  const { meta } = await db
    .prepare("UPDATE ideas SET email = NULL, updated_at = ? WHERE id = ? AND status != 'merged'")
    .bind(stamp(at), id)
    .run();
  return meta.changes ? 'forgotten' : 'not-found';
}
