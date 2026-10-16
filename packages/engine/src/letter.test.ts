import { Packer } from 'docx';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { letterDocument } from './docx.ts';
import { outputName } from './files.ts';
import { LETTER_MEASURE_SCRIPT } from './fit.ts';
import { renderHtml, renderLetterHtml } from './html.ts';
import { type CoverLetter, letterWords, readLetter } from './letter.ts';
import { lintLetter } from './lint.ts';
import { previewLetter, sampleLetter, sampleResume } from './sample.ts';
import { readTemplate, templateFile } from './template/file.ts';
import { builtInTemplate, TEMPLATES, type Template } from './templates.ts';

const classic = builtInTemplate('classic') as Template;

/**
 * One of the user's own templates, with no letter of its own: a side column and a navy name,
 * as a template made from someone's resume might have.
 */
const sidebar: Template = (() => {
  const read = readTemplate(
    {
      ...JSON.parse(templateFile(classic)),
      version: 1,
      letter: undefined,
      name: 'Navy Sidebar',
      look: 'A navy side column beside the experience.',
      fonts: ['selawik-regular.woff2', 'selawik-bold.woff2', 'barlow-bold.woff2'],
      word: {
        ...classic.word,
        head: 'Bahnschrift',
        body: 'Segoe UI',
        nameColor: '1F3A5F',
        headlineColor: 'C2410C',
        ruleColor: '1F3A5F',
        nameCaps: false,
        center: false,
        size: 19,
      },
      css: 'body{display:grid;grid-template-columns:2in 1fr}.hdr{grid-column:1}',
    },
    'navy-sidebar',
  );
  if (!read.ok) throw new Error(read.problems.join(' '));
  return read.template;
})();

/** The text of a Word document's body, from its document.xml. */
async function documentXml(letter: CoverLetter, template: Template): Promise<string> {
  const base64 = await Packer.toBase64String(letterDocument(letter, template));
  const zip = await JSZip.loadAsync(base64, { base64: true });
  return (await zip.file('word/document.xml')?.async('string')) ?? '';
}

describe('readLetter', () => {
  it('accepts a whole letter', () => {
    expect(readLetter(sampleLetter())).toEqual({ ok: true, letter: sampleLetter() });
    expect(readLetter(previewLetter()).ok).toBe(true);
  });

  it('names each problem by where it is', () => {
    const letter: Record<string, unknown> = { ...sampleLetter() };
    delete letter.greeting;
    letter.paragraphs = [];
    letter.recipient = 'Sam Lee';
    letter.layout = 'Fancy One';
    letter.format = 'rtf';
    letter.contact = { email: 4 };
    expect(readLetter(letter)).toEqual({
      ok: false,
      problems: [
        'letter.contact.email should be text.',
        'letter.recipient should be a list.',
        'letter.greeting is missing.',
        'letter.paragraphs should hold the letter, a paragraph each.',
        'letter.layout should be a template’s ID, such as classic or minimal.',
        'letter.format should be pdf, docx, both.',
      ],
    });
    expect(readLetter('Dear Sam')).toEqual({
      ok: false,
      problems: ['The letter should be a JSON object.'],
    });
  });

  it('counts the words in the letter itself', () => {
    expect(letterWords(sampleLetter())).toBe(27);
    // The made-up letter is as long as a real one: 250 to 400 words.
    expect(letterWords(previewLetter())).toBeGreaterThanOrEqual(250);
    expect(letterWords(previewLetter())).toBeLessThanOrEqual(400);
  });
});

