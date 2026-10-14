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

/**
 * The kind of job a job search or fit check named: by its id, as in "Project manager
 * (`project-manager`)", which is how Factwright's tools show a kind, or by its name written any
 * way, such as "Project Manager". Null when it names none of the user's kinds.
 */
export function kindNamed(word: string | null, kinds: readonly KindName[]): string | null {
  const said = word?.trim();
  if (!said) return null;
  const quoted = said.match(/`([^`]+)`/)?.[1]?.trim();
  if (quoted) return kinds.find((kind) => kind.id === quoted)?.id ?? null;
  const key = slug(said);
  return (
    kinds.find((kind) => kind.id === said)?.id ??
    kinds.find((kind) => kind.name.toLowerCase() === said.toLowerCase())?.id ??
    // A name in letters slug can't keep, such as Japanese, slugs to nothing, and matches none.
    (key ? kinds.find((kind) => kind.id === key || slug(kind.name) === key)?.id : undefined) ??
    null
  );
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
