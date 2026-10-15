import { type FactBlock, factBlocks, UNCONFIRMED } from '@factwright/core';

/**
 * What the fact bank says about terms, read with the same parser the app's Fact bank uses, the
 * way the skills write it (facts/README.md). A term the bank backs can go on a resume. One it
 * doesn't back is a real gap. So it reads only what the bank says is true:
 * - skills.md's skills, by name, leaving out any the user is still learning or wants to learn
 * - the degrees, certifications, licenses and languages profile.md says the user has, not ones
 *   in progress
 * - each claim's Keywords line, as long as the claim can go on a resume. A `plan-only` claim
 *   never can. One tagged `unconfirmed` or `low` waits for the user to check it first
 * - what gaps.md says the user doesn't have, which settles it, and what it says needs confirming
 */

/** A file of the fact bank: its path in the workspace, such as "facts/skills.md", and its text. */
export interface FactFile {
  path: string;
  text: string;
}

/** Words in the fact bank that can back a term, and where they are. */
export interface Source {
  text: string;
  /** Where they are, such as "skills.md" or "acme-health.md · Cut wait times". */
  where: string;
}

export interface FactTerms {
  /** Each skill in skills.md: a table row's first cell, or a list item's name. */
  skills: Source[];
  /** Each degree, certification, license and language profile.md says the user has. */
  credentials: Source[];
  /** Each Keywords line of a claim that can go on a resume. */
  keywords: Source[];
  /** Each Keywords line of a claim the user still has to check: unconfirmed, or low confidence. */
  toCheck: Source[];
  /** What gaps.md says the user doesn't have. */
  saidNo: string[];
  /** What gaps.md says needs confirming. */
  toConfirm: string[];
}

/** Words that say a skill isn't had yet: still learning it, or wanting to. */
const LEARNING =
  /\b(?:learning|to learn|studying|want to|plan to|planned|planning|someday|wishlist|interested in|exploring|not yet)\b/i;

/** A part of skills.md about skills to come, such as "Want to learn" or "Next". */
const LATER_PART =
  /\b(?:learn|learning|want|wants|plans?|goals?|wish|future|someday|next|interests?|exploring)\b/i;

/** Words that say a degree, certification or license isn't earned yet. */
const NOT_EARNED =
  /\b(?:in progress|pursuing|expected|studying|planned|planning|booked|scheduled|working toward|candidate|enrolled|incomplete|not completed|exam)\b/i;

const fileName = (path: string) => path.split('/').at(-1) ?? path;

