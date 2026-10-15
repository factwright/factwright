import { describe, expect, it } from 'vitest';
import { FINDING_ID, findingsOf, outcomesOf } from './findings.ts';
import { fileOf, wordLine } from './testing.ts';
import { xray } from './xray.ts';

const heading = (text: string) => wordLine(text, { look: 'heading', size: 12 });

/** A resume with a date parsers miss, letter-spaced headings, and no Skills section. */
const resume = fileOf([
  wordLine('Jordan Avery'),
  wordLine('jordan@example.com | (555) 014-2387 | Denver, CO'),
  heading('S U M M A R Y'),
  wordLine('Product manager with eight years in marketplaces, and a long enough summary to read.'),
  heading('Experience'),
  wordLine('Senior Product Manager\tSpring 2021 – Present'),
  wordLine('Northwind Stays · Built pricing experiments in SQL'),
  heading('Education'),
  wordLine('B.S., Economics\t2016'),
]);

const posting = [
  '## Requirements',
  '- SQL and Tableau',
  '- Kubernetes',
  '- C++ and C#',
  '## Nice to have',
  '- Rust',
].join('\n');

const facts = [
  { path: 'facts/skills.md', text: '- Tableau\n- Kubernetes: used it once\n- C#' },
  { path: 'facts/gaps.md', text: '## Doesn’t have\n- Rust' },
];

describe('findingsOf', () => {
  it('lists what a revision could fix, each by its kind, with what it can fix ticked', () => {
    const findings = findingsOf(xray(resume, { posting, facts }));
    expect(findings.map(({ id, kind, ticked }) => [id, kind, ticked])).toEqual([
      ['check-spaced', 'template', false],
      ['check-dates', 'content', true],
      ['check-headings', 'content', false],
      ['term-tableau', 'content', true],
      ['term-kubernetes', 'question', false],
      ['term-c', 'question', false],
      ['term-c-2', 'content', true],
    ]);
    for (const { id } of findings) expect(id).toMatch(FINDING_ID);
  });

  it('says what each one is, as data for the run, and leaves out what the user said they don’t have', () => {
    const findings = findingsOf(xray(resume, { posting, facts }));
    const byId = Object.fromEntries(findings.map((finding) => [finding.id, finding]));
    expect(byId['term-tableau']).toMatchObject({
      title: 'Add “Tableau”',
      about:
        '“Tableau”, a must-have the posting asks for, isn’t on the resume. The fact bank backs it: skills.md. From the posting: “SQL and Tableau”.',
    });
    expect(byId['term-kubernetes']?.title).toBe('Check “Kubernetes”');
    expect(byId['term-kubernetes']?.about).toContain('skills.md says “Kubernetes: used it once”');
    expect(byId['term-c']?.about).toContain('a real gap');
    expect(byId['check-dates']?.about).toMatch(/^Dates: .+\./);
    // Rust is settled: the user said they don't have it.
    expect(findings.some(({ id }) => id === 'term-rust')).toBe(false);
  });

  it('finds nothing to revise in a file with no text', () => {
    expect(findingsOf(xray(fileOf([wordLine('Page 1')]), { posting, facts }))).toEqual([]);
  });
});

/** The resume once revised: dates parsers read, Tableau and C# added, the headings as before. */
const revised = fileOf([
  wordLine('Jordan Avery'),
  wordLine('jordan@example.com | (555) 014-2387 | Denver, CO'),
  heading('S U M M A R Y'),
  wordLine('Product manager with eight years in marketplaces, and a long enough summary to read.'),
  heading('Experience'),
  wordLine('Senior Product Manager\tMar 2021 – Present'),
  wordLine('Northwind Stays · Built pricing experiments in SQL and Tableau'),
  heading('Skills'),
  wordLine('C#'),
  heading('Education'),
  wordLine('B.S., Economics\t2016'),
]);

describe('outcomesOf', () => {
  it('keeps a term’s ID as the resume changes, whichever of two alike terms it has', () => {
    const before = findingsOf(xray(resume, { posting, facts }));
    const after = findingsOf(xray(revised, { posting, facts }));
    // C++ is still missing, and keeps its ID now that C# is on the resume.
    expect(before.find(({ id }) => id === 'term-c')?.title).toBe('Ask about “C++”');
    expect(after.find(({ id }) => id === 'term-c')?.title).toBe('Ask about “C++”');
    expect(after.some(({ id }) => id === 'term-c-2')).toBe(false);
  });

  it('says what became of each finding picked before: fixed, settled as a gap, or open', () => {
    // The user said they don't have Kubernetes, in the revision's questions.
    const answered = [
      ...facts.slice(0, 1),
      { path: 'facts/gaps.md', text: '## Doesn’t have\n- Rust\n- Kubernetes' },
    ];
    const picked = ['check-dates', 'term-tableau', 'term-kubernetes', 'term-c', 'term-c-2'];
    const outcomes = outcomesOf(xray(revised, { posting, facts: answered }), picked);
    expect(Object.fromEntries(outcomes)).toEqual({
      'check-dates': 'fixed',
      'term-tableau': 'fixed',
      'term-kubernetes': 'said-no',
      'term-c': 'open',
      'term-c-2': 'fixed',
    });
  });

  it('fixes nothing in a file with no text', () => {
    const outcomes = outcomesOf(xray(fileOf([wordLine('Page 1')]), { posting, facts }), [
      'check-dates',
    ]);
    expect(outcomes.get('check-dates')).toBe('open');
  });
});
