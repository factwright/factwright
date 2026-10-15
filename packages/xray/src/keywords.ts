import type { FactTerms } from './facts.ts';
import { type Need, readPosting } from './posting.ts';
import { findTerm, findTerms, plain, type Term, termOf } from './terms.ts';
import { VOCABULARY } from './vocabulary.ts';

/**
 * What the fact bank says about a term missing from the resume. Honesty decides what to do:
 * - said-no: gaps.md says the user doesn't have it. That's settled, whatever else says so.
 * - doubted: gaps.md says it needs confirming, so check it before adding it.
 * - facts: skills.md, a claim that can go on a resume, or for a credential, profile.md, backs
 *   it. So add it.
 * - to-check: only a claim the user hasn't checked has it, unconfirmed or low confidence.
 * - none: nothing backs it. It's a real gap, so it stays off the resume.
 */
export type Backing =
  | { kind: 'said-no'; where: string }
  | { kind: 'doubted'; where: string }
  | { kind: 'facts'; where: string }
  | { kind: 'to-check'; where: string }
  | { kind: 'none' };

export interface KeyTerm {
  /** The term as the posting writes it. */
  term: string;
  need: Need;
  /** The words in the resume that match, or null when it's missing. */
  found: string | null;
  /** True when the resume has it by another name, such as "Postgres" for "PostgreSQL". */
  otherName: boolean;
  /** For a missing term: what the fact bank says. */
  backing: Backing;
  /** The posting's line it comes from. */
  context: string;
}

export interface KeywordReport {
  /** True when the posting says which are must-haves and which are nice to have. */
  sectioned: boolean;
  terms: KeyTerm[];
}

/** The most terms listed. Long postings name far more than matter. */
const MAX_TERMS = 40;

/**
 * Acronyms postings use that aren't skills: places, regions, titles, degrees, business numbers
 * and the like. A degree or a skill these could stand for is in the vocabulary by its full name.
 */
const NOT_TERMS = new Set(
  [
    'US USA UK EU EEO EOE EEOC ADA PTO OK ID CEO CFO CTO COO CMO CIO CPO VP SVP EVP AVP FTE HQ NYC',
    'SF LA DC WFH OTE TBD ASAP FAQ ETA AM PM ET PT CT MT EST PST CST MST UTC GMT LLC INC LTD CO BA',
    'BS MA MS PHD BSC MSC YOE NA AND OR THE FOR WITH YOU WE OUR ALL NOT MUST WILL ARE CAN NEW USD',
    'IC TL EM HR IT CS PR PRS EMEA APAC LATAM NAM AMER ANZ DACH ROI CAC LTV ARR MRR NPS CSAT GMV',
    'ROAS CTR CPC CPM GPA FAANG MAANG SMB MBO EOD EOW',
    // States and provinces, as in "Austin, TX".
    'AL AK AZ AR CA CT DE FL GA HI IA IL IN KS KY ME MD MI MN MO NE NV NH NJ NM NY NC ND OH OR PA',
    'RI SC SD TN TX UT VT VA WA WV WI WY PR AB BC MB NB NL NS ON PE QC SK',
  ]
    .join(' ')
    .split(' '),
);

