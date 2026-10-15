import { FONT_FILES, type FontFile } from '../fonts.ts';
import { escapeHtml } from '../markup.ts';
import { previewLetter, previewResume } from '../sample.ts';
import {
  type LetterLayout,
  type SectionTitles,
  TEMPLATE_ID,
  type Template,
  type WordTheme,
} from '../templates.ts';
import { cssProblems, markupProblems } from './check.ts';
import { renderBody, renderLetterBody } from './render.ts';
import { type Node, PART_NAME, parseTemplate } from './syntax.ts';
import { LETTER_VIEW_NAMES, VIEW_NAMES } from './view.ts';

/**
 * What a template file says it is, so a file can be known for one, and the newest version this
 * app reads. Version 2 added the letter's layout, so a file with none is written as version 1,
 * which apps before it read too.
 */
export const TEMPLATE_FILE = { factwright: 'resume-template', version: 2 } as const;

/** The most a template file may weigh: its styles can carry pictures and fonts as data: URLs. */
export const MAX_TEMPLATE_BYTES = 2_000_000;

const MAX = { name: 40, look: 160, title: 40, css: 1_500_000, markup: 100_000, parts: 40 };

const FIELDS = [
  'factwright',
  'version',
  'name',
  'look',
  'fonts',
  'titles',
  'word',
  'css',
  'body',
  'parts',
  'letter',
];

const TITLES: readonly (keyof SectionTitles)[] = [
  'summary',
  'competencies',
  'experience',
  'education',
  'skills',
];

/** Titles only a template that shows them needs. */
const MORE_TITLES: readonly (keyof SectionTitles)[] = ['highlights', 'contact'];

const COLORS = [
  'accent',
  'accent2',
  'muted',
  'tint',
  'nameColor',
  'headlineColor',
  'ruleColor',
] as const;

/** A font's name in Word, such as "Segoe UI" or "Times New Roman". */
const WORD_FONT = /^[A-Za-z0-9][A-Za-z0-9 .'-]{0,39}$/;

// Characters a template never needs: the controls other than tabs and line breaks.
// biome-ignore lint/suspicious/noControlCharactersInRegex: these are what it finds.
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isLine = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.trim() !== '' && value.length <= max && !/[\r\n]/.test(value);

/** Every value and section name in a template's pieces, and every part they show. */
function names(nodes: readonly Node[], found: { values: Set<string>; parts: Set<string> }) {
  for (const node of nodes) {
    if (node.kind === 'value' || node.kind === 'section') found.values.add(node.name);
    if (node.kind === 'part') found.parts.add(node.name);
    if (node.kind === 'section') names(node.nodes, found);
  }
  return found;
}

/** What a resume's markup can show, and a letter's, to say so when a name isn't one of them. */
const SHOWS = {
  resume: {
    kind: 'resume',
    names: VIEW_NAMES,
    what: 'a resume. A template can show name, headline, tagline, contact, summary, stats, competencies, systems, experience, projects, education, education_first, skills, extra_sections and titles, and their fields',
  },
  letter: {
    kind: 'letter',
    names: LETTER_VIEW_NAMES,
    what: 'a letter. A letter can show name, headline, contact, date, recipient, greeting, paragraphs, closing, signature and titles.contact',
  },
} as const;

/** Markup's problems: its syntax, its elements, and names nothing in a resume or letter has. */
function markup(
  source: unknown,
  where: string,
  shows: (typeof SHOWS)[keyof typeof SHOWS] = SHOWS.resume,
): { problems: string[]; parts: Set<string> } {
  const none = new Set<string>();
  if (typeof source !== 'string' || source.length > MAX.markup) {
    return {
      problems: [`${where} should be text of up to ${MAX.markup} characters.`],
      parts: none,
    };
  }
  if (CONTROL.test(source))
    return { problems: [`${where} holds control characters.`], parts: none };
  const read = parseTemplate(source, where);
  if (!read.ok) return { problems: read.problems, parts: none };
  const found = names(read.nodes, { values: new Set(), parts: new Set() });
  const unknown = [...found.values].filter(
    (name) => name !== '.' && name.split('.').some((word) => !shows.names.has(word)),
  );
  return {
    problems: [
      ...markupProblems(read.nodes, where, shows.kind),
      ...unknown.map((name) => `${where}: {{${name}}} isn’t part of ${shows.what}.`),
    ],
    parts: found.parts,
  };
}

function wordProblems(word: unknown): string[] {
  if (!isObject(word)) return ['template.word should be an object: the look in Word.'];
  const problems: string[] = [];
  for (const font of ['head', 'body'] as const) {
    if (typeof word[font] !== 'string' || !WORD_FONT.test(word[font])) {
      problems.push(`template.word.${font} should be a font’s name, such as Calibri.`);
    }
  }
  for (const color of COLORS) {
    if (typeof word[color] !== 'string' || !/^[0-9A-Fa-f]{6}$/.test(word[color])) {
      problems.push(`template.word.${color} should be a color as six hex digits, such as 1F3A5F.`);
    }
  }
  const size = (key: string, min: number, max: number) => {
    const value = word[key];
    if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
      problems.push(
        `template.word.${key} should be a whole number of half points, ${min} to ${max}.`,
      );
    }
  };
  size('nameSize', 20, 96);
  size('size', 14, 28);
  for (const flag of ['nameCaps', 'center'] as const) {
    if (typeof word[flag] !== 'boolean')
      problems.push(`template.word.${flag} should be true or false.`);
  }
  return problems;
}

