import { readdirSync, readFileSync } from 'node:fs';
import { getDocument } from 'pdfjs-dist';
import { describe, expect, it } from 'vitest';
import type { CheckId } from './checks.ts';
import { readDocx } from './docx.ts';
import { readPdf } from './pdf.ts';
import type { ReadFile } from './read.ts';
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

    it(`finds ${file}'s sections, with the highlight cards' own heading as one systems don't know`, async () => {
      const { sections } = xray(await read(file));
      expect(sections.map((section) => section.kind)).toEqual([
        'summary',
        'skills',
        null,
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
      'stakeholder management': 'must unconfirmed',
      roadmap: 'nice found as Roadmapping',
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
