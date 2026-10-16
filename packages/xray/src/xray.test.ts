import { readdirSync, readFileSync } from 'node:fs';
// pdf.js's build for Node, which brings what Node 24 lacks. The app's window reads with the other.
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it } from 'vitest';
import type { CheckId } from './checks.ts';
import { readDocx } from './docx.ts';
import { readPdf } from './pdf.ts';
import type { ReadFile } from './read.ts';
import { fileOf, wordLine } from './testing.ts';
import { xray } from './xray.ts';

// The fixtures are real files: a made-up resume the engine printed in Classic and Minimal, as
// the app does, and files with each problem the X-ray looks for. scripts/fixtures.ts makes them.
const FIXTURES = new URL('../test/fixtures/', import.meta.url);
const fixture = (name: string) => new Uint8Array(readFileSync(new URL(name, FIXTURES)));

async function read(name: string): Promise<ReadFile> {
  return name.endsWith('.pdf') ? readPdf(fixture(name), getDocument) : readDocx(fixture(name));
}

const posting = readFileSync(new URL('posting.md', FIXTURES), 'utf8');
const facts = readdirSync(new URL('facts/', FIXTURES)).map((name) => ({
  path: `facts/${name}`,
  text: readFileSync(new URL(`facts/${name}`, FIXTURES), 'utf8'),
}));

/** The checks that didn't pass, by how they came out. */
const flagged = (result: ReturnType<typeof xray>) =>
  Object.fromEntries(
    result.checks
      .filter((check) => check.status !== 'pass')
      .map((check) => [check.id, check.status]),
  ) as Partial<Record<CheckId, string>>;

describe('the templates the app comes with', () => {
  for (const file of ['classic.pdf', 'minimal.pdf', 'classic.docx', 'minimal.docx']) {
    it(`reads ${file} cleanly, with nothing flagged`, async () => {
      const result = xray(await read(file));
      expect(flagged(result)).toEqual({});
      expect(result.summary.text).toBe('Reads cleanly · Nothing to fix');
    });

    it(`pulls every field out of ${file}`, async () => {
      const { fields } = xray(await read(file));
      expect(fields.name?.toLowerCase()).toBe('jordan avery');
      expect(fields.nameLine).toBe(0);
      expect(fields.email).toBe('jordan.avery@example.com');
      expect(fields.phone).toBe('(555) 014-2387');
      expect(fields.location).toBe('Denver, CO');
      expect(fields.links).toEqual(['linkedin.com/in/jordan-avery']);
      expect(
        fields.jobs.map(({ title, company, location, dates }) => [
          title,
          company,
          location,
          dates.text,
        ]),
      ).toEqual([
        ['Senior Product Manager', 'Northwind Stays', 'Denver, CO', '04/2021 – Present'],
        ['Product Manager', 'Bramble Market', 'Remote', '06/2018 – 03/2021'],
        ['Business Analyst', 'Cedar & Pine Consulting', 'Chicago, IL', '07/2016 – 05/2018'],
      ]);
      expect(fields.education).toEqual([
        expect.objectContaining({
          degree: 'B.S., Economics',
          school: 'University of Colorado Boulder',
          dates: '2016',
        }),
      ]);
      expect(fields.skills).toEqual(
        expect.arrayContaining(['Product strategy', 'A/B testing', 'SQL', 'Jira']),
      );
    });

    it(`finds ${file}'s sections, the highlight cards' heading among them`, async () => {
      const { sections } = xray(await read(file));
      expect(sections.map((section) => section.kind)).toEqual([
        'summary',
        'skills',
        'projects',
        'experience',
        'education',
        'skills',
      ]);
      expect(sections[2]?.title.toLowerCase()).toBe('selected work');
    });
  }

  it('reads the PDF in the order the page is read, line by line', async () => {
    const file = await read('classic.pdf');
    expect(file.lines.slice(0, 4).map((line) => line.text)).toEqual([
      'JORDAN AVERY',
      'Senior Product Manager',
      'Marketplaces · Growth · Data-informed roadmaps',
      '(555) 014-2387 · jordan.avery@example.com · linkedin.com/in/jordan-avery · Denver, CO',
    ]);
    expect(file.pageCount).toBe(1);
    expect(file.fonts).toEqual(['Caladea']);
  });

  it('reads the Word file’s highlights from its one small table, in order', async () => {
    const file = await read('classic.docx');
    expect(file.tables).toHaveLength(1);
    expect(file.tables[0]?.rows[0]?.[0]).toBe('~31%\nHigher repeat bookings');
    expect(file.fonts).toEqual(['Cambria']);
  });
});

