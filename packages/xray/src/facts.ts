import { FACT_TAGS, type FactBlock, factBlocks, UNCONFIRMED } from '@factwright/core';

/**
 * What the fact bank says about terms, read with the same parser the app's Fact bank uses, the
 * way the skills write it (facts/README.md). A term the bank backs can go on a resume. One it
 * doesn't back is a real gap. So it reads only what the bank says is true, and each line with
 * the headings and bold labels above it, so a "Want to learn" part's sub-headings are still in it:
 * - skills.md's skills, by name, leaving out any the user is still learning or wants to learn
 * - the degrees, certifications and licenses profile.md says the user has earned: not ones in
 *   progress, planned, lapsed or unfinished
 * - each confirmed claim's Keywords line. A plan never backs anything. A claim that's
 *   unconfirmed, low confidence or without a status waits for the user to check it first
 * - what gaps.md says the user doesn't have, which settles it, and what it says needs confirming
 * - what a "Don't claim" part names, which is never added as it is
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
  /** Each skill in skills.md, by its name: a table row's first cell, or a list item's name. */
  skills: Source[];
  /** Each degree, certification and license profile.md says the user has earned. */
  credentials: Source[];
  /** Each Keywords line of a confirmed claim. */
  keywords: Source[];
  /** Each Keywords line of a claim the user still has to check. */
  toCheck: Source[];
  /** What gaps.md says the user doesn't have. */
  saidNo: string[];
  /** What gaps.md says needs confirming. */
  toConfirm: string[];
  /** What a "Don't claim" part names. */
  dontClaim: Source[];
}

/** Words on a skill's line that say it isn't had yet. */
const LEARNING =
  /\b(?:learning|to learn|studying|want to|wanted|wants|plan to|planned|planning|someday|wishlist|interested in|exploring|not yet|in progress)\b/i;

/** A heading over skills or credentials to come, such as "Want to learn", "Goals" or "In progress". */
const LATER_PART =
  /\b(?:learn|learning|want|wants|wanted|plans?|planned|planning|goals?|wish|wishlist|future|someday|interests?|interested|exploring|studying|in progress|to get|upcoming|pending|working on|next (?:up|steps?|year|quarter|month))\b/i;

