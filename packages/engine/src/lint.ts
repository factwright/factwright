import { PLACEHOLDER } from './markup.ts';
import type { Resume } from './schema.ts';

/**
 * The machine-checkable rules for the user's resumes, from the workspace's guide/lint.json. Each
 * one is optional, and the user's rules decide them.
 */
export interface LintConfig {
  /** The most pages a resume may run to. Two when unset. */
  maxPages?: number;
  /** How many lines the skills section must have. */
  skillsLines?: number;
  /** How many systems cards there must be. */
  systemsCards?: number;
  /** The fewest and most words a systems card may have. */
  cardWords?: [number, number];
  /** Exact titles by company, such as { "Acme": "Staff Engineer" }. */
  titles?: Record<string, string>;
  /** Wording that must never appear, as case-blind patterns, with why, and matches to allow. */
  banned?: { pattern: string; why: string; allow?: string }[];
}

/** The pages a resume may run to when the user's rules don't say. */
export const DEFAULT_MAX_PAGES = 2;

/** Fields kept for the user's history, which the resume never shows. */
const HISTORY_KEYS = new Set(['change_log', 'notes']);

/** Every piece of text a resume shows. */
function shownText(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const each of value) shownText(each, out);
  else if (value && typeof value === 'object') {
    for (const [key, each] of Object.entries(value)) {
      // Notes to check with the user, such as "confirm_with_user", aren't shown either.
      if (!HISTORY_KEYS.has(key) && !key.startsWith('confirm')) shownText(each, out);
    }
  }
  return out;
}

function pattern(source: string, flags: string): RegExp | null {
  try {
    return new RegExp(source, flags);
  } catch {
    return null;
  }
}

/**
 * Checks a resume against the user's rules, and against their confidential terms, such as
 * customers' names, which must never reach an employer. Returns each problem in plain words.
 */
export function lintResume(
  resume: Resume,
  config: LintConfig = {},
  confidential: readonly string[] = [],
): string[] {
  const issues: string[] = [];
  const text = shownText(resume).join('\n');
  if (new RegExp(PLACEHOLDER).test(text)) issues.push('A [[placeholder]] is still in the resume.');

  for (const rule of config.banned ?? []) {
    const banned = pattern(rule.pattern, 'gi');
    if (!banned) {
      issues.push(`The rule "${rule.pattern}" in guide/lint.json isn't a valid pattern.`);
      continue;
    }
    const allow = rule.allow ? pattern(rule.allow, 'i') : null;
    const hit = [...text.matchAll(banned)].find((match) => !allow?.test(match[0]));
    if (hit) issues.push(`"${hit[0]}" isn't allowed: ${rule.why}.`);
  }

  for (const term of confidential) {
    const secret = pattern(term, 'i');
    // A line that won't read as a pattern would otherwise protect nothing, without a word.
    if (!secret) {
      issues.push(
        `The confidential term "${term}" in guide/confidential-terms.txt isn't a valid pattern. Put a \\ before any of . ( ) [ ] + ? * | in it.`,
      );
    } else if (secret.test(text)) {
      issues.push(`A confidential term matching "${term}" is in the resume.`);
    }
  }

  for (const [company, title] of Object.entries(config.titles ?? {})) {
    const job = resume.experience.find((e) => e.company === company);
    if (job && job.title !== title) {
      issues.push(`The title at ${company} must be exactly "${title}", not "${job.title}".`);
    }
  }

  if (config.skillsLines && resume.skills?.length && resume.skills.length !== config.skillsLines) {
    issues.push(
      `The skills need exactly ${config.skillsLines} lines, not ${resume.skills.length}.`,
    );
  }
  if (
    config.systemsCards &&
    resume.systems?.length &&
    resume.systems.length !== config.systemsCards
  ) {
    issues.push(
      `The systems need exactly ${config.systemsCards} cards, not ${resume.systems.length}.`,
    );
  }
  if (config.cardWords) {
    const [fewest, most] = config.cardWords;
    for (const card of resume.systems ?? []) {
      const words = card.text.split(/\s+/).filter(Boolean).length;
      if (words < fewest || words > most) {
        issues.push(`The "${card.name}" card has ${words} words; keep it to ${fewest}–${most}.`);
      }
    }
  }
  return issues;
}

/**
 * Reads the user's confidential terms: one pattern per line, with blank lines and lines starting
 * with "#" skipped.
 */
export function readConfidentialTerms(text: string | null): string[] {
  return (text ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
}
