import { FACT_TAGS, type FactBlock, factBlocks, UNCONFIRMED } from '@factwright/core';
import { findTerms, type Hit, plain } from './terms.ts';
import { VOCABULARY } from './vocabulary.ts';

/**
 * What the fact bank says about terms, read with the same parser the app's Fact bank uses, the
 * way the skills write it (facts/README.md). People write the bank every which way, so no list
 * of words could catch every way of saying a skill isn't had. Instead, a skill says "Add it"
 * only where its line holds nothing but its name and words known to be harmless, such as other
 * terms, years, "daily" or the file that proves it. A line with anything else on it, however
 * it's put, only asks the user to check it, quoting it. (keywords.ts decides that, with
 * `beside` below.)
 *
 * Each line is read with what it's under: its headings, a label ("**Want to learn**", "Want to
 * learn:", "- Want to learn:"), the skill column's header, and the list items it's nested in.
 * What's under a part for skills to come, or not had, isn't read as a skill at all. Then:
 * - skills.md's skills, each with its name: a table row's first cell, or a list item's words
 *   before any ":" or dash
 * - the degrees, certifications and licenses profile.md lists, as written. These only ever ask
 *   the user to check: whether one is earned and current is theirs to say
 * - each confirmed claim's Keywords, term by term. A plan never backs anything. A claim that's
 *   unconfirmed, low confidence or without a status waits for the user to check it first
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
  /** The whole of what the user wrote: a skill's line, or one of a claim's Keywords. */
  text: string;
  /** The skill's name in it, without its notes: "Kubernetes" in "Kubernetes: 4 years". */
  name: string;
  /** Where they are, such as "skills.md" or "acme-health.md · Cut wait times". */
  where: string;
  /**
   * False when something around the line leaves doubt: a heading for skills to confirm, a
   * comment beside it, or a sub-item that says otherwise. Then a term in it is only a check.
   */
  sure: boolean;
}

