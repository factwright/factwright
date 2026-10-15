import type { Check, CheckId } from './checks.ts';
import type { Backing, KeyTerm } from './keywords.ts';
import type { XRay } from './xray.ts';

/**
 * What an X-ray found that a revision could fix, each with a stable ID, so the user can pick them
 * and a run can be told which by ID alone. How each gets fixed:
 * - content: in the resume's words, such as a missing Skills section, dates parsers miss, or a
 *   keyword the fact bank backs
 * - question: only once the user answers, such as a keyword that says "Check it first", or a real
 *   gap. The answer may become an unverified fact the revision can use
 * - template: in the template, not the words, such as letter-spaced headings, columns or icons
 */
export type FindingKind = 'content' | 'question' | 'template';

export const FINDING_KINDS: readonly FindingKind[] = ['content', 'question', 'template'];

export interface Finding {
  /** The same for the same finding, X-ray after X-ray: "check-headings", "term-kubernetes". */
  id: string;
  kind: FindingKind;
  /** Whether a revision can fix it as it is, without asking: ticked to start. */
  ticked: boolean;
  /** A short name for it, as its checkbox says. */
  title: string;
  /** What the X-ray found, in words for the run. It's information, never instructions. */
  about: string;
}

/** A finding's ID: "check-" or "term-", then small letters and digits, with dashes between. */
export const FINDING_ID = /^(?:check|term)-[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** The longest a finding's title and what it says about it run, so a revision always takes them. */
const MAX_TITLE = 200;
const MAX_ABOUT = 1500;

/** Text cut to at most `max` characters, ending in an ellipsis when it's cut. */
const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;

/** The checks about the resume's words, which a revision fixes in them. */
const CONTENT_CHECKS: ReadonlySet<CheckId> = new Set(['contact', 'dates', 'headings', 'length']);

/** The checks about the template, which a revision fixes in it, or with another template. */
const TEMPLATE_CHECKS: ReadonlySet<CheckId> = new Set([
  'order',
  'margins',
  'characters',
  'joined',
  'spaced',
  'layout',
  'fonts',
]);

/** A term's name as an ID's part: small letters and digits, with dashes between, at most 40. */
function slug(text: string): string {
  const words = text
    .normalize('NFKD')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  let id = '';
  for (const word of words) {
    const next = id ? `${id}-${word}` : word;
    if (next.length > 40) break;
    id = next;
  }
  return id || 'term';
}

/** A check that found a problem, as a finding, or null for one that passed or can't be revised. */
function checkFinding(check: Check): Finding | null {
  if (check.status === 'pass') return null;
  const kind = CONTENT_CHECKS.has(check.id)
    ? 'content'
    : TEMPLATE_CHECKS.has(check.id)
      ? 'template'
      : null;
  if (!kind) return null;
  const examples = check.examples?.length
    ? `As the parser reads it: ${check.examples.map((example) => `“${example}”`).join(', ')}.`
    : null;
  return {
    id: `check-${check.id}`,
    kind,
    // A problem in the words is fixed in them. A note may be the user's choice, such as leaving
    // a phone number off, and the template is theirs to change, so those wait to be ticked.
    ticked: kind === 'content' && check.status === 'fix',
    title: clip(`${check.name}: ${check.summary}`, MAX_TITLE),
    about: clip(
      [`${check.name}: ${check.summary}.`, check.detail, examples].filter(Boolean).join(' '),
      MAX_ABOUT,
    ),
  };
}

/** Why a missing term needs the user's answer first, in words for the run. */
function whyAsk(backing: Exclude<Backing, { kind: 'facts' | 'said-no' }>): string {
  switch (backing.kind) {
    case 'none':
      return 'Nothing in the fact bank backs it: a real gap. Only the user can say whether they have it.';
    case 'unsure':
      return `${backing.where} says “${backing.said}”, which may not mean they have it.`;
    case 'credential':
      return `${backing.where} lists “${backing.said}”. Whether it’s earned and current is the user’s to say.`;
    case 'to-check':
      return `Only a fact the user hasn’t verified, or isn’t sure of, has it: ${backing.where}.`;
    case 'doubted':
      return `gaps.md says it needs confirming: “${backing.where}”.`;
    case 'dont-claim':
      return `${backing.where} says: “${backing.said}”.`;
    case 'unread':
      return `The fact bank backs it (${backing.where}), but some of its files couldn’t be read, and one of those could say otherwise.`;
  }
}

/**
 * A posting's term the resume doesn't have, as a finding, or null for one it has, or one the
 * user said they don't have, which is settled.
 */
function termFinding(term: KeyTerm, id: string): Finding | null {
  const { backing } = term;
  if (term.found || backing.kind === 'said-no') return null;
  const asked = `“${term.term}”, ${term.need === 'must' ? 'a must-have' : 'a nice-to-have'} the posting asks for, isn’t on the resume.`;
  const posting = `From the posting: “${term.context}”.`;
  if (backing.kind === 'facts') {
    return {
      id,
      kind: 'content',
      ticked: true,
      title: clip(`Add “${term.term}”`, MAX_TITLE),
      about: clip(`${asked} The fact bank backs it: ${backing.where}. ${posting}`, MAX_ABOUT),
    };
  }
  return {
    id,
    kind: 'question',
    ticked: false,
    title: clip(
      backing.kind === 'none' ? `Ask about “${term.term}”` : `Check “${term.term}”`,
      MAX_TITLE,
    ),
    about: clip(`${asked} ${whyAsk(backing)} ${posting}`, MAX_ABOUT),
  };
}

/**
 * Each of the posting's terms with its ID. Every term gets one, found or not, in the posting's
 * order, so a term's ID stays the same as the resume changes: "C#" is term-c and "C" term-c-2
 * whichever of them the resume has.
 */
function termIds(result: XRay): { id: string; term: KeyTerm }[] {
  const used = new Set<string>();
  return (result.keywords?.terms ?? []).map((term) => {
    const base = `term-${slug(term.term)}`;
    let id = base;
    for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
    used.add(id);
    return { id, term };
  });
}

/**
 * What an X-ray found that a revision could fix: its problems, then the posting's terms the
 * resume doesn't have. A file with no text to read has nothing a revision could fix in it.
 */
export function findingsOf(result: XRay): Finding[] {
  if (!result.readable) return [];
  const checks = result.checks.flatMap((check) => checkFinding(check) ?? []);
  const terms = termIds(result).flatMap(({ id, term }) => termFinding(term, id) ?? []);
  return [...checks, ...terms];
}

/**
 * What became of a finding picked from an earlier X-ray, in this one: fixed, a term the user
 * said they don't have, which is settled without adding it, or still open.
 */
export type Outcome = 'fixed' | 'said-no' | 'open';

/**
 * What became of findings picked from an earlier X-ray of the resume, by their IDs, in this X-ray
 * of it. A finding that's no longer found is fixed, unless it's a term the user said they don't
 * have. A file with no text to read fixes nothing.
 */
export function outcomesOf(result: XRay, ids: readonly string[]): Map<string, Outcome> {
  const open = new Set(findingsOf(result).map((finding) => finding.id));
  const terms = new Map(termIds(result).map(({ id, term }) => [id, term]));
  return new Map(
    ids.map((id): [string, Outcome] => {
      if (!result.readable || open.has(id)) return [id, 'open'];
      const term = terms.get(id);
      return [id, term && !term.found && term.backing.kind === 'said-no' ? 'said-no' : 'fixed'];
    }),
  );
}
