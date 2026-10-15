/**
 * Terms a posting asks for, such as "PostgreSQL" or "patient education", and how to find each one
 * in a posting, a resume or the fact bank: as a whole word, in any case unless it's an everyday
 * word or a short acronym, and by its other names, such as "Postgres".
 */

/** One way to write a term. */
export interface Form {
  text: string;
  /** Matched only with these capitals, for a word that's also an everyday word, such as "Go". */
  exact: boolean;
  /** A one-letter language, such as R, matched only in a list, such as "Python, R and SQL". */
  listed: boolean;
  /** Matched in any case, and as the everyday word too, to find it in what the user said no to. */
  loose?: boolean;
}

export interface Term {
  /** Its name, the first of its forms. */
  name: string;
  forms: Form[];
  /**
   * A certification, license, degree or field of study, such as PMP or Computer Science, which
   * only what profile.md says the user has earned can back.
   */
  credential?: boolean;
}

/** Text as it's matched: compatibility characters made plain, and quotes and dashes made one kind. */
export const plain = (text: string) =>
  text
    .normalize('NFKC')
    .replace(/[\u{2018}\u{2019}]/gu, "'")
    .replace(/[\u{201C}\u{201D}]/gu, '"')
    .replace(/[\u{2010}-\u{2015}]/gu, '-');

/**
 * A term from its spec: its forms with "|" between, a "=" before one matched with its capitals
 * only, and a "~" before a one-letter language. A short acronym, such as "SQL", always keeps its
 * capitals, so "it" is never "IT".
 */
export function termOf(spec: string): Term {
  const forms = spec.split('|').map((part) => {
    const listed = part.startsWith('~');
    const exact = listed || part.startsWith('=');
    const text = part.replace(/^[=~]/, '').trim();
    return { text, exact: exact || /^[A-Z0-9&+#/.-]{2,5}$/.test(text), listed };
  });
  return { name: forms[0]?.text ?? spec, forms };
}

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const patterns = new Map<string, RegExp>();

/**
 * Words that, after an everyday word with a capital, show it's the word and not the tool, as
 * when a line starts "Excel at" or "Go above and beyond".
 */
const NOT_BEFORE: Readonly<Record<string, string>> = {
  Excel: 'at|in|as|under|when|with',
  Go: 'to|live|above|beyond|deep|deeper|further|far|back|after|out|in|on|for|the|a|an',
  Lean: 'in|into|on|toward|towards',
  Spring: 'semester|term|break|of|\\d{4}',
  Swift: 'response|responses|action|resolution|turnaround|delivery',
  Unity: 'of|among|between',
  Slack: 'time|off|in',
};

/** Words joined to an everyday word by a hyphen that show it's the word: "Go-to-market", "Go-live". */
const NOT_JOINED: Readonly<Record<string, string>> = {
  Go: 'to|live|getter|ahead|between|around',
};

/** What can't follow a form, as the everyday word: "Go above", "Go-live". */
function notAfter(form: Form): string {
  if (form.loose) return '';
  const words = NOT_BEFORE[form.text];
  const joined = NOT_JOINED[form.text];
  const not = [words && `\\s+(?:${words})\\b`, joined && `-(?:${joined})\\b`].filter(Boolean);
  return not.length > 0 ? `(?!${not.join('|')})` : '';
}

/** The pattern that finds a form as a whole word, with "-", a comma or a space between its words. */
export function patternOf(form: Form): RegExp {
  const key = `${form.exact ? '=' : ''}${form.listed ? '~' : ''}${form.loose ? '?' : ''}${form.text}`;
  const known = patterns.get(key);
  if (known) return known;
  const words = plain(form.text).split(/[\s,-]+/);
  const body = words
    .map((word) => escapeRegex(word).replace(/\//g, '\\s*/\\s*').replace(/^and$/i, '(?:and|&)'))
    .join(',?[\\s-]+');
  // Plurals for a phrase or an acronym, such as "data pipelines" or "KPIs", but not for a name.
  const plural =
    /\p{L}$/u.test(form.text) &&
    !form.listed &&
    (words.length > 1 || /^[A-Z]{2,5}$/.test(form.text))
      ? '(?:s|es)?'
      : '';
  const notBefore = notAfter(form);
  const pattern = form.listed
    ? `(?<=(?:^|[,(/;:]|\\band|\\bor)\\s*)${body}(?=\\s*(?:[,)/;]|$|and\\b|or\\b|programming\\b|language\\b))`
    : `(?<![\\p{L}\\p{N}_])${body}${plural}(?![\\p{L}\\p{N}_+#])${notBefore}`;
  const regex = new RegExp(pattern, form.exact && !form.loose ? 'gmu' : 'gimu');
  patterns.set(key, regex);
  return regex;
}

/** One place a term is found. */
export interface Hit {
  term: Term;
  /** The words as the text has them. */
  text: string;
  at: number;
}

/** A quick look for a form's first letters, so most patterns never run on text that can't hold them. */
const mayHold = (lower: string, form: Form) =>
  lower.includes(
    plain(form.text)
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/u)?.[0] ?? '',
  );

/**
 * Every term found in a text, the longest where two overlap, so "React Native" is one term and
 * not "React" as well. In the order they come.
 */
export function findTerms(text: string, terms: readonly Term[]): Hit[] {
  const source = plain(text);
  const lower = source.toLowerCase();
  const hits: Hit[] = [];
  for (const term of terms) {
    for (const form of term.forms) {
      if (!mayHold(lower, form)) continue;
      // Patterns are shared, so each search starts from the beginning.
      const pattern = patternOf(form);
      pattern.lastIndex = 0;
      for (const match of source.matchAll(pattern)) {
        hits.push({ term, text: match[0], at: match.index ?? 0 });
      }
    }
  }
  hits.sort((a, b) => a.at - b.at || b.text.length - a.text.length);
  const kept: Hit[] = [];
  for (const hit of hits) {
    const last = kept.at(-1);
    if (last && hit.at < last.at + last.text.length) continue;
    kept.push(hit);
  }
  return kept;
}

/** Where a term is in a text, by any of its forms: the words as the text has them, or null. */
export function findTerm(text: string, term: Term): string | null {
  const source = plain(text);
  const lower = source.toLowerCase();
  for (const form of term.forms) {
    if (!mayHold(lower, form)) continue;
    const pattern = patternOf(form);
    pattern.lastIndex = 0;
    const match = pattern.exec(source);
    if (match) return match[0];
  }
  return null;
}

/**
 * Where a term is in what the user said, in any case and even as the everyday word: "go in
 * production" names Go. It finds more than findTerm, which is safe for what the user said they
 * don't have, or not to claim, since that only ever keeps a term off.
 */
export function findTermLoosely(text: string, term: Term): string | null {
  return findTerm(text, {
    ...term,
    forms: term.forms.map((form) => ({ ...form, exact: false, loose: true })),
  });
}
