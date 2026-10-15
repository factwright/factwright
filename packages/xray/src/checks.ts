import { formOf, READABLE, readable } from './dates.ts';
import type { Fields } from './fields.ts';
import { marginLines, orderJumps, strayDates, wideColumns } from './layout.ts';
import type { ReadFile } from './read.ts';
import { SECTION_NAMES, type Section } from './sections.ts';

/** What each check looks at. */
export type CheckId =
  | 'text'
  | 'order'
  | 'margins'
  | 'characters'
  | 'joined'
  | 'spaced'
  | 'layout'
  | 'contact'
  | 'dates'
  | 'headings'
  | 'fonts'
  | 'length';

/**
 * How a check came out. "fix": a system will likely get something wrong, so it's worth fixing.
 * "note": worth knowing, but most systems cope. "pass": nothing to do.
 */
export type CheckStatus = 'fix' | 'note' | 'pass';

export interface Check {
  id: CheckId;
  /** What it looks at, such as "Reading order". */
  name: string;
  status: CheckStatus;
  /** What it found, in a line. */
  summary: string;
  /** What it means and what to do, for a problem. */
  detail?: string;
  /** The text in question, as the parser reads it. */
  examples?: string[];
  /** The lines it's about, to mark in the text. */
  lines: number[];
}

/** Characters a parser can't use: control codes, the replacement mark, and private ones. */
const JUNK =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control codes are what it looks for.
  /[\u{0}-\u{8}\u{B}\u{C}\u{E}-\u{1F}\u{7F}-\u{9F}\u{FFFD}\u{E000}-\u{F8FF}]|[\u{F0000}-\u{10FFFF}]/u;

/** Pictures drawn as characters, such as ☎, ✉, ★ and emoji. Bullets, arrows and ✓ are fine. */
const SYMBOL =
  /(?![\u{2713}\u{2714}\u{A9}\u{AE}\u{2122}\u{2190}-\u{21FF}\u{25A0}-\u{25FF}])(?:[\u{2600}-\u{27BF}]|\p{Extended_Pictographic})/u;

/** Letters joined into one character, as some fonts draw "fi" and "ff". */
const JOINED = /[\u{FB00}-\u{FB06}]/u;

/**
 * Four or more letters with a space after each, as letter spacing can make a word read. Three,
 * as in a name's initials such as "A K M Rahman", are fine.
 */
const SPACED = /(?<![\p{L}\p{N}])(?:\p{L} ){3,}\p{L}(?![\p{L}\p{N}])/gu;

/** A stretch of a line worth marking: a character systems can't read, joined letters, or spaced ones. */
export interface TextMark {
  kind: 'junk' | 'joined' | 'spaced';
  /** Where it is in the line, from `start` up to but not including `end`. */
  start: number;
  end: number;
}

/** The stretches of a line the checks find, in order, to mark where they are. */
export function textMarks(text: string): TextMark[] {
  const marks: TextMark[] = [];
  for (const [kind, pattern] of [
    ['junk', new RegExp(JUNK.source, 'gu')],
    ['joined', new RegExp(JOINED.source, 'gu')],
    ['spaced', SPACED],
  ] as const) {
    for (const match of text.matchAll(pattern)) {
      const start = match.index ?? 0;
      marks.push({ kind, start, end: start + match[0].length });
    }
  }
  return marks.sort((a, b) => a.start - b.start);
}

/** Fonts that draw pictures in place of letters. */
const ICON_FONT = /awesome|icon|glyph|symbol|dingbat|wingding|webding|material|feather|ionic/i;

/**
 * Fonts on nearly every computer, with Windows or Office or on a Mac. A Word file names its
 * fonts rather than carrying them, so another font shows where one is missing.
 */
const COMMON_FONTS = new Set(
  [
    'Aptos',
    'Aptos Display',
    'Arial',
    'Arial Narrow',
    'Avenir',
    'Avenir Next',
    'Baskerville',
    'Book Antiqua',
    'Bookman Old Style',
    'Calibri',
    'Calibri Light',
    'Cambria',
    'Candara',
    'Century Gothic',
    'Consolas',
    'Constantia',
    'Corbel',
    'Courier New',
    'Didot',
    'Franklin Gothic',
    'Franklin Gothic Book',
    'Futura',
    'Garamond',
    'Georgia',
    'Gill Sans',
    'Gill Sans MT',
    'Helvetica',
    'Helvetica Neue',
    'Lucida Sans',
    'Menlo',
    'Optima',
    'Palatino',
    'Palatino Linotype',
    'Segoe UI',
    'Segoe UI Light',
    'Segoe UI Semibold',
    'Tahoma',
    'Times',
    'Times New Roman',
    'Trebuchet MS',
    'Verdana',
  ].map((font) => font.toLowerCase()),
);