describe('words with letters fonts draw as one, such as fi and fl', () => {
  // Jordan Avery as a financial planner, printed as the app prints: in Classic, in Minimal and
  // in a template of the user's own whose styles ask for joined letters, and letters in the plain
  // layout of that template and of one whose Word files are in Garamond, which the app doesn't
  // carry. The resumes have these words in plain, bold and italic text and headings, and the
  // letters in their text.
  const words = [
    'certified',
    'first',
    'profile',
    'office',
    'workflow',
    'staff',
    'efficient',
    'affluent',
  ];
  const files = [
    'fi-classic.pdf',
    'fi-minimal.pdf',
    'fi-own.pdf',
    'fi-letter.pdf',
    'fi-letter-garamond.pdf',
  ];

  for (const file of files) {
    it(`reads them in ${file} as the letters, never one character`, async () => {
      const result = xray(await read(file));
      expect(result.checks.find((check) => check.id === 'joined')?.status).toBe('pass');
      const text = result.lines.map((line) => line.text).join('\n');
      expect(text).not.toMatch(/[\uFB00-\uFB06]/);
      for (const word of words) expect(text).toMatch(new RegExp(`\\b${word}\\b`, 'i'));
    });
  }

  // Each font that draws joined letters, with words it set in each file: a font whose joined
  // shapes read as nothing, such as "Certied", would fail here even if the word is elsewhere.
  const byFont: Readonly<Record<string, readonly [font: string, text: string][]>> = {
    'fi-classic.pdf': [
      ['Caladea-Italic', 'Certified Financial Planner'],
      ['Caladea-Italic', 'Family office for affluent clients'],
      ['Caladea-Italic', 'Staffing'],
    ],
    'fi-own.pdf': [
      ['Caladea-Italic', 'Certified Financial Planner'],
      ['FactwrightSans-Regular', 'Certified planner who fills the first meeting with'],
      ['FactwrightSans-Bold', 'efficient'],
      ['FactwrightSans-Bold', 'Office efficiency review'],
      ['FactwrightSans-Italic', 'Family office for affluent clients'],
      ['FactwrightSans-Italic', 'Staffing'],
      ['Barlow-Bold', 'Profile'],
      ['Barlow-Bold', 'Proficiencies'],
      ['Barlow-Bold', 'Certifications'],
      ['Barlow-Bold', 'Affiliations'],
    ],
    'fi-letter.pdf': [
      [
        'FactwrightSans-Regular',
        'a certified planner who can run an efficient office for affluent',
      ],
      ['FactwrightSans-Regular', 'Certified Financial Planner'],
    ],
    'fi-letter-garamond.pdf': [
      ['Caladea-Regular', 'a certified planner who can run an efficient office for affluent'],
    ],
  };
  for (const [file, expected] of Object.entries(byFont)) {
    it(`reads ${file} the same in each font that draws joined letters`, async () => {
      const { lines } = await read(file);
      const inFont = (font: string) =>
        lines.map((line) =>
          line.runs
            .filter((run) => run.font === font)
            .map((run) => run.text)
            .join(''),
        );
      for (const [font, text] of expected) {
        expect(inFont(font)).toContainEqual(expect.stringContaining(text));
      }
    });
  }

  for (const file of ['fi-classic.pdf', 'fi-minimal.pdf', 'fi-own.pdf']) {
    it(`reads the resume in ${file} cleanly, with nothing flagged`, async () => {
      expect(flagged(xray(await read(file)))).toEqual({});
    });
  }

  it('knows headings with fi and fl in them, such as Profile and Affiliations', async () => {
    const { sections } = xray(await read('fi-own.pdf'));
    expect(sections.map((section) => [section.title, section.kind])).toEqual([
      ['Profile', 'summary'],
      ['Proficiencies', 'skills'],
      ['Selected Work', 'projects'],
      ['Professional Experience', 'experience'],
      ['Education', 'education'],
      ['Skills', 'skills'],
      ['Certifications', 'certifications'],
      ['Affiliations', 'affiliations'],
    ]);
  });
});