/** A block's lines that aren't in a code block, such as a format example. */
function outsideCode(text: string): string[] {
  const kept: string[] = [];
  let fence: string | null = null;
  for (const line of text.split(/\r?\n/)) {
    const mark = line.match(/^\s{0,3}(`{3,}|~{3,})/)?.[1];
    if (fence) {
      if (mark && mark[0] === fence[0] && mark.length >= fence.length) fence = null;
    } else if (mark) {
      fence = mark;
    } else {
      kept.push(line);
    }
  }
  return kept;
}

/** Whether a line is a table's rule, such as "|---|:---:|". It reads in time with its length. */
const isRule = (line: string) => {
  const trimmed = line.trim();
  return trimmed.startsWith('|') && trimmed.includes('-') && /^[\s:|-]*$/.test(trimmed);
};

/** A table row's cells, or null for a line that isn't one, or is a table's rule. */
function cells(line: string): string[] | null {
  if (!line.trim().startsWith('|') || isRule(line)) return null;
  return line
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((cell) => cell.trim());
}

/** A list item's words, or null. */
const item = (line: string) => line.match(/^\s*(?:[-*+]|\d+[.)])\s+(.+)$/)?.[1]?.trim() ?? null;

/**
 * Each row's first cell and each list item in a block's lines, past a table's header row. With
 * `names`, a list item gives only its name, before any ":" or dash: "Python: daily" is Python.
 */
function entries(lines: readonly string[], names: boolean): { text: string; line: string }[] {
  const found: { text: string; line: string }[] = [];
  let header = true;
  for (const line of lines) {
    const row = cells(line);
    if (row) {
      // A table's first row names its columns.
      if (!header && row[0]) found.push({ text: row[0], line });
      header = false;
      continue;
    }
    if (!isRule(line)) header = true;
    const listed = item(line);
    if (listed) {
      const text = names ? (listed.split(/:|\s[—–-]\s/)[0] ?? listed) : listed;
      found.push({ text, line });
    }
  }
  return found.map(({ text, line }) => ({ text: text.replace(/\*\*/g, '').trim(), line }));
}

/** The skills in skills.md, past any part about skills the user wants or is still learning. */
function skillsIn(path: string, text: string): Source[] {
  return factBlocks(text, { claims: false })
    .filter((block) => !LATER_PART.test(block.title))
    .flatMap((block) => entries(outsideCode(block.text), true))
    .filter(({ text: skill, line }) => skill && !LEARNING.test(line))
    .map(({ text: skill }) => ({ text: skill, where: fileName(path) }));
}

/** The lines under profile.md's headings for degrees, certifications, licenses and languages. */
function credentialsIn(path: string, text: string): Source[] {
  return factBlocks(text, { claims: false })
    .filter((block) => /educat|degree|certif|licen[cs]|language|training/i.test(block.title))
    .flatMap((block) => outsideCode(block.body))
    .filter((line) => line.trim() && !NOT_EARNED.test(line))
    .map((line) => ({ text: (item(line) ?? line).trim(), where: fileName(path) }));
}

/** A claim's Keywords line, if it has one. */
function keywordsOf(block: FactBlock): string | null {
  for (const line of outsideCode(block.body)) {
    const keywords = line.match(/^\s*[-*+]\s+\*\*Keywords:?\*\*:?\s*(.+)$/i)?.[1];
    if (keywords) return keywords.trim();
  }
  return null;
}

/** What gaps.md lists under each of its parts, by its heading. */
function gapsIn(text: string): { saidNo: string[]; toConfirm: string[] } {
  const saidNo: string[] = [];
  const toConfirm: string[] = [];
  for (const block of factBlocks(text, { claims: false })) {
    const listed = entries(outsideCode(block.body), false).map((entry) => entry.text);
    if (/doesn['’]?t have|does not have|don['’]?t have/i.test(block.title)) saidNo.push(...listed);
    else if (/needs? confirm/i.test(block.title)) toConfirm.push(...listed);
  }
  return { saidNo, toConfirm };
}

/** What the fact bank's files say about terms. */
export function readFacts(files: readonly FactFile[]): FactTerms {
  const terms: FactTerms = {
    skills: [],
    credentials: [],
    keywords: [],
    toCheck: [],
    saidNo: [],
    toConfirm: [],
  };
  for (const file of files) {
    const name = fileName(file.path).toLowerCase();
    if (name === 'readme.md') continue;
    if (name === 'gaps.md') {
      const gaps = gapsIn(file.text);
      terms.saidNo.push(...gaps.saidNo);
      terms.toConfirm.push(...gaps.toConfirm);
      continue;
    }
    if (name === 'skills.md') terms.skills.push(...skillsIn(file.path, file.text));
    if (name === 'profile.md') terms.credentials.push(...credentialsIn(file.path, file.text));
    for (const block of factBlocks(file.text)) {
      const keywords = block.tags ? keywordsOf(block) : null;
      // A plan is never a fact, so a plan-only claim backs nothing.
      if (!block.tags || !keywords || block.tags.includes('plan-only')) continue;
      const source = { text: keywords, where: `${fileName(file.path)} · ${block.title}` };
      if (block.tags.includes(UNCONFIRMED) || block.tags.includes('low'))
        terms.toCheck.push(source);
      else terms.keywords.push(source);
    }
  }
  return terms;
}