/** Words that look like a tool's name by their capitals or marks: "GraphQL", "Node.js", "C#", "HIPAA". */
const TOOLISH =
  /(?<![\p{L}\p{N}.])(?:\p{L}+\p{Ll}\p{Lu}[\p{L}\p{N}]*|\p{L}[\p{L}\p{N}]*\.(?:js|io|net|ts|ai)|\p{Lu}[\p{L}]*(?:\+\+|#)|\p{Lu}{2,6}\d*)(?![\p{L}\p{N}])/gu;

/** A term from the user's words: the one the X-ray knows by that name, or a new one. */
const term = (text: string): Term => {
  const known = VOCABULARY.find((each) =>
    each.forms.some((form) => form.text.toLowerCase() === text.toLowerCase()),
  );
  if (known) return known;
  // A word of three letters or fewer keeps its capitals, so "Go" isn't "go".
  return termOf(text.length <= 3 && /\p{Lu}/u.test(text) ? `=${text}` : text);
};

/** The user's own terms, from skills.md and Keywords lines, split into single terms. */
function factTerms(facts: FactTerms | null): Term[] {
  if (!facts) return [];
  const items = [...facts.skills, ...facts.keywords, ...facts.toCheck].flatMap(({ text }) =>
    text
      .replace(/\([^)]*\)/g, ',')
      .split(/[,;·•]|\s+\/\s+/)
      .map((each) => each.replace(/\*\*/g, '').trim())
      .filter((each) => each.length >= 2 && each.length <= 40 && each.split(/\s+/).length <= 4),
  );
  return [...new Map(items.map((each) => [each.toLowerCase(), term(each)])).values()];
}

/** Terms a line names by their look alone, such as "GraphQL", "Node.js" or "HIPAA". */
function toolish(line: string): Term[] {
  const letters = line.match(/\p{L}/gu)?.length ?? 0;
  const capitals = line.match(/\p{Lu}/gu)?.length ?? 0;
  // A line in capitals throughout is shouting, not naming.
  if (letters > 0 && capitals / letters > 0.6) return [];
  return [...line.matchAll(TOOLISH)]
    .map((match) => match[0])
    .filter((word) => {
      const upper = word.toUpperCase();
      return !NOT_TERMS.has(upper) && !NOT_TERMS.has(upper.replace(/S$/, ''));
    })
    .map((word) => termOf(word));
}

/**
 * What the fact bank says about a term the resume doesn't have. A credential, such as PMP or a
 * degree, counts only where profile.md says the user has it: a skill or a claim about work
 * doesn't earn one.
 */
function backingOf(found: Term, facts: FactTerms | null): Backing {
  if (!facts) return { kind: 'none' };
  const has = (text: string) => findTerm(text, found) !== null;
  const said = facts.saidNo.find(has);
  if (said) return { kind: 'said-no', where: said };
  const doubt = facts.toConfirm.find(has);
  if (doubt) return { kind: 'doubted', where: doubt };
  const sources = found.credential
    ? facts.credentials
    : [...facts.skills, ...facts.keywords, ...facts.credentials];
  const backed = sources.find((source) => has(source.text));
  if (backed) return { kind: 'facts', where: backed.where };
  const check = found.credential ? undefined : facts.toCheck.find((source) => has(source.text));
  if (check) return { kind: 'to-check', where: check.where };
  return { kind: 'none' };
}

/**
 * The posting's key terms, each found in the resume or not, and for each one missing, what the
 * fact bank says: add it, confirm it first, or leave it off, as a real gap. Must-haves come first.
 */
export function matchKeywords(
  posting: string,
  resume: string,
  facts: FactTerms | null,
): KeywordReport {
  const { lines, sectioned } = readPosting(posting);
  const known = [...VOCABULARY, ...factTerms(facts)];
  const seen = new Map<Term | string, KeyTerm>();
  const add = (found: Term, text: string, need: Need, context: string) => {
    const key = VOCABULARY.includes(found) ? found : found.name.toLowerCase();
    const before = seen.get(key);
    if (before) {
      if (need === 'must') before.need = 'must';
      return;
    }
    const inResume = findTerm(resume, found);
    // The form the posting uses, which the resume may have by another name.
    const asked = found.forms.find((form) => findTerm(text, { name: form.text, forms: [form] }));
    const otherName =
      !!inResume &&
      !!asked &&
      !findTerm(resume, { name: asked.text, forms: [asked] }) &&
      !sameWord(inResume, text);
    seen.set(key, {
      term: text,
      need,
      found: inResume,
      otherName,
      backing: inResume ? { kind: 'none' } : backingOf(found, facts),
      context: line(context),
    });
  };
  for (const { text, need } of lines) {
    const hits = findTerms(text, known);
    for (const hit of hits) add(hit.term, hit.text, need, text);
    const covered = (word: string) =>
      hits.some((hit) => plain(hit.text).toLowerCase().includes(word.toLowerCase()));
    for (const extra of toolish(text)) if (!covered(extra.name)) add(extra, extra.name, need, text);
  }
  const terms = [...seen.values()];
  const ordered = [
    ...terms.filter((each) => each.need === 'must'),
    ...terms.filter((each) => each.need === 'nice'),
  ];
  return { sectioned, terms: ordered.slice(0, MAX_TERMS) };
}

/** Endings that make another form of the same word, such as "mentoring" for "mentor". */
const ENDINGS = /^(?:s|es|d|ed|ing|[bdgmnpt]ing|[bdgmnpt]ed|er|ers|ship|ment|ments)$/;

/** Whether two words are forms of one, such as "Mentoring" and "mentor", not another name. */
function sameWord(a: string, b: string): boolean {
  const [short, long] = [a, b]
    .map((word) =>
      plain(word)
        .toLowerCase()
        .replace(/[\s-]+/g, ''),
    )
    .sort((x, y) => x.length - y.length) as [string, string];
  return long === short || (long.startsWith(short) && ENDINGS.test(long.slice(short.length)));
}

/** A posting's line, shortened to show beside its term. */
const line = (text: string) => (text.length > 140 ? `${text.slice(0, 139).trimEnd()}…` : text);