describe('renderLetterHtml', () => {
  it.each(TEMPLATES)('lays the letter out under the resume’s own header in $name', (template) => {
    const html = renderLetterHtml(sampleLetter(), template);
    for (const text of [
      '<title>Alex Rivera — Cover Letter</title>',
      '<div class="name">Alex Rivera</div>',
      '<div class="headline">Staff Platform Engineer</div>',
      '<span>alex@example.com</span>',
      '<div class="ldate">October 14, 2026</div>',
      '<div>Sam Lee</div><div>Engineering Manager</div><div>Acme Robotics</div>',
      '<div class="lhi">Dear Sam Lee,</div>',
      'I cut deploy time by <strong>~40%</strong> at Tidewater.</p>',
      '<div class="lbye">Best regards,</div>',
      '<div class="lsig">Alex Rivera</div>',
      'Content-Security-Policy',
    ]) {
      expect(html).toContain(text);
    }
    // The same header as the resume, styled by the same rules, each sheet in its own element.
    const resume = renderHtml(sampleResume(), template);
    expect(html).toContain(`<style>${template.css}</style><style>${template.letter?.css}</style>`);
    expect(resume).toContain('<div class="name">Alex Rivera</div>');
    expect(html.match(/<p class="para">/g)).toHaveLength(2);
  });

  it('prints plainly, in its fonts and colors, for a template with no letter', () => {
    const html = renderLetterHtml(sampleLetter(), sidebar);
    // None of the template's own styles, which lay the page out in a side column.
    expect(html).not.toContain('grid-template-columns:2in 1fr');
    for (const text of [
      'font-family:"Selawik","Segoe UI",sans-serif',
      '.name{font-family:"Barlow","Bahnschrift",sans-serif;font-size:23pt',
      '--name:#1F3A5F',
      '--headline:#C2410C',
      '--rule:#1F3A5F',
      '<div class="name">Alex Rivera</div>',
      '<div class="headline">Staff Platform Engineer</div>',
      '<p class="para">',
      '<div class="lsig">Alex Rivera</div>',
    ]) {
      expect(html).toContain(text);
    }
    // A letter reads best a little larger than the template's resume text.
    expect(html).toContain('body{font-family:"Selawik","Segoe UI",sans-serif;font-size:10.5pt');
    expect(html).not.toContain('text-transform:uppercase');
  });

  it('names a Word font plainly when the template carries no font of its kind to stand in', () => {
    const own = { ...sidebar, fonts: ['caladea-regular.woff2' as const] };
    expect(renderLetterHtml(sampleLetter(), own)).toContain(
      'body{font-family:"Segoe UI",sans-serif',
    );
  });

  it('falls back on a font of the template’s own, of the same kind, for a computer without its Word font', () => {
    const own: Template = {
      ...sidebar,
      fonts: ['caladea-regular.woff2', 'caladea-bold.woff2', 'selawik-regular.woff2'],
      word: { ...sidebar.word, head: 'Garamond', body: 'Calibri' },
    };
    const html = renderLetterHtml(sampleLetter(), own);
    expect(html).toContain('.name{font-family:"Garamond","Caladea",serif;');
    expect(html).toContain('body{font-family:"Calibri","Selawik",sans-serif;');
  });

  it('tells fonts with serifs from those without by their names', () => {
    for (const [font, kind] of [
      ['Constantia', 'serif'],
      ['Book Antiqua', 'serif'],
      ['Century Schoolbook', 'serif'],
      ['Franklin Gothic Book', 'sans-serif'],
      ['Microsoft Sans Serif', 'sans-serif'],
      ['Century Gothic', 'sans-serif'],
      ['CenturyGothic', 'sans-serif'],
    ] as const) {
      const own: Template = { ...sidebar, fonts: [], word: { ...sidebar.word, body: font } };
      expect(renderLetterHtml(sampleLetter(), own)).toContain(
        `body{font-family:"${font}",${kind};`,
      );
    }
  });

  it('signs with the letter’s own signature, and leaves out what it doesn’t have', () => {
    const letter: CoverLetter = {
      ...sampleLetter(),
      signature: 'Alex',
      date: undefined,
      recipient: undefined,
      headline: undefined,
    };
    for (const template of [...TEMPLATES, sidebar]) {
      const html = renderLetterHtml(letter, template);
      expect(html).toContain('<div class="lsig">Alex</div>');
      expect(html).not.toContain('class="ldate"');
      expect(html).not.toContain('class="lto"');
    }
    expect(renderLetterHtml(letter, sidebar)).not.toContain('class="headline"');
  });

  it('makes the letter’s text safe, marking up only its **bold** and placeholders', () => {
    const html = renderLetterHtml(
      {
        ...sampleLetter(),
        greeting: 'Dear <b>Sam</b>,',
        paragraphs: ['Led [[team size]] engineers.', '<script>alert(1)</script>'],
      },
      classic,
    );
    expect(html).toContain('Dear &lt;b&gt;Sam&lt;/b&gt;,');
    expect(html).toContain('<mark class="ph">[team size]</mark>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>');
  });

  it('finds every paragraph for the fit check by its class', () => {
    expect(LETTER_MEASURE_SCRIPT).toContain("const selector = '.para';");
  });
});

