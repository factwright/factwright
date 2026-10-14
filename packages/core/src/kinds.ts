import { slug } from './keys.ts';

/**
 * A kind of job's id, such as "project-manager": lowercase letters, digits and hyphens. It's made
 * from the kind's name when the user adds it, and stays when they rename it, since jobs, job
 * searches and starting resumes go by it. It names a folder in base/, so it's never a name
 * Windows keeps for itself, such as "prn".
 */
export const KIND_ID = /^(?!(?:con|prn|aux|nul|com[0-9]|lpt[0-9])$)[a-z0-9][a-z0-9-]{0,39}$/;

/** One of the kinds of job the user wants, by its id and its name. */
export interface KindName {
  id: string;
  name: string;
}

/** How many kinds of job the app keeps, the first included, and how long a kind's name runs. */
export const KIND_LIMITS = { kinds: 6, name: 60 } as const;

/** Where the kinds of job are kept in the workspace. */
export const KINDS_FILE = 'about-me/kinds-of-job.json';

/** A kind of job's name as it's kept: on one line, with single spaces. */
export const kindNameText = (name: string) => name.replace(/\s+/g, ' ').trim();

/** What kinds of job are told apart by: their names, kept as they're kept, in any case. */
export const kindNameKey = (name: string) => kindNameText(name).toLowerCase();

/** Whether two kinds of job are the same one, by id or by name. */
export const sameKind = (a: KindName, b: KindName) =>
  a.id === b.id || kindNameKey(a.name) === kindNameKey(b.name);

/** An id for a new kind of job, from its name, that none of the others has. */
export function kindIdFor(name: string, taken: readonly string[]): string {
  const words = slug(name).slice(0, 32).replace(/-+$/, '') || 'kind';
  // A name Windows keeps for itself, such as "prn", can't name a folder in base/.
  const base = KIND_ID.test(words) ? words : `${words}-jobs`;
  let id = base;
  for (let n = 2; taken.includes(id); n++) id = `${base}-${n}`;
  return id;
}

/** A kind of job's id and name, as a file holds them, or null when either doesn't hold up. */
export function readKindName(value: unknown): KindName | null {
  if (typeof value !== 'object' || value === null) return null;
  const { id, name } = value as Record<string, unknown>;
  if (typeof id !== 'string' || !KIND_ID.test(id)) return null;
  if (typeof name !== 'string' || name.length > KIND_LIMITS.name) return null;
  const named = kindNameText(name);
  return named ? { id, name: named } : null;
}

/**
 * The kinds of job the kinds file holds, by id and name, as the app reads them: the first kind,
 * then each other one that holds up and isn't one before it, as many as the app keeps. None
 * when the file holds no other kind, since then there's one kind, unnamed. A first kind the file
 * doesn't name, as after a hand edit, is named for the user's first job title.
 */
export function kindNamesIn(file: unknown, firstTitle = ''): KindName[] {
  const { first, others } = (typeof file === 'object' && file !== null ? file : {}) as Record<
    string,
    unknown
  >;
  const named = readKindName(first);
  const kept: KindName[] = [];
  for (const each of Array.isArray(others) ? others : []) {
    if (kept.length === KIND_LIMITS.kinds - 1) break;
    const kind = readKindName(each);
    const clashes = (other: KindName) => kind !== null && sameKind(other, kind);
    if (kind && !kept.some(clashes) && !(named && clashes(named))) kept.push(kind);
  }
  if (kept.length === 0) return [];
  const name =
    kindNameText(firstTitle).slice(0, KIND_LIMITS.name).trim() || 'Your first kind of job';
  return [
    named ?? {
      id: kindIdFor(
        name,
        kept.map((kind) => kind.id),
      ),
      name,
    },
    ...kept,
  ];
}

/** The text between the first two backticks, as in "Project manager (`project-manager`)". */
function quoted(text: string): string {
  const open = text.indexOf('`');
  const close = open < 0 ? -1 : text.indexOf('`', open + 1);
  return close < 0 ? '' : text.slice(open + 1, close).trim();
}

/** The text before a "(…)" that ends it, as the name in "Project manager (`pm`)". */
function beforeParentheses(text: string): string {
  const open = text.lastIndexOf('(');
  return text.endsWith(')') && open > 0 ? text.slice(0, open).trim() : text;
}

/**
 * The kind of job a job search or fit check named: by its id, as in "Project manager
 * (`project-manager`)", which is how Factwright's tools show a kind, or by its name written any
 * way, such as "Project Manager". Null when it names none of the user's kinds.
 */
export function kindNamed(word: string | null, kinds: readonly KindName[]): string | null {
  const said = word?.trim();
  if (!said) return null;
  // What's in backticks first, then the whole, then the name before an id in parentheses.
  const tries = [quoted(said), said, beforeParentheses(said)].filter(Boolean);
  for (const each of tries) {
    const key = slug(each);
    const found =
      kinds.find((kind) => kind.id === each) ??
      kinds.find((kind) => kind.name.toLowerCase() === each.toLowerCase()) ??
      // A name in letters slug can't keep, such as Japanese, slugs to nothing, and matches none.
      (key ? kinds.find((kind) => kind.id === key || slug(kind.name) === key) : undefined);
    if (found) return found.id;
  }
  return null;
}

/**
 * Which of the user's kinds of job a job is under: the one they put it under, or else the one
 * its job search or fit check found it as, or else the first. So a job from before there was a
 * second kind, or under a kind since removed, is under the first. Null when there are no kinds.
 */
export function kindOfJob(
  job: { kind: string | null; kindFound: string | null },
  kinds: readonly KindName[],
): string | null {
  return kindNamed(job.kind, kinds) ?? kindNamed(job.kindFound, kinds) ?? kinds[0]?.id ?? null;
}