describe('files with problems', () => {
  it('notes a sidebar, but reads each column whole, with the name first', async () => {
    const result = xray(await read('sidebar.pdf'));
    expect(flagged(result)).toEqual({ order: 'note' });
    expect(result.fields.location).toBe('Denver, CO');
    expect(result.fields.jobs).toHaveLength(3);
  });

  it('finds letters spaced so wide they read one at a time', async () => {
    const result = xray(await read('spaced.pdf'));
    const spaced = result.checks.find((check) => check.id === 'spaced');
    expect(spaced?.status).toBe('fix');
    expect(spaced?.examples?.[0]).toBe('S U M M A R Y');
    // So no heading systems know is found, either.
    expect(flagged(result)).toEqual({ spaced: 'fix', headings: 'fix' });
  });

  it('finds icons that come out as junk', async () => {
    const result = xray(await read('icons.pdf'));
    expect(flagged(result)).toEqual({ characters: 'fix' });
    expect(result.lines.find((line) => line.marks.includes('characters'))?.text).toContain(
      '(555) 014-2387',
    );
  });

  it('finds dates drawn after the rest of their job, which can’t be matched to it', async () => {
    const result = xray(await read('dates-last.pdf'));
    expect(flagged(result)).toEqual({ order: 'fix' });
    expect(result.checks.find((check) => check.id === 'order')?.examples).toEqual([
      '04/2021 – Present',
      '06/2018 – 03/2021',
      '07/2016 – 05/2018',
    ]);
  });

  it('notes text repeated at the foot of each page', async () => {
    const result = xray(await read('footer.pdf'));
    expect(result.pageCount).toBe(2);
    expect(flagged(result)).toEqual({ margins: 'note' });
    expect(result.checks.find((check) => check.id === 'margins')?.examples).toEqual([
      'Jordan Avery · Senior Product Manager',
    ]);
  });

  it('finds contact details in a Word file’s header, which many systems skip', async () => {
    const result = xray(await read('header.docx'));
    expect(flagged(result)).toEqual({ margins: 'fix' });
    expect(result.lines[0]).toMatchObject({ text: 'Jordan Avery', part: 'header' });
    expect(result.lines.at(-1)).toMatchObject({ text: 'References on request', part: 'footer' });
  });

  it('finds text in a text box, read once', async () => {
    const result = xray(await read('textbox.docx'));
    expect(flagged(result)).toEqual({ layout: 'fix' });
    expect(result.lines.filter((line) => line.part === 'textbox').map((line) => line.text)).toEqual(
      ['Certified ScrumMaster', 'Fluent in Spanish'],
    );
  });

  it('finds a resume laid out in a table', async () => {
    expect(flagged(xray(await read('table.docx')))).toEqual({ layout: 'fix' });
  });

  it('notes newspaper columns', async () => {
    expect(flagged(xray(await read('columns.docx')))).toEqual({ order: 'note' });
  });

  it('finds dates in seasons and two-digit years, and letters joined into one', async () => {
    const result = xray(await read('odd-dates.docx'));
    expect(flagged(result)).toEqual({ joined: 'fix', dates: 'fix' });
    expect(result.checks.find((check) => check.id === 'joined')?.examples).toEqual([
      'eﬃcient',
      'workﬂows',
    ]);
    expect(result.checks.find((check) => check.id === 'dates')?.examples).toEqual([
      'Summer 2021 – Present',
      '’18 – ’21',
    ]);
  });
});

describe('a file with almost no text', () => {
  it('says so, and nothing that only follows from it, and checks no terms', () => {
    const file = fileOf([wordLine('Page 1')]);
    const result = xray(file, { posting: '## Requirements\n- SQL', facts });
    expect(result.readable).toBe(false);
    expect(result.checks.map((check) => check.id)).toEqual(['text', 'fonts', 'length']);
    expect(result.keywords).toBeNull();
    expect(result.summary.text).toBe('1 problem reading it · 1 thing to fix');
  });
});

describe('keywords against a posting', () => {
  it('sorts the posting’s terms into found, ones to add, ones to confirm, and real gaps', async () => {
    const result = xray(await read('classic.pdf'), { posting, facts });
    const terms = Object.fromEntries(
      (result.keywords?.terms ?? []).map((term) => [
        term.term,
        `${term.need} ${term.found ? (term.otherName ? `found as ${term.found}` : 'found') : term.backing.kind}`,
      ]),
    );
    expect(terms).toEqual({
      SQL: 'must found',
      'product management': 'must facts',
      experimentation: 'must found',
      pricing: 'must found',
      'product analytics': 'must facts',
      OKRs: 'must facts',
      KPIs: 'must none',
      'stakeholder management': 'must to-check',
      roadmap: 'nice found',
      retention: 'nice facts',
      'A/B testing': 'nice found',
      'data science': 'nice found',
      'email marketing': 'nice none',
      Amplitude: 'nice found',
      Figma: 'nice found',
      'user research': 'nice facts',
      Looker: 'nice said-no',
      Tableau: 'nice none',
      'mobile development': 'nice none',
      iOS: 'nice none',
    });
    expect(result.summary).toMatchObject({
      problems: 0,
      terms: { found: 8, total: 20 },
      toFix: 3,
      text: 'Reads cleanly · 8 of 20 key terms · 3 things to fix',
    });
  });

  it('counts only words a system surely reads, not a Word file’s text boxes', async () => {
    const withSkill = xray(await read('textbox.docx'), {
      posting: '## Requirements\n- Certified ScrumMaster',
    });
    expect(withSkill.keywords?.terms.map((term) => [term.term, term.found])).toEqual([
      ['Certified ScrumMaster', null],
    ]);
  });

  it('says where the fact bank backs a term to add', async () => {
    const result = xray(await read('classic.pdf'), { posting, facts });
    const okrs = result.keywords?.terms.find((term) => term.term === 'OKRs');
    expect(okrs?.backing).toEqual({
      kind: 'facts',
      where: 'northwind-stays.md · Quarterly goals for the guest team',
    });
    expect(okrs?.context).toBe('Experience writing OKRs and setting KPIs');
  });

  it('calls every missing term a real gap without a fact bank', async () => {
    const result = xray(await read('classic.pdf'), { posting });
    const missing = result.keywords?.terms.filter((term) => !term.found) ?? [];
    expect(missing.every((term) => term.backing.kind === 'none')).toBe(true);
    expect(result.summary.toFix).toBe(0);
  });

  it('checks no keywords without a posting', async () => {
    const result = xray(await read('classic.pdf'));
    expect(result.keywords).toBeNull();
    expect(result.summary.terms).toBeNull();
  });
});