describe('letterDocument', () => {
  it.each([...TEMPLATES, sidebar])(
    'writes the whole letter as a Word file in $name',
    async (template) => {
      const xml = await documentXml(sampleLetter(), template);
      for (const text of [
        'Staff Platform Engineer',
        'alex@example.com',
        'October 14, 2026',
        'Engineering Manager',
        'Dear Sam Lee,',
        'I cut deploy time by ',
        'Best regards,',
      ]) {
        expect(xml).toContain(text);
      }
      expect(xml).toContain(template.word.nameCaps ? 'ALEX RIVERA' : 'Alex Rivera');
      // In the order a letter reads.
      expect(xml.indexOf('October 14, 2026')).toBeLessThan(xml.indexOf('Dear Sam Lee,'));
      expect(xml.indexOf('Dear Sam Lee,')).toBeLessThan(xml.indexOf('Best regards,'));
    },
  );

  it('leaves out characters a Word file can’t hold', async () => {
    const xml = await documentXml(
      { ...sampleLetter(), paragraphs: ['Cut deploys\u000b by ~40%\u0001 for the team.'] },
      classic,
    );
    expect(xml).toContain('Cut deploys by ~40% for the team.');
    for (const control of ['\u0001', '\u000b']) expect(xml).not.toContain(control);
  });

  it('bolds **text**, and highlights placeholders', async () => {
    const xml = await documentXml(
      { ...sampleLetter(), paragraphs: ['Cut deploys by **~40%** for [[team]].'] },
      classic,
    );
    expect(xml).toMatch(/<w:b\/>.*~40%/);
    expect(xml).toContain('[team]');
    expect(xml).toContain('w:highlight w:val="yellow"');
  });
});

describe('lintLetter', () => {
  it('passes a letter that keeps the rules', () => {
    expect(lintLetter(previewLetter())).toEqual([]);
    expect(lintLetter(sampleLetter())).toEqual([]);
  });

  it('catches the clichés every letter is checked for', () => {
    const letter = {
      ...sampleLetter(),
      greeting: 'To whom it may concern,',
      paragraphs: [
        'I am writing to apply for the Staff Engineer role.',
        'I’m the perfect fit. Please find attached my resume. I look forward to hearing from you.',
      ],
    };
    // In the order of the rules every letter is checked against.
    expect(lintLetter(letter)).toEqual([
      '"I am writing to" isn\'t allowed: every letter opens this way; open with something about this job instead.',
      '"To whom it may concern" isn\'t allowed: address a person, or the team: "Dear Acme hiring team,".',
      '"Please find attached" isn\'t allowed: the reader has the resume already; say something they don’t know.',
      '"perfect fit" isn\'t allowed: a claim the reader can’t check; show the fit with a fact instead.',
      '"I look forward to hearing from you" isn\'t allowed: a stock line; close with a concrete next step instead.',
    ]);
  });

  it('catches the user’s banned wording, placeholders and confidential terms', () => {
    const letter = {
      ...sampleLetter(),
      paragraphs: ['A results-driven lead for [[team size]] engineers on the Bluebird rollout.'],
    };
    expect(
      lintLetter(
        letter,
        { banned: [{ pattern: 'results[- ]driven', why: 'a cliché readers skip' }] },
        ['bluebird'],
      ),
    ).toEqual([
      'A [[placeholder]] is still in the letter.',
      '"results-driven" isn\'t allowed: a cliché readers skip.',
      'A confidential term matching "bluebird" is in the letter.',
    ]);
  });
});

describe('outputName', () => {
  it('names a letter’s files for what it is', () => {
    const today = new Date(2026, 9, 14);
    expect(outputName(sampleLetter(), today, 'CoverLetter')).toBe(
      'AlexRiveraCoverLetter10142026_Acme',
    );
    expect(outputName({ ...sampleLetter(), output_name: undefined }, today, 'CoverLetter')).toBe(
      'AlexRiveraCoverLetter10142026',
    );
  });
});
