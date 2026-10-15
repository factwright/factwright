import { FACT_TAGS, type FactBlock, factBlocks, UNCONFIRMED } from '@factwright/core';
import { findTerms, plain } from './terms.ts';
import { VOCABULARY } from './vocabulary.ts';

/**
 * What the fact bank says about terms, read with the same parser the app's Fact bank uses, the
 * way the skills write it (facts/README.md). A term the bank backs can go on a resume; one it
 * doesn't back is a real gap. People write the bank in many ways, so it's read cautiously: a
 * line counts only when nothing on it, and nothing it's under, says it isn't had.
 *
 * Each line is read with what it's under: its headings, a bold or "…:" label, a table's header,
 * and the list items it's nested in. Then:
 * - skills.md's skills, by name, where nothing says the user is learning, wants or lacks them
 * - the degrees, certifications and licenses profile.md lists, as written. These only ever ask
 *   the user to check: whether one is earned and current is theirs to say
 * - each confirmed claim's Keywords, term by term, leaving out any it says the claim isn't
 *   about. A plan never backs anything. A claim that's unconfirmed, low confidence or without a
 *   status waits for the user to check it first
 * - gaps.md: all of it says what the user doesn't have, but what needs confirming and the open
 *   questions
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
  /** Each skill the user has, from skills.md, by name. */
  skills: Source[];
  /** Each degree, certification and license profile.md lists, as written. */
  credentials: Source[];
  /** Each term a confirmed claim's Keywords line names. */
  keywords: Source[];
  /** Each term a claim the user still has to check names. */
  toCheck: Source[];
  /** What gaps.md says the user doesn't have. */
  saidNo: string[];
  /** What gaps.md says needs confirming. */
  toConfirm: string[];
  /** What a "Don't claim" part names. */
  dontClaim: Source[];
}

/** Words that say something isn't had: "no", "never used", "not Kubernetes", "Growth areas". */
const NEGATIVE =
  /\b(?:no|none|never|not|nor|without|cannot|can['’]t|don['’]t|doesn['’]t|didn['’]t|haven['’]t|hasn['’]t|isn['’]t|wasn['’]t|lacks?|lacking|gaps?|growth areas?|to improve|weak|weakness(?:es)?|unfamiliar)\b/i;

/** Words that say something's still to come: learning it, wanting it, planning to get it. */
const LATER =
  /\b(?:learning|learn|studying|want|wants|wanted|wanting|plans?|planned|someday|wishlist|interested|interests?|exploring|in progress|practicing|courses?|bootcamp|boot camp|tutorials?|exams?|next(?!\.)|hope|hoping|goals?|future|upcoming|pending|working on|to get|pursu\w*|aspir\w*|consider\w*)\b/i;