/** A checked Word look, with only the fields Word uses. */
const wordTheme = (word: Record<string, unknown>): WordTheme => ({
  head: word.head as string,
  body: word.body as string,
  accent: word.accent as string,
  accent2: word.accent2 as string,
  muted: word.muted as string,
  tint: word.tint as string,
  nameColor: word.nameColor as string,
  headlineColor: word.headlineColor as string,
  ruleColor: word.ruleColor as string,
  nameSize: word.nameSize as number,
  nameCaps: word.nameCaps as boolean,
  center: word.center as boolean,
  size: word.size as number,
});

/** The parts that show each other in a circle, which would never finish. */
function circle(shows: ReadonlyMap<string, ReadonlySet<string>>): string | null {
  const done = new Set<string>();
  const visit = (name: string, path: string[]): string | null => {
    if (path.includes(name)) return [...path.slice(path.indexOf(name)), name].join(' → ');
    if (done.has(name)) return null;
    for (const next of shows.get(name) ?? []) {
      const found = visit(next, [...path, name]);
      if (found) return found;
    }
    done.add(name);
    return null;
  };
  for (const name of shows.keys()) {
    const found = visit(name, []);
    if (found) return found;
  }
  return null;
}

/**
 * A letter layout's problems, if it has one, and the parts its markup shows. Its styles print
 * after the template's, so they're checked together too, as well as each on its own.
 */
function letterProblems(
  letter: unknown,
  css: unknown,
  version: unknown,
): { problems: string[]; parts: Set<string> } {
  const none = new Set<string>();
  if (letter === undefined) return { problems: [], parts: none };
  if (version !== TEMPLATE_FILE.version) {
    return {
      problems: [`A template with a letter is version ${TEMPLATE_FILE.version}.`],
      parts: none,
    };
  }
  if (!isObject(letter) || Object.keys(letter).some((key) => key !== 'css' && key !== 'body')) {
    return {
      problems: ['template.letter should be an object with the letter’s css and body.'],
      parts: none,
    };
  }
  const problems: string[] = [];
  if (typeof letter.css !== 'string' || letter.css.length > MAX.css) {
    problems.push(`template.letter.css should be text of up to ${MAX.css} characters.`);
  } else if (CONTROL.test(letter.css)) {
    problems.push('template.letter.css holds control characters.');
  } else {
    problems.push(...cssProblems(letter.css, 'template.letter.css', 'letter'));
    if (problems.length === 0 && typeof css === 'string') {
      problems.push(
        ...cssProblems(`${css}\n${letter.css}`, 'template.css with template.letter.css', 'letter'),
      );
    }
  }
  const body = markup(letter.body, 'template.letter.body', SHOWS.letter);
  return { problems: [...problems, ...body.problems], parts: body.parts };
}

/**
 * A template from its file, given the ID its file name gives it, or what's wrong with it in
 * plain words, for whoever made it to fix: Claude, or the person who shared it. A template
 * that passes can only lay out text: see check.ts.
 */