export interface FactTerms {
  /** Each skill in skills.md that isn't under a part for skills to come or not had. */
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

/** A heading's or label's words that say what's under it isn't had: "Gaps", "Not yet". */
const NOT_HAD_PART =
  /\b(?:gaps?|not yet|(?:don|doesn|didn|haven|hasn|can|won|wouldn)['’]?t (?:have|know|used?|claim|touched)|do not have|does not have|have not used|never used|no experience|growth areas?|areas? to (?:grow|improve)|to improve|weak(?:ness|nesses)?|lacking|missing|without)\b/i;

/** A heading's or label's words that say what's under it is still to come: "Want to learn". */
const LATER_PART =
  /\b(?:learn|learning|studying|want|wants|wanted|wish|wishlist|plans?|planned|planning to|goals?|future|someday|next(?!\.)|upcoming|interests?|interested|exploring|in progress|working on|to get|to pursue|pursuing|aspir\w*|considering|on my list|maybe|soon)\b/i;

/** A heading's or label's words that say what's under it needs a check. */
const CHECK_PART =
  /\b(?:confirm\w*|unconfirmed|unverified|verify|questions?|tbd|unsure|not sure)\b/i;

/** Words that, anywhere on a line, may say it isn't had, is to come, or isn't sure. */
const DOUBT =
  /\b(?:no|non|none|never|not|nor|without|n\/a|tbd|tbc|maybe|soon|later|learn\w*|studying|want\w*|wish\w*|plans?|planned|goals?|someday|interest\w*|exploring|practic\w*|course\w*|bootcamp|tutorials?|exams?|next(?!\.)|hop(?:e|ing)|future|upcoming|pending|unconfirmed|unverified|confirm\w*|verify|expected|booked|scheduled|candidate|enroll\w*|incomplete|unfinished|expired|lapsed|dropped|withdr\w*|attended|failed|inactive|rusty|dabbled|exposure|theory|academic|hobby|once|only|lacks?|lacking|gaps?|(?:don|doesn|didn|haven|hasn|can|won|wouldn|isn|wasn)['’]?t|cannot)\b|\?/i;

/**
 * Words in a skill's notes that plainly say it isn't had or is to come: "never used", "learning
 * it now", "(no hands-on experience)". When the notes name no other term, they're about the
 * skill, so it isn't one.
 */
const NOT_HAD_NOTE =
  /\b(?:no|none|never|not|nor|without|n\/a|learn\w*|studying|want\w*|wish\w*|plans?|planned|goals?|someday|interest\w*|exploring|practic\w*|course\w*|bootcamp|tutorials?|exams?|next(?!\.)|hop(?:e|ing)|future|upcoming|pending|maybe|soon|later|in progress|(?:don|doesn|didn|haven|hasn|can|won|wouldn)['’]?t|cannot)\b/i;

/** More words that say a degree, certification or license isn't earned, or isn't held anymore. */
const NOT_EARNED =
  /\b(?:expected|booked|scheduled|working towards?|candidate|enroll\w*|incomplete|not completed|unfinished|exams?|not yet|awaiting|expired|lapsed|did not|didn['’]?t|dropped|withdrew|withdrawn|attended|no degree|to take|preparing|failed|retak\w*|inactive|renew\w*|admitted|starting|deferred|coursework|class|minor|started|thinking)\b/i;

/** A table cell that says its row isn't had, as in "| PMP | No |" or "| Rust | ❌ |". */
const NOT_HAD_CELL =
  /^(?:(?:no|none|never|not|nor|nope)\b.*|n|0|n\/a|todo|pending|in progress|planned|wanted|learning|expired|lapsed|incomplete|[❌✗✘✖×🚫✕])$/iu;

/** A table's column for where a skill is proven, which says nothing about having it. */
const PROOF = /proven|proof|source|where|file|claim|evidence/i;

/** A cell with no answer, which in a column for depth or status says it isn't had. */
const BLANK = /^[—–-]*$/;
const SAYS_HAVING = /depth|level|experience|have|has|held|earned|status|years|proficiency/i;

/** A heading over degrees, certifications and licenses. */
const CREDENTIAL_PART = /educat|degree|certif|\bcerts?\b|licen[cs]|qualification|credential/i;

/** gaps.md's parts: what the user doesn't have, what needs confirming, and open questions. */
const SAID_NO_PART =
  /\b(?:doesn['’]?t|does not|don['’]?t|do not|hasn['’]?t|has not|haven['’]?t|have not|never)\b/i;
const CONFIRM_PART = /\bconfirm/i;
const OPEN_PART = /\bquestions?\b/i;

/** A part, a label or a line that says what not to claim: "Don't claim", "What never to claim". */
const DONT_CLAIM = /\b(?:don['’]?t|do not|never|not|avoid)\b[\s\w'’-]{0,20}?\bclaim/i;

/** Words in a heading that say nothing about what's under it: "(in no particular order)". */
const ASIDE = /\b(?:in no particular order|no particular order|not exhaustive|non-exhaustive)\b/gi;

/** The statuses a claim can go on a resume with: all but a plan. */
const STATUSES: ReadonlySet<string> = new Set(
  FACT_TAGS.status.filter((status) => status !== 'plan-only'),
);

/** The confidence a claim needs to back a term without a check: high or medium. */
const SURE: ReadonlySet<string> = new Set(['high', 'medium']);

/** How deep nested list items are followed. Deeper ones count as the deepest. */
const MAX_NESTING = 8;

/** The longest line read for what it holds beside a term. A skill's line is far shorter. */
export const MAX_SOURCE = 300;

const fileName = (path: string) => path.split('/').at(-1) ?? path;

/** Text with each "(…)" left out, read with indexOf. */
function withoutBrackets(text: string): string {
  let kept = '';
  let at = 0;
  for (let open = text.indexOf('('); open >= 0; open = text.indexOf('(', at)) {
    const close = text.indexOf(')', open + 1);
    if (close < 0) break;
    kept += `${text.slice(at, open)} `;
    at = close + 1;
  }
  return kept + text.slice(at);
}

/** Emphasis marks left off: "**Want to learn:**" is "Want to learn:". */
const withoutEmphasis = (text: string) =>
  text.replace(/\*\*|__|(?<![\p{L}\p{N}])[*_]|[*_](?![\p{L}\p{N}])/gu, '').trim();

/** The terms the X-ray knows whose names hold a word these look for: "Machine learning". */
const LOOK_ALIKES = VOCABULARY.filter((term) =>
  term.forms.some((form) =>
    [NOT_HAD_PART, LATER_PART, NOT_EARNED, DOUBT].some((words) => words.test(form.text)),
  ),
);

/** Text with those terms left out, so "Machine learning" isn't "learning". */
function withoutLookAlikes(text: string): string {
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
  pattern.test(text) && pattern.test(withoutLookAlikes(text));

/** What a heading, a label or a list item says about what's under it, worked out once. */
interface Marks {
  later: boolean;
  notHad: boolean;
  check: boolean;
  credential: boolean;
  notEarned: boolean;
  saidNo: boolean;
  confirm: boolean;
  open: boolean;
  dontClaim: boolean;
}

function marksOf(text: string): Marks {
  // An aside in brackets, or "in no particular order", says nothing about what's under it.
  const title = withoutBrackets(withoutEmphasis(text)).replace(ASIDE, ' ');
  return {
    later: says(LATER_PART, title),
    notHad: says(NOT_HAD_PART, title),
    check: says(CHECK_PART, title),
    credential: CREDENTIAL_PART.test(title),
    notEarned: says(NOT_EARNED, text),
    saidNo: SAID_NO_PART.test(title),
    confirm: CONFIRM_PART.test(title),
    open: OPEN_PART.test(title),
    dontClaim: DONT_CLAIM.test(text),
  };
}

/** Whether a part's marks say anything about what's under it. */
const saysAnything = (marks: Marks) =>
  marks.later || marks.notHad || marks.check || marks.saidNo || marks.confirm || marks.open;

/** A code block's opening and closing, as core reads them. */
const FENCE_OPEN = /^( {0,3})(`{3,}(?=[^`]*$)|~{3,})/;
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;

/** A line as it reads: its words, and whether a comment beside them was left out. */
interface Readable {
  text: string;
  commented: boolean;
}

/**
 * A block's lines as they read: not in a code block, a comment or front matter, and without
 * struck-out words. A line left out stays as a blank one. A line underlined with "---" or "==="
 * is a heading, so it's read as a label.
 */
function readable(text: string, first: boolean): Readable[] {
  const lines = text.split(/\r?\n/);
  const kept: Readable[] = [];
  let fence: string | null = null;
  let comment = false;
  // Front matter, between "---" lines at the very start of a file.
  let front = first && lines[0]?.trim() === '---';
  for (const [index, line] of lines.entries()) {
    if (front) {
      if (index > 0 && line.trim() === '---') front = false;
      kept.push({ text: '', commented: false });
      continue;
    }
    if (fence) {
      const close = line.match(FENCE_CLOSE)?.[1];
      if (close && close[0] === fence[0] && close.length >= fence.length) fence = null;
      kept.push({ text: '', commented: false });
      continue;
    }
    const open = comment ? null : line.match(FENCE_OPEN)?.[2];
    if (open) {
      fence = open;
      kept.push({ text: '', commented: false });
      continue;
    }
    // Comments, read with indexOf: "<!-- … -->", across lines too.
    const started = comment;
    let rest = line;
    let out = '';
    let removed = started;
    while (rest) {
      const mark = rest.indexOf(comment ? '-->' : '<!--');
      if (mark < 0) {
        if (!comment) out += rest;
        break;
      }
      if (!comment) out += rest.slice(0, mark);
      rest = rest.slice(mark + (comment ? 3 : 4));
      comment = !comment;
      removed = true;
    }
    const words = out.replace(/~~[^~]*~~|<del>[^<]*<\/del>/g, '');
    // A heading underlined with "===" or "---", as "Want to learn" over "-------".
    const before = kept.at(-1);
    if (
      /^ {0,3}(?:=+|-+)\s*$/.test(words) &&
      before?.text.trim() &&
      !/^\s*(?:[-*+|]|\d+[.)])/.test(before.text)
    ) {
      before.text = `**${before.text.trim()}**`;
      kept.push({ text: '', commented: false });
      continue;
    }
    kept.push({ text: words, commented: removed && words.trim() !== '' });
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
    .map((cell) => withoutEmphasis(cell));
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

/** A line in bold or italics on its own, which labels the lines after it: "**Doesn't have**". */
const emphasized = (line: string) =>
  /^(?:\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_):?$/.test(line) ? withoutEmphasis(line) : null;

/** A line of a file, with what it's under. */
interface Placed {
  /** A list item's words, a table row's first cell, a heading's or a label's words, or the line. */
  text: string;
  /** The whole line, as written: for a row, its cells with commas between. */
  line: string;
  kind: 'item' | 'row' | 'heading' | 'label' | 'header' | 'line';
  /** A table row's other cells, each with its column's header. */
  cells: { header: string; value: string }[];
  /** What it's under, outermost first: headings, labels, the skill column's header, list items. */
  under: Marks[];
  /** What its own words say, read as a heading's would be. */
  own: Marks;
  /** The list item it's nested in, by its place among the lines, or -1. */
  parent: number;
  /** Whether a comment beside it was left out, which may have said something about it. */
  commented: boolean;
  /** A task not done, as in "- [ ] Kubernetes". */
  todo: boolean;
}

/** A list item that labels the items after it, as "- Want to learn:" or "- **Learning:**" does. */
const isLabelItem = (line: Placed) => line.kind === 'item' && line.text.endsWith(':');

/**
 * A file's lines, each with what it's under: a heading's, from core's blocks and the deeper
 * headings in them; a label's, up to the next heading; the skill column's header, for a table's
 * rows; and for a list item, the items it's nested in, and a label item before it at its depth,
 * as "Rust" is under "- Want to learn:". Labels and table headers are lines too, for gaps.md.
 */
function placedLines(text: string): Placed[] {
  const placed: Placed[] = [];
  const outer: { level: number; marks: Marks }[] = [];
  const add = (line: Omit<Placed, 'commented' | 'todo'> & Partial<Placed>) =>
    placed.push({ commented: false, todo: false, ...line });
  for (const [index, block] of factBlocks(text, { claims: false }).entries()) {
    while (outer.length > 0 && (outer.at(-1)?.level ?? 0) >= block.level) outer.pop();
    if (block.level > 0) {
      const own = marksOf(block.title);
      const under = outer.map((each) => each.marks);
      add({
        text: block.title,
        line: block.title,
        kind: 'heading',
        cells: [],
        under,
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
    const labelWith = (words: string, line: string) => {
      label = marksOf(words);
      endList();
      add({
        text: words,
        line,
        kind: 'label',
        cells: [],
        under: context(),
        own: label,
        parent: -1,
      });
    };
    for (const { text: line, commented } of readable(block.body, index === 0)) {
      const trimmed = line.trim();
      const heading = deeperHeading(trimmed);
      if (heading) {
        while (inner.length > 0 && (inner.at(-1)?.level ?? 0) >= heading.level) inner.pop();
        label = null;
        header = null;
        headerNext = true;
        endList();
        const own = marksOf(heading.title);
        add({
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
          // The skill column's header says what the rows are: "| Learning next | Why |".
          header = { names: row, marks: marksOf(row[0] ?? '') };
          headerNext = false;
          add({
            text: row.join(', '),
            line: row.join(', '),
            kind: 'header',
            cells: [],
            under: context(),
            own: header.marks,
            parent: -1,
          });
          continue;
        }
        const [first = '', ...rest] = row;
        if (first) {
          add({
            text: first,
            line: row.join(', '),
            kind: 'row',
            cells: rest.map((value, at) => ({ header: header?.names[at + 1] ?? '', value })),
            under: context(),
            own: marksOf(first),
            parent: -1,
            commented,
          });
        }
        continue;
      }
      if (isRule(line)) continue;
      headerNext = true;
      header = null;
      if (!trimmed) continue;
      const indent = line.length - line.trimStart().length;
      // Indented four spaces with no list to be in, it's code, whatever it looks like.
      if (indent >= 4 && items.length === 0) continue;
      const bold = indent === 0 ? emphasized(trimmed) : null;
      if (bold) {
        labelWith(bold.replace(/:$/, ''), trimmed);
        continue;
      }
      const words = item(line);
      if (!words) {
        // At the margin, a line ends the list. One that ends in ":", or a few words that say
        // what follows is to come or not had, labels what follows.
        if (indent === 0) endList();
        const plainWords = withoutEmphasis(trimmed);
        const short = plainWords.split(/\s+/).length <= 6 && !/[.!?]$/.test(plainWords);
        if (
          indent === 0 &&
          (plainWords.endsWith(':') || (short && saysAnything(marksOf(plainWords))))
        ) {
          labelWith(plainWords.replace(/:$/, ''), trimmed);
          continue;
        }
        add({
          text: plainWords,
          line: trimmed,
          kind: 'line',
          cells: [],
          under: listContext(),
          own: marksOf(plainWords),
          parent: items.at(-1)?.at ?? -1,
          commented,
        });
        continue;
      }
      items = items.filter((each) => each.indent < indent);
      if (group && indent < group.indent) group = null;
      const grouped = group && group.indent === indent ? group : null;
      // A task list's box: "[ ]" isn't done, "[x]" is.
      const box = words.match(/^\[([ xX])\]\s+/);
      const itemWords = withoutEmphasis(box ? words.slice(box[0].length) : words);
      const own = marksOf(itemWords);
      const at = placed.length;
      add({
        text: itemWords,
        line: trimmed,
        kind: 'item',
        cells: [],
        under: listContext(),
        own,
        parent: items.at(-1)?.at ?? grouped?.at ?? -1,
        commented,
        todo: box?.[1] === ' ',
      });
      if (items.length < MAX_NESTING) items.push({ indent, marks: own, at });
      // An item that ends in ":" labels the items after it, at its own depth and deeper.
      if (itemWords.endsWith(':')) group = { indent, marks: own, at };
    }
  }
  return placed;
}

/** Whether anything a line is under says so. */
const underAny = (line: Placed, mark: keyof Marks) => line.under.some((marks) => marks[mark]);

/** Whether a row has a cell that says it isn't had: "No", "❌", or "—" under Depth. */
const hasNoCell = (line: Placed) =>
  line.cells.some(
    (cell) =>
      NOT_HAD_CELL.test(cell.value) || (BLANK.test(cell.value) && SAYS_HAVING.test(cell.header)),
  );

/** The items with a line nested under them that may say otherwise, as "  - Depth: learning". */
function doubtedItems(lines: readonly Placed[], doubt: (line: Placed) => boolean): Set<number> {
  const doubted = new Set<number>();
  for (const line of lines) {
    if (line.parent < 0 || !doubt(line)) continue;
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

/** Words beside a term that leave no doubt that it's had: how often, how deep, where. */
const HARMLESS = new Set(
  (
    'a an and or with in at on for of the to via by from as e.g eg etc incl including also plus ' +
    'daily weekly monthly regularly regular every day days expert expertise advanced ' +
    'intermediate proficient proficiency fluent strong solid deep deeply heavy extensive ' +
    'extensively hands-on experienced experience production prod professional professionally ' +
    'primary main core lead led senior used use uses using work worked works year years yr yrs ' +
    'month months since current currently day-to-day frequent frequently built shipped ran run ' +
    'runs own owned wrote maintain maintained apps app apis services service team teams project ' +
    'projects systems system tools tool stack platform platforms data web mobile cloud backend ' +
    'frontend back-end front-end infrastructure infra'
  ).split(' '),
);

/** Whether a word beside a term leaves no doubt, as "daily", "4 years", "2021" or "acme.md" do. */
function harmless(word: string): boolean {
  if (DOUBT.test(word) || /^0+(?:\.0+)?$/.test(word)) return false;
  // A number of years or a version, a date, the file that proves it, or an acronym.
  if (/^\d/.test(word) || /\.md$/i.test(word) || /^\p{Lu}{2,}\d*s?$/u.test(word)) return true;
  return HARMLESS.has(word.toLowerCase());
}

/**
 * Whether what the user wrote holds nothing but these terms and harmless words, so a term in
 * it is had beyond doubt. Anything else, however it's put ("havent used it", "only ECS",
 * "maybe later", a "?"), leaves a doubt the user should settle.
 */
export function onlyHarmless(text: string, terms: readonly Hit[]): boolean {
  if (text.length > MAX_SOURCE) return false;
  const source = plain(text);
  let rest = '';
  let at = 0;
  for (const hit of [...terms].sort((a, b) => a.at - b.at)) {
    if (hit.at < at) continue;
    rest += ` ${source.slice(at, hit.at)} `;
    at = hit.at + hit.text.length;
  }
  rest += source.slice(at);
  // A mark that isn't punctuation or a tick, such as "?", "❌" or "🚫", may say otherwise.
  if (/[^\p{L}\p{N}\s.,;:()[\]/&+'’"*_#|—–✓✔✅☑-]/u.test(rest)) return false;
  return (rest.match(/[\p{L}\p{N}][\p{L}\p{N}'’.+#/-]*/gu) ?? []).every(harmless);
}

/** The terms the X-ray knows in a text, found once for each text. */
const knownIn = new Map<string, Hit[]>();
export function knownTerms(text: string): Hit[] {
  let found = knownIn.get(text);
  if (!found) {
    found = text.length > MAX_SOURCE ? [] : findTerms(plain(text), VOCABULARY);
    if (knownIn.size > 5_000) knownIn.clear();
    knownIn.set(text, found);
  }
  return found;
}

/**
 * A skill's name: a line's words before any ":" or dash, and of what's in brackets, only what
 * names terms, so "Amplitude (product analytics)" names product analytics too, and "Docker (but
 * not Kubernetes)" names only Docker.
 */
function nameOf(text: string): string {
  const head = text.split(/:|\s[—–-]\s/)[0] ?? '';
  let name = '';
  let at = 0;
  for (let open = head.indexOf('('); open >= 0; open = head.indexOf('(', at)) {
    const close = head.indexOf(')', open + 1);
    if (close < 0) break;
    const inside = head.slice(open + 1, close);
    const named = knownTerms(inside);
    name += `${head.slice(at, open)} ${named.length > 0 && onlyHarmless(inside, named) ? inside : ''} `;
    at = close + 1;
  }
  return (name + head.slice(at)).replace(/\s+/g, ' ').trim();
}

/** Whether a source's notes, what it says beside the skill's name, say something isn't had. */
export const notesRuleOut = (source: Source) =>
  says(NOT_HAD_NOTE, source.text.replace(source.name, ' '));

/** Whether a note names a term the X-ray knows, other than the skill's own, so it's about that. */
const namesOther = (notes: string, name: string) =>
  knownTerms(notes).some((hit) => !wordsIn(name).includes(hit.text.toLowerCase()));

/** A text's words in small letters, to look for another's in. */
const wordsIn = (text: string) => plain(text).toLowerCase();

/** A list item's lead in bold, as "**Languages:** Python, Go", and the words after it. */
const boldLead = (line: string) =>
  line.match(/^\s*(?:[-*+]|\d+[.)])\s+\*\*([^*]{1,80})\*\*:?\s*(\S.*)?$/);

/**
 * The skills in skills.md: each list item or table row, with its name, that isn't under a part
 * for skills to come or not had, isn't a task to do, and has no cell that says it isn't had.
 * "**Languages:** Python, Go" gives each of its terms. A line under a part to confirm, beside a
 * comment, or over a sub-item that may say otherwise isn't sure.
 */
function skillsIn(path: string, text: string): Source[] {
  const lines = placedLines(text);
  // A sub-item such as "Depth: learning" says the item isn't had; one that may say otherwise,
  // or is about another term, as "Django (learning)" is, leaves a doubt.
  const ruledOut = doubtedItems(
    lines,
    (line) => says(NOT_HAD_NOTE, line.line) && knownTerms(line.text).length === 0,
  );
  const doubted = doubtedItems(lines, (line) => DOUBT.test(line.line));
  const sources: Source[] = [];
  const where = fileName(path);
  for (const [at, line] of lines.entries()) {
    if (line.kind !== 'item' && line.kind !== 'row') continue;
    if (line.todo || isLabelItem(line) || hasNoCell(line) || ruledOut.has(at)) continue;
    if (underAny(line, 'later') || underAny(line, 'notHad')) continue;
    const sure =
      !line.commented && !doubted.has(at) && !underAny(line, 'check') && !underAny(line, 'open');
    const lead = line.kind === 'item' ? boldLead(line.line) : null;
    const listed = lead ? pieces(lead[2] ?? '') : [];
    // "**Languages:** Python, Go" lists skills; "**Python:** daily" is Python, with a note.
    if (lead && listed.length > 1 && knownTerms(lead[1] ?? '').length === 0) {
      for (const piece of listed) sources.push({ text: piece, name: nameOf(piece), where, sure });
      continue;
    }
    // A row's column for where it's proven, such as "Proven in", says nothing about having it.
    const whole =
      line.kind === 'row'
        ? [
            line.text,
            ...line.cells.filter((cell) => !PROOF.test(cell.header)).map((cell) => cell.value),
          ].join(', ')
        : line.text;
    const name = nameOf(line.text);
    // Notes that say the skill itself isn't had, naming nothing else, leave it out.
    const notes = whole.replace(name, ' ');
    if (says(NOT_HAD_NOTE, notes) && !namesOther(notes, name)) continue;
    sources.push({ text: whole, name, where, sure });
  }
  return sources;
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
    line.own.notEarned ||
    DOUBT.test(line.line) ||
    NOT_EARNED.test(line.line) ||
    hasNoCell(line) ||
    laterYear(line.line);
  const doubted = doubtedItems(lines, notEarned);
  return lines
    .filter((line, at) => {
      if (line.kind !== 'item' && line.kind !== 'row' && line.kind !== 'line') return false;
      if (!underAny(line, 'credential') || doubted.has(at) || line.todo) return false;
      if (isLabelItem(line) || notEarned(line)) return false;
      return !underAny(line, 'later') && !underAny(line, 'notHad') && !underAny(line, 'notEarned');
    })
    .map((line) => {
      const text = line.kind === 'row' ? line.line : line.text;
      return { text, name: text, where: fileName(path), sure: false };
    });
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
 * What gaps.md says: every line, heading, label and table row says what the user doesn't have,
 * but what's under a part for what needs confirming, and the open questions.
 */
function gapsIn(text: string): { saidNo: string[]; toConfirm: string[] } {
  const saidNo: string[] = [];
  const toConfirm: string[] = [];
  for (const line of placedLines(text)) {
    // A heading or label that only names a part, such as "Needs confirmation", says nothing.
    const names = line.own.confirm || line.own.open || line.own.saidNo;
    const titled = line.kind === 'heading' || line.kind === 'label' || isLabelItem(line);
    // A table's header names its columns, not something the user doesn't have.
    if ((names && titled) || line.kind === 'header') continue;
    const words = line.kind === 'row' ? line.line : line.text;
    const part = gapPart(line);
    if (part === 'no') saidNo.push(words);
    else if (part === 'confirm') toConfirm.push(words);
  }
  return { saidNo, toConfirm };
}

/** What a file says not to claim: every line under such a part, and any line that says so. */
function dontClaimIn(path: string, text: string): Source[] {
  const where = `${fileName(path)} · Don’t claim`;
  return placedLines(text)
    .filter((line) => line.own.dontClaim || underAny(line, 'dontClaim'))
    .map((line) => {
      const said = line.kind === 'row' ? line.line : line.text;
      return { text: said, name: said, where, sure: false };
    });
}

/** A claim's Keywords, term by term. */
function keywordsOf(block: FactBlock): string[] {
  for (const { text: line } of readable(block.body, false)) {
    const keywords = line.match(/^\s*[-*+]\s+\*\*Keywords:?\*\*:?\s*(\S.*)$/i)?.[1];
    if (keywords) return pieces(keywords);
  }
  return [];
}

/** Which of the bank's own files a path is, at its top: "facts/skills.md" is skills.md. */
const bankFile = (path: string) =>
  path
    .replace(/\\/g, '/')
    .toLowerCase()
    .replace(/^facts\//, '');

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
    const name = bankFile(file.path);
    if (fileName(name) === 'readme.md') continue;
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
        const source = { text: keyword, name: nameOf(keyword), where, sure: true };
        (confirmed ? terms.keywords : terms.toCheck).push(source);
      }
    }
  }
  return terms;
}