const count = (n: number, word: string, plural = `${word}s`) => `${n} ${n === 1 ? word : plural}`;

/** A line, shortened to show in a list. */
const excerpt = (text: string, max = 80) =>
  text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;

/** A list of words for a sentence: "A", "A and B", "A, B and C". */
export function inWords(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

function textCheck(file: ReadFile): Check | null {
  const letters = file.lines.reduce(
    (sum, line) => sum + (line.text.match(/\p{L}/gu)?.length ?? 0),
    0,
  );
  if (letters >= 150) return null;
  return {
    id: 'text',
    name: 'Text',
    status: 'fix',
    summary: 'There’s almost no text to read',
    detail:
      'A system reads the words in a file. This one is nearly all pictures, as a scanned page or text turned into shapes is, so it reads as close to blank. Use a resume Factwright built.',
    lines: [],
  };
}

function orderCheck(file: ReadFile, sections: readonly Section[]): Check {
  const name = 'Reading order';
  const headings = new Set(sections.map((section) => section.line));
  // Headings read one after another, with what's under each read elsewhere.
  const stacked = sections.filter(
    (section, i) => i > 0 && (sections[i - 1] as Section).line === section.line - 1,
  );
  const jumps = file.format === 'pdf' ? orderJumps(file) : [];
  const stray = file.format === 'pdf' ? strayDates(file) : [];
  const problems: string[] = [];
  const lines: number[] = [];
  if (stacked.length > 0) {
    problems.push(
      'Section headings are read one after another, apart from what’s under them, so a system can’t tell which part is which.',
    );
    lines.push(...stacked.flatMap((section) => [section.line - 1, section.line]));
  }
  if (stray.length > 0) {
    problems.push(
      'Some dates are read away from the job they sit beside, so a system can’t tell which job they belong to.',
    );
    lines.push(...stray);
  }
  if (jumps.length > 0) {
    problems.push(
      'Part of the page is read out of order: the text jumps back up the page, as when a template draws something last.',
    );
    lines.push(...jumps.map((jump) => jump.to));
  }
  if (problems.length > 0) {
    return {
      id: 'order',
      name,
      status: 'fix',
      summary: 'Parts are read out of order',
      detail: `${problems.join(' ')} A one-column template reads in order.`,
      examples: [...new Set(lines)].slice(0, 4).map((at) => excerpt(file.lines[at]?.text ?? '')),
      lines: [...new Set(lines)],
    };
  }
  const wide = file.format === 'pdf' ? wideColumns(file, headings) : [];
  if (wide.length > 0 || file.columns > 1) {
    const pages = [...new Set(wide.map((stretch) => stretch.page))];
    return {
      id: 'order',
      name,
      status: 'note',
      summary:
        file.format === 'pdf'
          ? `Two columns side by side, on ${pages.length === 1 ? `page ${pages[0]}` : 'each page'}`
          : `Laid out in ${file.columns} columns`,
      detail:
        'Most systems read one column and then the other, as shown here. Some older ones read straight across the page and mix the two. A one-column template is safest; Factwright’s Word files always have one column.',
      lines: wide.flatMap((stretch) => stretch.lines),
    };
  }
  return { id: 'order', name, status: 'pass', summary: 'Reads top to bottom, in order', lines: [] };
}

function marginsCheck(file: ReadFile, fields: Fields): Check {
  const name = 'Headers and footers';
  const lines =
    file.format === 'pdf'
      ? marginLines(file)
      : file.lines.flatMap((line, at) =>
          line.part === 'header' || line.part === 'footer' ? [at] : [],
        );
  if (lines.length === 0) {
    return { id: 'margins', name, status: 'pass', summary: 'Nothing in a header or footer', lines };
  }
  const texts = lines.map((at) => file.lines[at]?.text ?? '');
  const contact = [fields.email, fields.phone].filter(
    (detail): detail is string => !!detail && texts.some((text) => text.includes(detail)),
  );
  if (file.format === 'docx') {
    return {
      id: 'margins',
      name,
      status: contact.length > 0 ? 'fix' : 'note',
      summary:
        contact.length > 0
          ? 'Your contact details are in the header or footer'
          : 'Text in the header or footer',
      detail:
        contact.length > 0
          ? 'Many systems skip a Word file’s header and footer, so they’d miss how to reach you. Put your contact details at the top of the page itself.'
          : 'Many systems skip a Word file’s header and footer, so they won’t see this. Keep anything that matters on the page itself.',
      examples: [...new Set(texts)].slice(0, 3).map((text) => excerpt(text)),
      lines,
    };
  }
  return {
    id: 'margins',
    name,
    status: 'note',
    summary: 'Text repeats at the top or bottom of each page',
    detail:
      'A system reads it where it falls, in the middle of your text, which can split a job in two. It does no harm otherwise.',
    examples: [...new Set(texts)].slice(0, 3).map((text) => excerpt(text)),
    lines,
  };
}

function charactersCheck(file: ReadFile): Check {
  const name = 'Characters';
  const junk = file.lines.flatMap((line, at) => (JUNK.test(line.text) ? [at] : []));
  if (junk.length > 0) {
    return {
      id: 'characters',
      name,
      status: 'fix',
      summary: `Junk characters on ${count(junk.length, 'line')}`,
      detail:
        'Some characters come out as nothing a system can read, as icons and some symbol fonts do. Use plain words in their place, such as “Phone” or “Email”.',
      examples: junk.slice(0, 4).map((at) => excerpt(file.lines[at]?.text ?? '')),
      lines: junk,
    };
  }
  const symbols = file.lines.flatMap((line, at) => (SYMBOL.test(line.text) ? [at] : []));
  if (symbols.length > 0) {
    return {
      id: 'characters',
      name,
      status: 'note',
      summary: `Symbols on ${count(symbols.length, 'line')}`,
      detail:
        'Symbols such as ☎, ✉ and ★ come through as odd characters in some systems, and never as words. Rating stars mean nothing to them. Words read better.',
      examples: symbols.slice(0, 4).map((at) => excerpt(file.lines[at]?.text ?? '')),
      lines: symbols,
    };
  }
  return {
    id: 'characters',
    name,
    status: 'pass',
    summary: 'Every character reads as text',
    lines: [],
  };
}

function joinedCheck(file: ReadFile): Check {
  const lines = file.lines.flatMap((line, at) => (JOINED.test(line.text) ? [at] : []));
  if (lines.length === 0) {
    return {
      id: 'joined',
      name: 'Joined letters',
      status: 'pass',
      summary: 'No letters joined into one',
      lines,
    };
  }
  const words = [
    ...new Set(
      lines.flatMap(
        (at) =>
          (file.lines[at]?.text ?? '').match(
            /[\p{L}\u{FB00}-\u{FB06}]*[\u{FB00}-\u{FB06}][\p{L}\u{FB00}-\u{FB06}]*/gu,
          ) ?? [],
      ),
    ),
  ];
  return {
    id: 'joined',
    name: 'Joined letters',
    status: 'fix',
    summary: `${count(words.length, 'word')} with letters joined into one character`,
    detail:
      'The font joins letters such as “fi” into a single character, so “efficient” reads as a different word, and a search for it misses. A resume Factwright built doesn’t have this.',
    examples: words.slice(0, 6),
    lines,
  };
}

function spacedCheck(file: ReadFile): Check {
  const found = file.lines.flatMap((line, at) =>
    [...line.text.matchAll(SPACED)].map((match) => ({ at, text: match[0] })),
  );
  if (found.length === 0) {
    return {
      id: 'spaced',
      name: 'Spaced letters',
      status: 'pass',
      summary: 'Words read whole',
      lines: [],
    };
  }
  return {
    id: 'spaced',
    name: 'Spaced letters',
    status: 'fix',
    summary: `Letters read one at a time in ${count(found.length, 'place')}`,
    detail:
      'Wide letter spacing makes a system read each letter as a word of its own, so it misses the word. A heading such as “S U M M A R Y” isn’t found. Use less spacing.',
    examples: [...new Set(found.map((each) => excerpt(each.text, 40)))].slice(0, 4),
    lines: [...new Set(found.map((each) => each.at))],
  };
}

/** A Word file's tables, text boxes and columns, which some systems read badly or skip. */
function layoutCheck(file: ReadFile, sections: readonly Section[], fields: Fields): Check | null {
  if (file.format !== 'docx') return null;
  const name = 'Tables and text boxes';
  const boxes = file.lines.flatMap((line, at) => (line.part === 'textbox' ? [at] : []));
  if (boxes.length > 0) {
    return {
      id: 'layout',
      name,
      status: 'fix',
      summary: `Text in ${count(boxes.length, 'line')} of text boxes`,
      detail:
        'Many systems skip text boxes, so they miss what’s in them. Put the text on the page itself.',
      examples: boxes.slice(0, 3).map((at) => excerpt(file.lines[at]?.text ?? '')),
      lines: boxes,
    };
  }
  const headings = new Set(sections.map((section) => section.line));
  const holding = file.tables.filter((table) => {
    const inside = (at: number) => at >= table.first && at < table.end;
    const text = file.lines.slice(table.first, table.end).map((line) => line.text);
    const wide = table.rows.some(
      (row) => row.filter((cell) => cell.replace(/\s+/g, ' ').length >= 60).length >= 2,
    );
    const contact = [fields.email, fields.phone].some(
      (detail) => detail && text.some((line) => line.includes(detail)),
    );
    return (
      wide || contact || [...headings].some(inside) || fields.jobs.some((job) => inside(job.line))
    );
  });
  if (holding.length > 0) {
    return {
      id: 'layout',
      name,
      status: 'fix',
      summary: 'Part of your resume is laid out in a table',
      detail:
        'Some systems read a table straight across its columns, mixing them, and older ones skip tables. Lay the text out on the page itself, in one column.',
      lines: holding.flatMap((table) =>
        Array.from({ length: table.end - table.first }, (_, i) => table.first + i),
      ),
    };
  }
  const small = file.tables.length;
  return {
    id: 'layout',
    name,
    status: 'pass',
    summary:
      small === 0
        ? 'No tables or text boxes'
        : small === 1
          ? 'No text boxes. Its one small table reads in order'
          : `No text boxes. Its ${small} small tables read in order`,
    lines: [],
  };
}

function contactCheck(file: ReadFile, fields: Fields): Check {
  const name = 'Contact details';
  const missing = [
    !fields.name && 'name',
    !fields.email && 'email address',
    !fields.phone && 'phone number',
  ].filter((each): each is string => !!each);
  if (!fields.name || !fields.email) {
    return {
      id: 'contact',
      name,
      status: 'fix',
      summary: `No ${inWords(missing)} found`,
      detail: !fields.email
        ? 'Every system needs an email address to reach you, and fills it in from your resume. Put it at the top, written out in full.'
        : 'A system takes your name from the first line. Put your name on its own line at the very top.',
      lines: [],
    };
  }
  if (!fields.phone || !fields.location) {
    const absent = [!fields.phone && 'phone number', !fields.location && 'city'].filter(
      (each): each is string => !!each,
    );
    return {
      id: 'contact',
      name,
      status: 'note',
      summary: `No ${inWords(absent)} found`,
      detail: !fields.phone
        ? 'Most systems have a place for a phone number, and many recruiters call first.'
        : 'Many recruiters search by place. Your city and state, or “Remote”, is enough.',
      lines: [],
    };
  }
  if (fields.nameLine !== null && fields.nameLine > 0) {
    return {
      id: 'contact',
      name,
      status: 'note',
      summary: 'Your name isn’t the first line',
      detail: `A system takes the first line for your name, and this reads “${excerpt(file.lines[0]?.text ?? '', 40)}” first. Put your name on its own line at the very top.`,
      lines: [0],
    };
  }
  return {
    id: 'contact',
    name,
    status: 'pass',
    summary: 'Name, email, phone and city all found',
    lines: [],
  };
}

function datesCheck(sections: readonly Section[], fields: Fields): Check | null {
  if (!sections.some((section) => section.kind === 'experience')) return null;
  const name = 'Dates';
  if (fields.jobs.length === 0) {
    return {
      id: 'dates',
      name,
      status: 'fix',
      summary: 'No dates found for your jobs',
      detail:
        'Systems count your years of experience from each job’s dates. Give each job its dates, with a month and year, such as 06/2019 – Present.',
      lines: [],
    };
  }
  const odd = fields.jobs.filter((job) => !readable(job.dates));
  if (odd.length > 0) {
    const forms = new Set(
      odd
        .flatMap((job) => [job.dates.start, job.dates.end])
        .map(formOf)
        .filter((form) => !READABLE.has(form)),
    );
    const why = forms.has('season')
      ? 'Seasons, such as “Summer 2019”,'
      : forms.has('quarter')
        ? 'Quarters, such as “Q3 2020”,'
        : 'Two-digit years, such as “’19”,';
    return {
      id: 'dates',
      name,
      status: 'fix',
      summary: `${count(odd.length, 'job')} with dates some systems can’t read`,
      detail: `${why} don’t read as dates in many systems, so the time can go uncounted. Use a month and year, such as 06/2019 or Jun 2019.`,
      examples: odd.map((job) => job.dates.text),
      lines: odd.map((job) => job.line),
    };
  }
  return {
    id: 'dates',
    name,
    status: 'pass',
    summary: `Every job’s dates read (${count(fields.jobs.length, 'job')})`,
    lines: [],
  };
}

function headingsCheck(sections: readonly Section[]): Check {
  const name = 'Section headings';
  const kinds = new Set(sections.map((section) => section.kind));
  if (!kinds.has('experience')) {
    return {
      id: 'headings',
      name,
      status: 'fix',
      summary: 'No heading systems know for your work history',
      detail:
        'Systems find your jobs under a heading such as “Experience” or “Work Experience”. Without one, they may not find them at all.',
      lines: [],
    };
  }
  const found = (['summary', 'experience', 'education', 'skills'] as const)
    .filter((kind) => kinds.has(kind))
    .map((kind) => SECTION_NAMES[kind]);
  if (!kinds.has('skills')) {
    return {
      id: 'headings',
      name,
      status: 'note',
      summary: 'No skills section',
      detail:
        'Many systems look for a section headed “Skills” and read the terms in it as your skills.',
      lines: [],
    };
  }
  return { id: 'headings', name, status: 'pass', summary: `${inWords(found)} found`, lines: [] };
}

function fontsCheck(file: ReadFile): Check {
  const name = 'Fonts';
  const icons = file.fonts.filter((font) => ICON_FONT.test(font));
  if (icons.length > 0) {
    return {
      id: 'fonts',
      name,
      status: 'fix',
      summary: `An icon font: ${inWords(icons)}`,
      detail:
        'An icon font draws pictures in place of letters, which systems read as junk or not at all. Use words in their place.',
      lines: [],
    };
  }
  const unusual =
    file.format === 'docx'
      ? file.fonts.filter((font) => !COMMON_FONTS.has(font.toLowerCase()))
      : [];
  if (unusual.length > 0) {
    return {
      id: 'fonts',
      name,
      status: 'note',
      summary: `Not on every computer: ${inWords(unusual)}`,
      detail:
        'A Word file names its fonts rather than carrying them, so where one is missing, Word shows another. Systems read the text the same, but a recruiter who opens the file sees a different look, and maybe more pages.',
      lines: [],
    };
  }
  const listed = file.fonts.length > 0 ? inWords(file.fonts.slice(0, 3)) : null;
  return {
    id: 'fonts',
    name,
    status: 'pass',
    summary: listed
      ? file.format === 'pdf'
        ? `${listed}, carried in the file`
        : `${listed}, on nearly every computer`
      : 'Nothing unusual',
    lines: [],
  };
}

function lengthCheck(file: ReadFile): Check {
  const name = 'Length';
  const pages = file.pageCount;
  if (pages === null) {
    return {
      id: 'length',
      name,
      status: 'pass',
      summary: 'Word sets the pages as it opens it',
      lines: [],
    };
  }
  if (pages > 2) {
    return {
      id: 'length',
      name,
      status: 'note',
      summary: `${count(pages, 'page')}${file.partial ? ', read in part' : ''}`,
      detail: 'Systems read every page, but most recruiters expect one or two.',
      lines: [],
    };
  }
  return { id: 'length', name, status: 'pass', summary: count(pages, 'page'), lines: [] };
}

/** Every check on a file, in the order the X-ray lists them, each example once. */
export function runChecks(file: ReadFile, sections: readonly Section[], fields: Fields): Check[] {
  const checks = [
    textCheck(file),
    orderCheck(file, sections),
    marginsCheck(file, fields),
    charactersCheck(file),
    joinedCheck(file),
    spacedCheck(file),
    layoutCheck(file, sections, fields),
    contactCheck(file, fields),
    datesCheck(sections, fields),
    headingsCheck(sections),
    fontsCheck(file),
    lengthCheck(file),
  ].filter((check): check is Check => check !== null);
  return checks.map((check) =>
    check.examples ? { ...check, examples: [...new Set(check.examples)] } : check,
  );
}

/** The lines a set of checks are about, each with the checks that mark it. */
export function marks(checks: readonly Check[]): Map<number, CheckId[]> {
  const marked = new Map<number, CheckId[]>();
  for (const check of checks) {
    if (check.status === 'pass') continue;
    for (const line of check.lines) marked.set(line, [...(marked.get(line) ?? []), check.id]);
  }
  return marked;
}