/** More words that say a degree, certification or license isn't earned, or isn't held anymore. */
const NOT_EARNED =
  /\b(?:expected|booked|scheduled|working towards?|candidate|enroll\w*|incomplete|not completed|unfinished|exams?|not yet|awaiting|expired|lapsed|did not|didn['’]t|dropped|withdrew|withdrawn|attended|no degree|to take|preparing|failed|retak\w*|inactive|renew\w*|admitted|starting|deferred|coursework|class|minor|started|thinking)\b/i;

/** A table cell that says its row isn't had, as in "| PMP | No |" or "| Rust | ❌ |". */
const NOT_HAD =
  /^(?:(?:no|none|never|not|nor)\b.*|n\/a|pending|in progress|planned|wanted|learning|expired|lapsed|incomplete|[❌✗✘✖×])$/iu;

/** A cell with no answer, which in a column for depth or status says it isn't had. */
const BLANK = /^[—–-]*$/;
const SAYS_HAVING = /depth|level|experience|have|has|held|earned|status|years|proficiency/i;

/** A heading over degrees, certifications and licenses. */
const CREDENTIAL_PART = /educat|degree|certif|licen[cs]|qualification|credential/i;

/** gaps.md's parts: what the user doesn't have, what needs confirming, and open questions. */
const SAID_NO_PART =
  /\b(?:doesn['’]?t|does not|don['’]?t|do not|hasn['’]?t|has not|haven['’]?t|have not|never)\b/i;
const CONFIRM_PART = /\bconfirm/i;
const OPEN_PART = /\bquestions?\b/i;

/** A part, a label or a line that says what not to claim: "Don't claim", "What never to claim". */
const DONT_CLAIM = /\b(?:don['’]t|do not|never|not|avoid)\b[\s\w'’-]{0,20}?\bclaim/i;

/** The statuses a claim can go on a resume with: all but a plan. */
const STATUSES: ReadonlySet<string> = new Set(
  FACT_TAGS.status.filter((status) => status !== 'plan-only'),
);

/** The confidence a claim needs to back a term without a check: high or medium. */
const SURE: ReadonlySet<string> = new Set(['high', 'medium']);

/** How deep nested list items are followed. Deeper ones count as the deepest. */
const MAX_NESTING = 8;

const fileName = (path: string) => path.split('/').at(-1) ?? path;

/** The terms the X-ray knows whose names hold a word these look for: "Machine learning". */
const LOOK_ALIKES = VOCABULARY.filter((term) =>
  term.forms.some((form) => [NEGATIVE, LATER, NOT_EARNED].some((words) => words.test(form.text))),
);

/** Text with those terms left out, so "Machine learning" isn't "learning". */
function withoutKnownTerms(text: string): string {
  const source = plain(text);
  let kept = '';
  let at = 0;
  for (const hit of findTerms(source, LOOK_ALIKES)) {
    kept += `${source.slice(at, hit.at)} `;
    at = hit.at + hit.text.length;
  }
  return kept + source.slice(at);
}

/** Whether text says what a pattern finds, apart from the names of terms it holds. */
const says = (pattern: RegExp, text: string) =>
  pattern.test(text) && pattern.test(withoutKnownTerms(text));

/** What a heading, a label or a list item says about what's under it, worked out once. */
interface Marks {
  later: boolean;
  negative: boolean;
  credential: boolean;
  notEarned: boolean;
  saidNo: boolean;
  confirm: boolean;
  open: boolean;
  dontClaim: boolean;
}

function marksOf(text: string): Marks {
  return {
    later: says(LATER, text),
    negative: says(NEGATIVE, text),
    credential: CREDENTIAL_PART.test(text),
    notEarned: says(NOT_EARNED, text),
    saidNo: SAID_NO_PART.test(text),
    confirm: CONFIRM_PART.test(text),
    open: OPEN_PART.test(text),
    dontClaim: DONT_CLAIM.test(text),
  };
}

/** A code block's opening and closing, as core reads them. */
const FENCE_OPEN = /^( {0,3})(`{3,}(?=[^`]*$)|~{3,})/;
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;

/**
 * A block's lines as they read: not in a code block, a comment or front matter, and without
 * struck-out words. A line left out stays as a blank one.
 */
function readable(text: string, first: boolean): string[] {
  const lines = text.split(/\r?\n/);
  const kept: string[] = [];
  let fence: string | null = null;
  let comment = false;
  // Front matter, between "---" lines at the very start of a file.
  let front = first && lines[0]?.trim() === '---';
  for (const [index, line] of lines.entries()) {
    if (front) {
      if (index > 0 && line.trim() === '---') front = false;
      kept.push('');
      continue;
    }
    if (fence) {
      const close = line.match(FENCE_CLOSE)?.[1];
      if (close && close[0] === fence[0] && close.length >= fence.length) fence = null;
      kept.push('');
      continue;
    }
    const open = comment ? null : line.match(FENCE_OPEN)?.[2];
    if (open) {
      fence = open;
      kept.push('');
      continue;
    }
    // Comments, read with indexOf: "<!-- … -->", across lines too.
    let rest = line;
    let out = '';
    while (rest) {
      const mark = rest.indexOf(comment ? '-->' : '<!--');
      if (mark < 0) {
        if (!comment) out += rest;
        break;
      }
      if (!comment) out += rest.slice(0, mark);
      rest = rest.slice(mark + (comment ? 3 : 4));
      comment = !comment;
    }
    kept.push(out.replace(/~~[^~]*~~/g, ''));
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
const item = (line: string) => line.match(/^\s*(?:[-*+]|\d+[.)])\s+(\S.*)$/)?.[1]?.trim() ?? null;

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
const boldLabel = (line: string) =>
  line
    .match(/^(?:\*\*([^*]+)\*\*|__([^_]+)__):?$/)
    ?.slice(1)
    .find(Boolean)
    ?.replace(/:$/, '')
    .trim() ?? null;

/** A line of a file, with what it's under. */
interface Placed {
  /** A list item's words, a table row's first cell, a heading's words, or the line. */
  text: string;
  /** The whole line, as written: for a row, its cells with commas between. */
  line: string;
  kind: 'item' | 'row' | 'heading' | 'line';
  /** A table row's other cells, each with its column's header. */
  cells: { header: string; value: string }[];
  /** What it's under, outermost first: headings, labels, a table's header, list items. */
  under: Marks[];
  /** What its own words say. */
  own: Marks;
  /** The list item it's nested in, by its place among the lines, or -1. */
  parent: number;
}

/**
 * A file's lines, each with what it's under: a heading's, from core's blocks and the deeper
 * headings in them; a label's, a bold line or a line that ends in ":", up to the next heading;
 * a table's header; and for a list item, the items it's nested in, and a label item before it,
 * as "Rust" is under "- Want to learn:". A table's first row names its columns.
 */
function placedLines(text: string): Placed[] {
  const placed: Placed[] = [];
  const outer: { level: number; marks: Marks }[] = [];
  for (const [index, block] of factBlocks(text, { claims: false }).entries()) {
    while (outer.length > 0 && (outer.at(-1)?.level ?? 0) >= block.level) outer.pop();
    if (block.level > 0) {
      const own = marksOf(block.title);
      placed.push({
        text: block.title,
        line: block.title,
        kind: 'heading',
        cells: [],
        under: outer.map((each) => each.marks),
        own,
        parent: -1,
      });
      outer.push({ level: block.level, marks: own });
    }
    const inner: { level: number; marks: Marks }[] = [];
    let label: Marks | null = null;
    let items: { indent: number; marks: Marks; at: number }[] = [];
    let group: { indent: number; marks: Marks; at: number } | null = null;
    let header: { names: string[]; marks: Marks } | null = null;
    let headerNext = true;
    const context = () => [
      ...outer.map((each) => each.marks),
      ...inner.map((each) => each.marks),
      ...(label ? [label] : []),
      ...(header ? [header.marks] : []),
    ];
    const listContext = () => [
      ...context(),
      ...(group ? [group.marks] : []),
      ...items.map((each) => each.marks),
    ];
    const endList = () => {
      items = [];
      group = null;
    };
    for (const line of readable(block.body, index === 0)) {
      const trimmed = line.trim();
      const heading = deeperHeading(trimmed);
      if (heading) {
        while (inner.length > 0 && (inner.at(-1)?.level ?? 0) >= heading.level) inner.pop();
        label = null;
        header = null;
        headerNext = true;
        endList();
        const own = marksOf(heading.title);
        placed.push({
          text: heading.title,
          line: trimmed,
          kind: 'heading',
          cells: [],
          under: context(),
          own,
          parent: -1,
        });
        inner.push({ level: heading.level, marks: own });
        continue;
      }
      const row = cells(line);
      if (row) {
        endList();
        if (headerNext) {
          header = { names: row, marks: marksOf(row.join(' ')) };
          headerNext = false;
          continue;
        }
        const [first = '', ...rest] = row;
        if (first) {
          placed.push({
            text: first,
            line: row.join(', '),
            kind: 'row',
            cells: rest.map((value, at) => ({ header: header?.names[at + 1] ?? '', value })),
            under: context(),
            own: marksOf(row.join(' ')),
            parent: -1,
          });
        }
        continue;
      }
      if (isRule(line)) continue;
      headerNext = true;
      header = null;
      if (!trimmed) continue;
      const bold = boldLabel(trimmed);
      if (bold) {
        label = marksOf(bold);
        endList();
        continue;
      }
      const indent = line.length - line.trimStart().length;
      // Indented four spaces with no list to be in, it's code, whatever it looks like.
      if (indent >= 4 && items.length === 0) continue;
      const words = item(line);
      if (!words) {
        // At the margin, a line ends the list.
        if (indent === 0) endList();
        if (indent === 0 && trimmed.endsWith(':')) {
          label = marksOf(trimmed);
          continue;
        }
        placed.push({
          text: trimmed.replace(/\*\*/g, ''),
          line: trimmed,
          kind: 'line',
          cells: [],
          under: listContext(),
          own: marksOf(trimmed),
          parent: items.at(-1)?.at ?? -1,
        });
        continue;
      }
      items = items.filter((each) => each.indent < indent);
      if (group && indent < group.indent) group = null;
      const grouped = group && group.indent === indent ? group : null;
      const own = marksOf(words);
      const at = placed.length;
      placed.push({
        text: words.replace(/\*\*/g, '').trim(),
        line: trimmed,
        kind: 'item',
        cells: [],
        under: listContext(),
        own,
        parent: items.at(-1)?.at ?? grouped?.at ?? -1,
      });
      if (items.length < MAX_NESTING) items.push({ indent, marks: own, at });
      // An item that ends in ":" labels the items after it, at its own depth and deeper.
      if (words.endsWith(':')) group = { indent, marks: own, at };
    }
  }
  return placed;
}

/** Whether anything a line is under says so. */
const underAny = (line: Placed, mark: keyof Marks) => line.under.some((marks) => marks[mark]);

/** Whether a row has a cell that says it isn't had. */
const hasNoCell = (line: Placed) =>
  line.cells.some(
    (cell) => NOT_HAD.test(cell.value) || (BLANK.test(cell.value) && SAYS_HAVING.test(cell.header)),
  );

/** Whether a line's own words, or a row's cells, say it isn't had or is still to come. */
const saysNotHad = (line: Placed) => line.own.negative || line.own.later || hasNoCell(line);

/** The longest note read for another term's name. A note about one is short. */
const MAX_NOTE = 200;

/** Whether a short note names a term the X-ray knows, so what it says is about that term. */
const namesTerm = (note: string) =>
  note.length <= MAX_NOTE && findTerms(note, VOCABULARY).length > 0;

/** The items a line nested under them makes doubtful, so they don't count either. */
function doubtedItems(lines: readonly Placed[], bad: (line: Placed) => boolean): Set<number> {
  const doubted = new Set<number>();
  for (const line of lines) {
    // "  - Depth: learning" is about the item it's under; "  - Django (learning)" is about Django.
    if (line.parent < 0 || !bad(line) || namesTerm(line.text)) continue;
    for (let at = line.parent; at >= 0 && !doubted.has(at); at = lines[at]?.parent ?? -1) {
      doubted.add(at);
    }
  }
  return doubted;
}

/** Terms in a list, split at commas, semicolons and dots outside brackets. */
function pieces(text: string): string[] {
  const found: string[] = [];
  let depth = 0;
  let piece = '';
  for (const character of text) {
    if (character === '(' || character === '[') depth++;
    else if ((character === ')' || character === ']') && depth > 0) depth--;
    if (depth === 0 && ',;·•'.includes(character)) {
      found.push(piece);
      piece = '';
    } else {
      piece += character;
    }
  }
  return [...found, piece].map((each) => each.trim()).filter(Boolean);
}

/**
 * A skill's name and its notes: what's after a ":" or a dash, and what's in brackets. A note
 * that says the skill isn't had, or is to come, leaves it out, as in "Kubernetes: never used" or
 * "Rust (learning)". One that names another term is about that term, so it's left off the name
 * and the skill stays: "Docker (but not Kubernetes)" is Docker, and backs nothing else.
 */
function skillName(text: string): string | null {
  const [head = '', ...after] = text.split(/:|\s[—–-]\s/);
  const notes = after.length > 0 ? [after.join(':')] : [];
  let name = '';
  let at = 0;
  for (let open = head.indexOf('('); open >= 0; open = head.indexOf('(', at)) {
    const close = head.indexOf(')', open + 1);
    if (close < 0) break;
    const note = head.slice(open + 1, close);
    const own = marksOf(note);
    // A note that says nothing against the skill stays with it: "Amplitude (product analytics)".
    const against = own.negative || own.later;
    name += head.slice(at, against ? open : close + 1);
    if (against) notes.push(note);
    at = close + 1;
  }
  name = (name + head.slice(at)).replace(/\s+/g, ' ').trim();
  const named = marksOf(name);
  if (!name || named.negative || named.later) return null;
  for (const note of notes) {
    const own = marksOf(note);
    if ((own.negative || own.later) && !namesTerm(note)) return null;
  }
  return name;
}

/** A list item's lead in bold, as "**Languages:** Python, Go", and the words after it. */
const boldLead = (line: string) =>
  line.match(/^\s*(?:[-*+]|\d+[.)])\s+\*\*([^*]{1,80})\*\*:?\s*(\S.*)?$/);

/**
 * The skills in skills.md, by name: a table row's first cell, a list item's words before any
 * ":" or dash, so "Python: daily" is Python, or each of the terms after a bold lead, as in
 * "**Languages:** Python, Go". One that anything says isn't had, or is to come, is left out.
 */
function skillsIn(path: string, text: string): Source[] {
  const lines = placedLines(text);
  const doubted = doubtedItems(lines, saysNotHad);
  const skills: string[] = [];
  for (const [at, line] of lines.entries()) {
    if (line.kind !== 'item' && line.kind !== 'row') continue;
    if (underAny(line, 'later') || underAny(line, 'negative') || doubted.has(at)) continue;
    const lead = line.kind === 'item' ? boldLead(line.line) : null;
    if (lead) {
      const named = marksOf(lead[1] ?? '');
      if (named.later || named.negative) continue;
      for (const piece of pieces(lead[2] ?? '')) {
        const own = marksOf(piece);
        if (!own.later && !own.negative) skills.push(piece);
      }
      continue;
    }
    if (hasNoCell(line) || line.text.endsWith(':')) continue;
    // A row's other cells are its notes, as "| Rust | learning |".
    const notes = line.cells.map((cell) => marksOf(cell.value));
    if (notes.some((marks) => marks.negative || marks.later)) continue;
    const name = skillName(line.text);
    if (name) skills.push(name);
  }
  return skills.map((skill) => ({ text: skill, where: fileName(path) }));
}

/** A year after this one, as in "MBA, 2028", which isn't earned yet. */
const laterYear = (text: string) =>
  (text.match(/\b(?:19|20)\d{2}\b/g) ?? []).some((year) => Number(year) > new Date().getFullYear());

/**
 * The degrees, certifications and licenses profile.md lists: the lines under a heading, a label
 * or a table's header for them, as written. One that it, or anything it's under, says isn't
 * earned, is to come or isn't held anymore is left out, but these only ask for a check.
 */
function credentialsIn(path: string, text: string): Source[] {
  const lines = placedLines(text);
  const notEarned = (line: Placed) =>
    line.own.notEarned || saysNotHad(line) || laterYear(line.line);
  const doubted = doubtedItems(lines, notEarned);
  return lines
    .filter((line, at) => {
      if (line.kind === 'heading' || !underAny(line, 'credential') || doubted.has(at)) return false;
      if (line.text.endsWith(':') || notEarned(line)) return false;
      return (
        !underAny(line, 'later') && !underAny(line, 'negative') && !underAny(line, 'notEarned')
      );
    })
    .map((line) => ({ text: line.kind === 'row' ? line.line : line.text, where: fileName(path) }));
}

/** gaps.md's part a line is in, by the nearest heading or label above it that names one. */
function gapPart(line: Placed): 'no' | 'confirm' | 'open' {
  for (const marks of [...line.under].reverse()) {
    if (marks.confirm) return 'confirm';
    if (marks.open) return 'open';
    if (marks.saidNo) return 'no';
  }
  return 'no';
}

/**
 * What gaps.md says: every line, heading and table row says what the user doesn't have, but
 * what's under a part for what needs confirming, and the open questions.
 */
function gapsIn(text: string): { saidNo: string[]; toConfirm: string[] } {
  const saidNo: string[] = [];
  const toConfirm: string[] = [];
  for (const line of placedLines(text)) {
    // A heading or label item that names a part, such as "Needs confirmation", says nothing.
    const names = line.own.confirm || line.own.open || line.own.saidNo;
    if (names && (line.kind === 'heading' || line.text.endsWith(':'))) continue;
    const words = line.kind === 'row' ? line.line : line.text;
    const part = gapPart(line);
    if (part === 'no') saidNo.push(words);
    else if (part === 'confirm') toConfirm.push(words);
  }
  return { saidNo, toConfirm };
}

/** What a file says not to claim: every line under such a part, and any line that says so. */
function dontClaimIn(path: string, text: string): Source[] {
  return placedLines(text)
    .filter((line) => line.own.dontClaim || underAny(line, 'dontClaim'))
    .map((line) => ({
      text: line.kind === 'row' ? line.line : line.text,
      where: `${fileName(path)} · Don’t claim`,
    }));
}

/** A claim's Keywords, term by term, leaving out any the line says the claim isn't about. */
function keywordsOf(block: FactBlock): string[] {
  for (const line of readable(block.body, false)) {
    const keywords = line.match(/^\s*[-*+]\s+\*\*Keywords:?\*\*:?\s*(\S.*)$/i)?.[1];
    if (!keywords) continue;
    return pieces(keywords).filter((piece) => {
      const own = marksOf(piece);
      return !own.negative && !own.later;
    });
  }
  return [];
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
      if (!block.tags) continue;
      const tags = block.tags.map((tag) => tag.trim().toLowerCase());
      // A plan is never a fact, so a plan-only claim backs nothing.
      if (tags.some((tag) => tag.startsWith('plan'))) continue;
      const where = `${fileName(file.path)} · ${block.title}`;
      // Only a claim the user confirmed, with a status and high or medium confidence, backs a
      // term as it is. Any other waits for a check.
      const confirmed =
        !tags.includes(UNCONFIRMED) &&
        tags.some((tag) => STATUSES.has(tag)) &&
        tags.some((tag) => SURE.has(tag));
      for (const keyword of keywordsOf(block)) {
        (confirmed ? terms.keywords : terms.toCheck).push({ text: keyword, where });
      }
    }
  }
  return terms;
}