/** Words that say a degree, certification or license isn't earned, or isn't held anymore. */
const NOT_EARNED =
  /\b(?:in progress|pursuing|expected|studying|planned|planning|booked|scheduled|working towards?|candidate|enrolled|incomplete|not completed|unfinished|exams?|pending|not yet|next (?:year|month|quarter|semester|term|spring|summer|fall|autumn|winter)|upcoming|awaiting|expired|lapsed|did not|didn['’]t|dropped|withdrew|withdrawn|attended|no degree|to take|preparing)\b/i;

/** A table cell that says its row isn't had, as in "| PMP | No |". */
const NOT_HAD = /^(?:no|none|not yet|n\/a|pending|in progress|planned|expired|lapsed|incomplete)$/i;

/** A heading over degrees, certifications and licenses. */
const CREDENTIAL_PART = /educat|degree|certif|licen[cs]|training|qualification/i;

/** gaps.md's parts: what the user doesn't have, what needs confirming, and open questions. */
const SAID_NO_PART = /\b(?:doesn['’]?t|does not|don['’]?t|do not) have\b/i;
const CONFIRM_PART = /\bneeds? confirm/i;
const OPEN_PART = /\bopen questions?\b/i;

/** A part that says what not to claim, as a company file's "Don't claim" does. */
const DONT_CLAIM_PART = /\b(?:don['’]?t|do not|never|not to) claim\b/i;

/** The statuses a claim can go on a resume with: all but a plan. */
const STATUSES: ReadonlySet<string> = new Set(
  FACT_TAGS.status.filter((status) => status !== 'plan-only'),
);

/** The confidence a claim needs to back a term without a check: high or medium. */
const SURE: ReadonlySet<string> = new Set(['high', 'medium']);

const fileName = (path: string) => path.split('/').at(-1) ?? path;

/** A code block's opening and closing, as core reads them. */
const FENCE_OPEN = /^( {0,3})(`{3,}(?=[^`]*$)|~{3,})/;
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;

/** A block's lines that aren't in a code block, such as a format example. */
function outsideCode(text: string): string[] {
  const kept: string[] = [];
  let fence: string | null = null;
  for (const line of text.split(/\r?\n/)) {
    if (fence) {
      const close = line.match(FENCE_CLOSE)?.[1];
      if (close && close[0] === fence[0] && close.length >= fence.length) fence = null;
      continue;
    }
    const open = line.match(FENCE_OPEN)?.[2];
    if (open) fence = open;
    else kept.push(line);
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
    .map((cell) => cell.replace(/\*\*/g, '').trim());
}

/** A list item's words, or null. */
const item = (line: string) => line.match(/^\s*(?:[-*+]|\d+[.)])\s+(.+)$/)?.[1]?.trim() ?? null;

/** A heading of level 4 to 6, which core leaves in its block's lines, read by hand. */
function deeperHeading(line: string): { level: number; title: string } | null {
  const marks = /^#{4,6}(?=\s)/.exec(line)?.[0];
  if (!marks) return null;
  let title = line.slice(marks.length).trim();
  let end = title.length;
  while (end > 0 && title.charAt(end - 1) === '#') end -= 1;
  if (end === 0 || /\s/.test(title.charAt(end - 1))) title = title.slice(0, end).trim();
  return title ? { level: marks.length, title } : null;
}

/** A bold line on its own, which labels the lines after it: "**Doesn't have**". */
const labelOf = (line: string) =>
  line
    .trim()
    .match(/^(?:\*\*([^*]+)\*\*|__([^_]+)__):?$/)
    ?.slice(1)
    .find(Boolean)
    ?.replace(/:$/, '')
    .trim() ?? null;

/** A line of a file, with the headings and bold labels it's under. */
interface Placed {
  /** A list item's words, a table row's first cell, a heading's words, or the line. */
  text: string;
  /** The whole line, as written. */
  line: string;
  kind: 'item' | 'row' | 'heading' | 'line';
  /** A table row's cells, past its first. */
  rest: string[];
  /** The headings and labels it's under, outermost first. A heading isn't under itself. */
  under: string[];
}

/**
 * A file's lines, each with what it's under: a heading's, from core's blocks and the deeper
 * headings in them, and a bold label's, up to the next heading. A table's first row names its
 * columns, so it's left out.
 */
function placedLines(text: string): Placed[] {
  const placed: Placed[] = [];
  const outer: { level: number; title: string }[] = [];
  for (const block of factBlocks(text, { claims: false })) {
    while ((outer.at(-1)?.level ?? 0) >= block.level && outer.length > 0) outer.pop();
    if (block.level > 0) {
      const under = outer.map((each) => each.title);
      placed.push({ text: block.title, line: block.title, kind: 'heading', rest: [], under });
      outer.push({ level: block.level, title: block.title });
    }
    const inner: { level: number; title: string }[] = [];
    let label: string | null = null;
    let header = true;
    const under = () => [
      ...[...outer, ...inner].map((each) => each.title),
      ...(label ? [label] : []),
    ];
    for (const line of outsideCode(block.body)) {
      const trimmed = line.trim();
      const heading = deeperHeading(trimmed);
      if (heading) {
        while ((inner.at(-1)?.level ?? 0) >= heading.level && inner.length > 0) inner.pop();
        label = null;
        placed.push({
          text: heading.title,
          line: trimmed,
          kind: 'heading',
          rest: [],
          under: under(),
        });
        inner.push(heading);
        header = true;
        continue;
      }
      const bold = labelOf(trimmed);
      if (bold) {
        label = bold;
        header = true;
        continue;
      }
      const row = cells(line);
      if (row) {
        const [first, ...rest] = row;
        if (!header && first)
          placed.push({ text: first, line: trimmed, kind: 'row', rest, under: under() });
        header = false;
        continue;
      }
      if (isRule(line)) continue;
      header = true;
      if (!trimmed) continue;
      const listed = item(line)?.replace(/\*\*/g, '').trim();
      placed.push({
        text: listed ?? trimmed.replace(/\*\*/g, ''),
        line: trimmed,
        kind: listed ? 'item' : 'line',
        rest: [],
        under: under(),
      });
    }
  }
  return placed;
}

/** Whether any of the titles says so. */
const any = (pattern: RegExp, titles: readonly string[]) =>
  titles.some((title) => pattern.test(title));

/** Whether a line, or a cell of its row, says it isn't had or earned. */
const notHad = (line: Placed, words: RegExp) =>
  words.test(line.line) || line.rest.some((cell) => NOT_HAD.test(cell));

/**
 * The skills in skills.md, by name: a table row's first cell, or a list item's words before any
 * ":" or dash, so "Python: daily, but never used Django" is Python. A skill under a heading for
 * ones to come, or with words that say it isn't had yet, is left out, whole line and all.
 */
function skillsIn(path: string, text: string): Source[] {
  return (
    placedLines(text)
      .filter((line) => line.kind === 'item' || line.kind === 'row')
      .filter((line) => !any(LATER_PART, line.under) && !notHad(line, LEARNING))
      .filter((line) => !NOT_EARNED.test(line.line))
      // A note in brackets stays: a line that passes says nothing's to come, so "Amplitude
      // (product analytics)" backs product analytics.
      .map((line) => (line.text.split(/:|\s[—–-]\s/)[0] ?? line.text).trim())
      .filter(Boolean)
      .map((skill) => ({ text: skill, where: fileName(path) }))
  );
}

/**
 * The degrees, certifications and licenses profile.md says the user has earned: the lines under
 * a heading for them, unless that heading, one above it, or the line says they're to come,
 * in progress or not held anymore.
 */
function credentialsIn(path: string, text: string): Source[] {
  return placedLines(text)
    .filter((line) => any(CREDENTIAL_PART, line.under))
    .filter((line) => !any(LATER_PART, line.under) && !any(NOT_EARNED, line.under))
    .filter((line) => !notHad(line, NOT_EARNED))
    .map((line) => ({
      text: line.kind === 'row' ? [line.text, ...line.rest].join(', ') : line.text,
      where: fileName(path),
    }));
}

/** gaps.md's part a line is in, by the nearest heading or label above it that names one. */
function gapPart(under: readonly string[]): 'no' | 'confirm' | null {
  for (const title of [...under].reverse()) {
    if (SAID_NO_PART.test(title)) return 'no';
    if (CONFIRM_PART.test(title)) return 'confirm';
    if (OPEN_PART.test(title)) return null;
  }
  return null;
}

/** What gaps.md lists under each of its parts: every line, heading, list item and table row. */
function gapsIn(text: string): { saidNo: string[]; toConfirm: string[] } {
  const saidNo: string[] = [];
  const toConfirm: string[] = [];
  for (const line of placedLines(text)) {
    const part = gapPart(line.under);
    if (part === 'no') saidNo.push(line.text);
    else if (part === 'confirm') toConfirm.push(line.text);
  }
  return { saidNo, toConfirm };
}

/** What a file's "Don't claim" parts name: every line under one. */
function dontClaimIn(path: string, text: string): Source[] {
  return placedLines(text)
    .filter((line) => any(DONT_CLAIM_PART, line.under))
    .map((line) => ({ text: line.text, where: `${fileName(path)} · Don’t claim` }));
}

/** A claim's Keywords line, if it has one. */
function keywordsOf(block: FactBlock): string | null {
  for (const line of outsideCode(block.body)) {
    const keywords = line.match(/^\s*[-*+]\s+\*\*Keywords:?\*\*:?\s*(.+)$/i)?.[1];
    if (keywords) return keywords.trim();
  }
  return null;
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
    dontClaim: [],
  };
  for (const file of files) {
    const name = fileName(file.path).toLowerCase();
    if (name === 'readme.md') continue;
    terms.dontClaim.push(...dontClaimIn(file.path, file.text));
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
      if (!block.tags || !keywords) continue;
      const tags = block.tags.map((tag) => tag.trim().toLowerCase());
      // A plan is never a fact, so a plan-only claim backs nothing.
      if (tags.some((tag) => tag.startsWith('plan'))) continue;
      const source = { text: keywords, where: `${fileName(file.path)} · ${block.title}` };
      // Only a claim the user confirmed, with a status and high or medium confidence, backs a
      // term as it is. Any other waits for a check.
      const confirmed =
        !tags.includes(UNCONFIRMED) &&
        tags.some((tag) => STATUSES.has(tag)) &&
        tags.some((tag) => SURE.has(tag));
      (confirmed ? terms.keywords : terms.toCheck).push(source);
    }
  }
  return terms;
}