export function readTemplate(
  value: unknown,
  id: string,
): { ok: true; template: Template } | { ok: false; problems: string[] } {
  if (!isObject(value)) return { ok: false, problems: ['A template file is a JSON object.'] };
  if (value.factwright !== TEMPLATE_FILE.factwright) {
    return {
      ok: false,
      problems: [
        'This isn’t a Factwright resume template: it needs "factwright": "resume-template".',
      ],
    };
  }
  if (value.version !== 1 && value.version !== TEMPLATE_FILE.version) {
    return {
      ok: false,
      problems: [
        typeof value.version === 'number' && value.version > TEMPLATE_FILE.version
          ? 'This template is from a newer Factwright. Update the app to use it.'
          : `template.version should be 1, or ${TEMPLATE_FILE.version} with a letter.`,
      ],
    };
  }
  const problems: string[] = [];
  for (const key of Object.keys(value)) {
    if (!FIELDS.includes(key)) problems.push(`template.${key} isn’t one of a template’s fields.`);
  }
  if (!TEMPLATE_ID.test(id)) {
    problems.push(`“${id}” can’t be a template’s ID: lowercase letters, digits and hyphens only.`);
  }
  if (!isLine(value.name, MAX.name)) {
    problems.push(`template.name should be a short name, up to ${MAX.name} characters.`);
  }
  if (!isLine(value.look, MAX.look)) {
    problems.push(
      `template.look should be a sentence about its look, up to ${MAX.look} characters.`,
    );
  }
  const fonts = value.fonts;
  if (
    !Array.isArray(fonts) ||
    fonts.some((font) => !(FONT_FILES as readonly unknown[]).includes(font)) ||
    new Set(fonts).size !== fonts.length
  ) {
    problems.push(
      `template.fonts should list font files it uses, each once, from: ${FONT_FILES.join(', ')}.`,
    );
  }
  const titles = value.titles;
  if (!isObject(titles) || TITLES.some((key) => !isLine(titles[key], MAX.title))) {
    problems.push(
      `template.titles should name each part, up to ${MAX.title} characters: ${TITLES.join(', ')}.`,
    );
  } else {
    for (const key of Object.keys(titles)) {
      if (!([...TITLES, ...MORE_TITLES] as readonly string[]).includes(key)) {
        problems.push(
          `template.titles.${key} isn’t a part with a title of its own. Besides the five, a template can name highlights and contact.`,
        );
      } else if (!isLine(titles[key], MAX.title)) {
        problems.push(`template.titles.${key} should be up to ${MAX.title} characters.`);
      }
    }
  }
  problems.push(...wordProblems(value.word));
  if (typeof value.css !== 'string' || value.css.length > MAX.css) {
    problems.push(`template.css should be text of up to ${MAX.css} characters.`);
  } else if (CONTROL.test(value.css)) {
    problems.push('template.css holds control characters.');
  } else {
    problems.push(...cssProblems(value.css, 'template.css'));
  }

  const parts = value.parts ?? {};
  const shows = new Map<string, Set<string>>();
  const body = markup(value.body, 'template.body');
  problems.push(...body.problems);
  const letter = letterProblems(value.letter, value.css, value.version);
  problems.push(...letter.problems);
  if (!isObject(parts) || Object.keys(parts).length > MAX.parts) {
    problems.push(
      `template.parts should be an object of up to ${MAX.parts} named pieces of markup.`,
    );
  } else {
    for (const [name, source] of Object.entries(parts)) {
      if (!PART_NAME.test(name)) {
        problems.push(
          `template.parts: “${name}” can’t be a part’s name: lowercase letters, digits, - and _.`,
        );
        continue;
      }
      const part = markup(source, `template.parts.${name}`);
      problems.push(...part.problems);
      shows.set(name, part.parts);
    }
    for (const [where, used] of [
      ['template.body', body.parts] as const,
      ['template.letter.body', letter.parts] as const,
      ...shows,
    ]) {
      for (const name of used) {
        if (!Object.hasOwn(parts, name))
          problems.push(`${where} shows {{> ${name}}}, which isn’t in template.parts.`);
      }
    }
    const loop = circle(shows);
    if (loop) problems.push(`template.parts show each other in a circle: ${loop}.`);
  }
  if (problems.length > 0) return { ok: false, problems };
  const template: Template = {
    id,
    name: (value.name as string).trim(),
    look: (value.look as string).trim(),
    fonts: fonts as FontFile[],
    titles: Object.fromEntries(
      [...TITLES, ...MORE_TITLES].flatMap((key) => {
        const title = (titles as Record<string, unknown>)[key];
        return typeof title === 'string' ? [[key, title.trim()]] : [];
      }),
    ) as unknown as SectionTitles,
    word: wordTheme(value.word as Record<string, unknown>),
    css: value.css as string,
    body: value.body as string,
    parts: parts as Record<string, string>,
    ...(isObject(value.letter) && {
      letter: { css: value.letter.css, body: value.letter.body } as LetterLayout,
    }),
  };
  // A page in it must print in reasonable time and length, whatever its parts do, and a letter.
  try {
    renderBody(template, previewResume());
    const letterProblem =
      template.letter && showsLetter(renderLetterBody(template, previewLetter()));
    if (letterProblem) return { ok: false, problems: [letterProblem] };
  } catch (error) {
    return { ok: false, problems: [error instanceof Error ? error.message : String(error)] };
  }
  return { ok: true, template };
}

/**
 * What's missing from a letter layout's page, if anything: it has to show the whole letter, with
 * each paragraph in an element with class "para", which the fit check measures. One that leaves
 * part of the letter out would print a letter its writer never sees.
 */
function showsLetter(page: string): string | null {
  const letter = previewLetter();
  const shown = [
    letter.greeting,
    ...letter.paragraphs,
    letter.closing,
    letter.signature ?? letter.name,
  ];
  const paragraphs = page.match(/class="(?:[^"]*\s)?para(?:\s[^"]*)?"/g)?.length ?? 0;
  if (
    shown.every((text) => page.includes(escapeHtml(text))) &&
    paragraphs === letter.paragraphs.length
  ) {
    return null;
  }
  return 'template.letter.body has to show the whole letter: {{greeting}}, each of {{#paragraphs}} in an element with class "para", {{closing}} and {{signature}}.';
}

/**
 * A template as its file holds it, as JSON: everything but its ID, which names the file. One
 * with no letter layout is version 1, which apps from before letters read too.
 */
export function templateFile(template: Template): string {
  const { id: _id, ...rest } = template;
  const version = template.letter ? TEMPLATE_FILE.version : 1;
  return `${JSON.stringify({ factwright: TEMPLATE_FILE.factwright, version, ...rest }, null, 2)}\n`;
}
