import { describe, expect, it } from 'vitest';
import { builtInTemplate, type Template } from '../templates.ts';
import { readTemplate, TEMPLATE_FILE, templateFile } from './file.ts';

const classic = builtInTemplate('classic') as Template;

/** A small template file, as Claude or the person who shared it would write one. */
const file = (changes: Record<string, unknown> = {}): Record<string, unknown> => ({
  ...TEMPLATE_FILE,
  name: ' Two Tone ',
  look: 'A dark header over plain text.',
  fonts: ['selawik-regular.woff2', 'selawik-bold.woff2'],
  titles: { ...classic.titles, experience: 'Work' },
  word: { ...classic.word },
  css: '.hdr{background:#123}',
  body: '<div class="hdr">{{> top}}</div>{{#experience}}<p>{{title}}</p>{{/experience}}',
  parts: { top: '<h1>{{name}}</h1>' },
  ...changes,
});

const problems = (changes: Record<string, unknown>, id = 'two-tone') => {
  const read = readTemplate(file(changes), id);
  return read.ok ? [] : read.problems;
};

describe('readTemplate', () => {
  it('reads a template from its file, with the ID its file name gives it', () => {
    expect(readTemplate(file(), 'two-tone')).toEqual({
      ok: true,
      template: {
        id: 'two-tone',
        name: 'Two Tone',
        look: 'A dark header over plain text.',
        fonts: ['selawik-regular.woff2', 'selawik-bold.woff2'],
        titles: { ...classic.titles, experience: 'Work' },
        word: classic.word,
        css: '.hdr{background:#123}',
        body: '<div class="hdr">{{> top}}</div>{{#experience}}<p>{{title}}</p>{{/experience}}',
        parts: { top: '<h1>{{name}}</h1>' },
      },
    });
    expect(readTemplate(file({ parts: undefined, body: '<p>{{name}}</p>' }), 'x').ok).toBe(true);
  });

  it('knows a file that isn’t a template, or is from a newer app', () => {
    expect(readTemplate([], 'x')).toEqual({
      ok: false,
      problems: ['A template file is a JSON object.'],
    });
    expect(readTemplate({ ...file(), factwright: undefined }, 'x')).toEqual({
      ok: false,
      problems: [
        'This isn’t a Factwright resume template: it needs "factwright": "resume-template".',
      ],
    });
    expect(readTemplate(file({ version: 3 }), 'x')).toEqual({
      ok: false,
      problems: ['This template is from a newer Factwright. Update the app to use it.'],
    });
    expect(readTemplate(file({ version: 0 }), 'x')).toEqual({
      ok: false,
      problems: ['template.version should be 1, or 2 with a letter.'],
    });
  });

  it('reads a letter’s layout, which shows the template’s parts too', () => {
    const letter = {
      css: '.para{margin:0}',
      body: '<div class="hdr">{{> top}}</div>{{#paragraphs}}<p class="para">{{.}}</p>{{/paragraphs}}',
    };
    for (const version of [1, 2]) {
      const read = readTemplate(file({ version, letter }), 'two-tone');
      expect(read.ok && read.template.letter).toEqual(letter);
    }
    expect(problems({ letter: { css: '.para{margin:0}' } })).toEqual([
      'template.letter.body should be text of up to 100000 characters.',
    ]);
    expect(problems({ letter: { ...letter, extra: 1 } })).toEqual([
      'template.letter should be an object with the letter’s css and body.',
    ]);
  });

  it('holds a letter’s layout to the rules the rest of a template meets', () => {
    expect(
      problems({
        letter: {
          css: '@import "https://example.com/x.css";',
          body: '<div>{{> missing}}{{summary_text}}<script></script></div>',
        },
      }),
    ).toEqual([
      'template.letter.css can’t @import. Put every style in it.',
      'template.letter.body: <script> isn’t allowed. Use text elements: div, span, section, h2, ul, li, table and the like.',
      'template.letter.body: {{summary_text}} isn’t part of a letter. A letter can show name, headline, contact, date, recipient, greeting, paragraphs, closing, signature and titles.',
      'template.letter.body shows {{> missing}}, which isn’t in template.parts.',
    ]);
    // A resume's names, such as its experience, aren't a letter's.
    expect(
      problems({ letter: { css: '', body: '{{#experience}}<p>{{title}}</p>{{/experience}}' } }),
    ).toEqual([
      'template.letter.body: {{title}} isn’t part of a letter. A letter can show name, headline, contact, date, recipient, greeting, paragraphs, closing, signature and titles.',
    ]);
    expect(problems({ letter: { css: '', body: '<p>Sincerely, {{name}}</p>' } })[0]).toContain(
      '“Sincerely,” would print on every letter. Every word comes from the letter',
    );
  });

  it('says what each field should be', () => {
    expect(
      problems(
        {
          extra: true,
          name: '',
          look: 'x'.repeat(161),
          fonts: ['comic-sans.woff2'],
          titles: { summary: 'Summary' },
        },
        'Two Tone',
      ),
    ).toEqual([
      'template.extra isn’t one of a template’s fields.',
      '“Two Tone” can’t be a template’s ID: lowercase letters, digits and hyphens only.',
      'template.name should be a short name, up to 40 characters.',
      'template.look should be a sentence about its look, up to 160 characters.',
      expect.stringContaining(
        'template.fonts should list font files it uses, each once, from: factwright-sans-regular.woff2',
      ),
      'template.titles should name each part, up to 40 characters: summary, competencies, experience, education, skills.',
    ]);
    expect(problems({ titles: { ...classic.titles, awards: 'Awards' } })).toEqual([
      'template.titles.awards isn’t a part with a title of its own. Besides the five, a template can name highlights and contact.',
    ]);
    const more = readTemplate(file({ titles: { ...classic.titles, highlights: ' Impact ' } }), 'x');
    expect(more.ok && more.template.titles.highlights).toBe('Impact');
    expect(problems({ titles: { ...classic.titles, contact: '' } })).toEqual([
      'template.titles.contact should be up to 40 characters.',
    ]);
    expect(problems({ fonts: ['caladea-bold.woff2', 'caladea-bold.woff2'] })[0]).toContain(
      'each once',
    );
  });

  it('checks the look in Word, which can only hold what Word does', () => {
    expect(
      problems({
        word: {
          ...classic.word,
          head: 'Font<script>',
          accent: 'blue',
          nameSize: 200,
          size: 10.5,
          center: 'yes',
        },
      }),
    ).toEqual([
      'template.word.head should be a font’s name, such as Calibri.',
      'template.word.accent should be a color as six hex digits, such as 1F3A5F.',
      'template.word.nameSize should be a whole number of half points, 20 to 96.',
      'template.word.size should be a whole number of half points, 14 to 28.',
      'template.word.center should be true or false.',
    ]);
    const read = readTemplate(file({ word: { ...classic.word, extra: 'x' } }), 'x');
    expect(read.ok && read.template.word).toEqual(classic.word);
  });

  it('checks the styles and markup', () => {
    expect(problems({ css: 'h1{}</style>' })).toEqual([
      'template.css can’t hold “<”. Write \\3c in a string.',
    ]);
    expect(problems({ css: 'a\u0000' })).toEqual(['template.css holds control characters.']);
    expect(problems({ body: '<script>{{name}}</script>' })[0]).toContain('<script> isn’t allowed');
    expect(problems({ body: '<p>{{nmae}} {{titles.sumary}}</p>' })).toEqual([
      expect.stringContaining('template.body: {{nmae}} isn’t part of a resume.'),
      expect.stringContaining('template.body: {{titles.sumary}} isn’t part of a resume.'),
    ]);
    expect(problems({ body: '{{#experience}}' })).toEqual([
      'template.body: {{#experience}} is never closed.',
    ]);
  });

  it('checks the parts: their names, that each one shown is there, and no circles', () => {
    expect(problems({ parts: { Top: '<h1>{{name}}</h1>' } })).toEqual([
      'template.parts: “Top” can’t be a part’s name: lowercase letters, digits, - and _.',
      'template.body shows {{> top}}, which isn’t in template.parts.',
    ]);
    expect(problems({ parts: { top: '{{> a}}', a: '{{> b}}', b: '{{> a}}' } })).toEqual([
      'template.parts show each other in a circle: a → b → a.',
    ]);
    expect(problems({ parts: { top: '<h1 onclick="x">{{name}}</h1>' } })[0]).toContain(
      'template.parts.top: <h1 onclick> isn’t allowed.',
    );
  });
});

describe('templateFile', () => {
  it('writes a template as its file, which reads back the same', () => {
    const text = templateFile(classic);
    expect(
      text.startsWith(
        '{\n  "factwright": "resume-template",\n  "version": 2,\n  "name": "Classic",',
      ),
    ).toBe(true);
    expect(JSON.parse(text)).not.toHaveProperty('id');
    expect(readTemplate(JSON.parse(text), 'classic')).toEqual({ ok: true, template: classic });
  });

  it('writes one with no letter as version 1, which apps from before letters read', () => {
    const { letter: _letter, ...plain } = classic;
    const text = templateFile(plain);
    expect(JSON.parse(text)).toMatchObject({ factwright: 'resume-template', version: 1 });
    expect(JSON.parse(text)).not.toHaveProperty('letter');
    expect(readTemplate(JSON.parse(text), 'classic')).toEqual({ ok: true, template: plain });
  });
});
