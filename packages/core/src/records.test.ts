import { describe, expect, it } from 'vitest';
import {
  readRecords,
  type ToolRecord,
  type WorkspaceEntry,
  type WorkspaceReader,
} from './records.ts';

const MODIFIED = '2026-10-07T15:00:00.000Z';

/** A workspace held in memory: file paths and their text. Folders come from the paths. */
function memoryWorkspace(files: Record<string, string>): WorkspaceReader {
  return {
    readText: (path) => (Object.hasOwn(files, path) ? (files[path] ?? null) : null),
    list(path) {
      const entries = new Map<string, WorkspaceEntry>();
      for (const [file, content] of Object.entries(files)) {
        if (!file.startsWith(`${path}/`)) continue;
        const [name = '', ...rest] = file.slice(path.length + 1).split('/');
        const folder = rest.length > 0;
        entries.set(name, { name, folder, size: folder ? 0 : content.length, modified: MODIFIED });
      }
      // Out of order on purpose: the reader sorts.
      return [...entries.values()].reverse();
    },
  };
}

const ACME = 'applications/2026-10-07-acme-staff-engineer';

const WORKSPACE = memoryWorkspace({
  'searches/fit-checks.md': [
    '| Date | Company | Role | Verdict | Score | Link | Pay | Note |',
    '|---|---|---|---|---|---|---|---|',
    '| 2026-10-07 | Acme Robotics | Staff Engineer, Developer Tools | Strong | 82 | https://jobs.ashbyhq.com/acme/7f3a | $185k–$215k | Build tooling at scale |',
    '| 2026-10-08 | Tidewater Analytics | Senior Backend Engineer | Good | n/a | — | — | — |',
    '| someday | Skipped Inc | Engineer | Good | 70 | | | |',
    '| 2026-10-09 | — | Engineer | Good | 70 | | | |',
  ].join('\n'),
  [`${ACME}/job.md`]: [
    '# Acme Robotics: Staff Engineer, Developer Tools. Remote',
    '',
    '- **Date:** 2026-10-07',
    '- **Pay:** $185k–$215k',
    '- **Apply:** Ashby https://jobs.ashbyhq.com/acme/7f3a',
    '- **Links:** Team blog https://acme.example/blog/platform',
    '- **Company site:** https://acme.example',
    '- **Work arrangement:** Remote, US',
    '- **Fit check:** Strong, 82',
    '- **Found via:** HN October 2026',
    '- **Format:** One page',
    '- **Style / track:** Platform',
  ].join('\n'),
  [`${ACME}/posting.md`]: '# Staff Engineer, Developer Tools\n\nBuild the tools our engineers use.',
  [`${ACME}/prep.md`]: '# Prep\n\n- **Date:** 2026-10-12',
  [`${ACME}/resume.pdf`]: 'pdf bytes',
  [`${ACME}/resume.docx`]: 'docx bytes',
  [`${ACME}/drafts/old.pdf`]: 'not a resume',
  'applications/no-notes-yet/posting.md': 'A folder without job.md is skipped.',
  'searches/2026-10-hn-whos-hiring/jobs.json': JSON.stringify({
    meta: {
      source: 'Hacker News · October 2026',
      checked: '2026-10-05',
      artifactUrl: 'https://example.com/report',
    },
    jobs: [
      {
        company: 'Acme Robotics',
        role: 'Staff Engineer, Developer Tools',
        posting: 'https://jobs.ashbyhq.com/acme/7f3a',
        hnId: 41000001,
        site: 'https://acme.example',
        tier: 'strong',
        score: '85',
        pay: '$185k-$215k',
        remote: 'Remote (US)',
        why: ['Build tooling'],
        gaps: 'No Rust',
        flags: [3, 'Slow promotions'],
        pick: 'Best match this month',
        parts: { work: 34, role: '20', stack: 'lots', reqs: 15 },
        partsWhy: { work: 'Tooling at scale' },
        tags: [{ label: 'Remote' }, { name: 'no label' }, 'Go'],
        apply: 'Apply on Ashby',
      },
      { company: 'Weird Co', role: 'Engineer', tier: 'constructor' },
      'not a job',
    ],
    longShots: [
      { company: 'Lumen Health', role: 'Senior Full-Stack Engineer', note: 'Java backend' },
    ],
  }),
  'searches/2026-09-broken/jobs.json': '{ not json',
  'searches/criteria.md': '# Criteria',
  'searches/salary-checks.md': [
    '| Date | Company | Role | Estimate | Confidence | Link |',
    '|---|---|---|---|---|---|',
    '| 2026-10-09 | Copperleaf Energy | Principal Engineer | $190k–$230k | Medium | |',
  ].join('\n'),
  'searches/unmask-checks.md': [
    '| Date | Listing | Employer | Role | Apply | Link |',
    '|---|---|---|---|---|---|',
    '| 2026-10-06 | Bluewave Staffing | Tidewater Analytics | Senior Backend Engineer | Their careers page | https://dice.example/job/123 |',
  ].join('\n'),
  'outreach/2026-10-10-acme-robotics.md': 'Drafts',
  'outreach/2026-10-10-ibm.md': 'Drafts',
  'outreach/notes.md': 'Not dated, so skipped.',
});

const of = <T extends ToolRecord['tool']>(records: ToolRecord[], tool: T) =>
  records.filter((record): record is Extract<ToolRecord, { tool: T }> => record.tool === tool);

describe('readRecords', () => {
  const records = readRecords(WORKSPACE);

  it('reads every kind of record, in a fixed order', () => {
    expect(records.map((record) => `${record.tool} ${record.company}`)).toEqual([
      'fit-check Acme Robotics',
      'fit-check Tidewater Analytics',
      'folder Acme Robotics',
      'prep Acme Robotics',
      'search Acme Robotics',
      'search Weird Co',
      'search Lumen Health',
      'salary Copperleaf Energy',
      'unmask Tidewater Analytics',
      'outreach Acme Robotics',
      'outreach IBM',
    ]);
  });

  it('reads the fit check log, skipping rows without a date or company', () => {
    expect(of(records, 'fit-check')).toEqual([
      {
        tool: 'fit-check',
        key: '2026-10-07:acme-robotics:staff-engineer-developer-tools',
        date: '2026-10-07',
        company: 'Acme Robotics',
        role: 'Staff Engineer, Developer Tools',
        links: [{ url: 'https://jobs.ashbyhq.com/acme/7f3a', label: 'Posting' }],
        verdict: 'Strong',
        score: 82,
        pay: '$185k–$215k',
        note: 'Build tooling at scale',
      },
      expect.objectContaining({ score: null, links: [], pay: null, note: null }),
    ]);
  });

  it('reads a job’s folder: its notes, documents and resumes', () => {
    const [folder] = of(records, 'folder');
    expect(folder).toMatchObject({
      key: '2026-10-07-acme-staff-engineer',
      folder: '2026-10-07-acme-staff-engineer',
      date: '2026-10-07',
      company: 'Acme Robotics',
      role: 'Staff Engineer, Developer Tools',
      pay: '$185k–$215k',
      location: 'Remote, US',
      fit: 'Strong, 82',
      foundVia: 'HN October 2026',
      format: 'One page',
      style: 'Platform',
      links: [
        { url: 'https://jobs.ashbyhq.com/acme/7f3a', label: 'Ashby' },
        { url: 'https://acme.example/blog/platform', label: 'Team blog' },
        { url: 'https://acme.example', label: 'Company site' },
      ],
    });
    expect(Object.keys(folder?.docs ?? {})).toEqual(['posting', 'job', 'prep']);
    expect(folder?.files).toEqual([
      {
        path: `${ACME}/resume.docx`,
        name: 'resume.docx',
        format: 'docx',
        size: 10,
        modified: MODIFIED,
      },
      {
        path: `${ACME}/resume.pdf`,
        name: 'resume.pdf',
        format: 'pdf',
        size: 9,
        modified: MODIFIED,
      },
    ]);
    expect(of(records, 'prep')[0]?.date).toBe('2026-10-12');
  });

  it('keeps a job’s cover letter apart from its resumes, and reads the letter’s data', () => {
    const letter = '{"greeting":"Dear Sam,","paragraphs":["Hello."]}';
    const [folder] = of(
      readRecords(
        memoryWorkspace({
          [`${ACME}/job.md`]: '# Acme Robotics: Staff Engineer',
          [`${ACME}/AlexRiveraResume10072026_Acme.pdf`]: 'pdf',
          [`${ACME}/AlexRiveraCoverLetter10142026_Acme.pdf`]: 'pdf',
          [`${ACME}/AlexRiveraCoverLetter10142026_Acme.docx`]: 'docx',
          [`${ACME}/Acme cover letter.pdf`]: 'pdf',
          [`${ACME}/cover-letter.json`]: letter,
        }),
      ),
      'folder',
    );
    expect(folder?.files.map((file) => file.name)).toEqual(['AlexRiveraResume10072026_Acme.pdf']);
    expect(folder?.letters.map((file) => file.name)).toEqual([
      'Acme cover letter.pdf',
      'AlexRiveraCoverLetter10142026_Acme.docx',
      'AlexRiveraCoverLetter10142026_Acme.pdf',
    ]);
    expect(folder?.docs.letter).toBe(letter);
  });

  it('reads job searches, checking each value’s type', () => {
    const [acme, weird, lumen] = of(records, 'search');
    expect(acme).toMatchObject({
      key: '2026-10-hn-whos-hiring:acme-robotics:staff-engineer-developer-tools',
      date: '2026-10-05',
      source: 'HN October 2026',
      tier: 'strong',
      score: 85,
      location: 'Remote (US)',
      links: [
        { url: 'https://jobs.ashbyhq.com/acme/7f3a', label: 'Posting' },
        { url: 'https://news.ycombinator.com/item?id=41000001', label: 'HN post' },
        { url: 'https://acme.example', label: 'Company site' },
      ],
    });
    expect(acme?.detail).toEqual({
      why: ['Build tooling'],
      gaps: ['No Rust'],
      flags: ['Slow promotions'],
      pick: 'Best match this month',
      what: null,
      stage: null,
      apply: 'Apply on Ashby',
      note: null,
      parts: { work: 34, role: 20, reqs: 15 },
      partsWhy: { work: 'Tooling at scale' },
      tags: ['Remote'],
      report: 'https://example.com/report',
    });
    expect(weird?.tier).toBeNull();
    expect(lumen).toMatchObject({ tier: 'long', score: null, location: null });
    expect(lumen?.detail.note).toBe('Java backend');
  });

  it('reads the salary and employer checks', () => {
    expect(of(records, 'salary')[0]).toMatchObject({
      company: 'Copperleaf Energy',
      estimate: '$190k–$230k',
      confidence: 'Medium',
      links: [],
    });
    expect(of(records, 'unmask')[0]).toMatchObject({
      company: 'Tidewater Analytics',
      listing: 'Bluewave Staffing',
      apply: 'Their careers page',
      links: [{ url: 'https://dice.example/job/123', label: 'Posting' }],
    });
  });

  it('reads drafted messages by file name only', () => {
    expect(of(records, 'outreach')).toEqual([
      {
        tool: 'outreach',
        key: '2026-10-10-acme-robotics.md',
        date: '2026-10-10',
        company: 'Acme Robotics',
        companySlug: 'acme-robotics',
        role: '',
        links: [],
      },
      expect.objectContaining({ company: 'IBM', companySlug: 'ibm' }),
    ]);
  });

  it('reads an empty workspace as no records', () => {
    expect(readRecords(memoryWorkspace({}))).toEqual([]);
  });

  it('names an HN search by its month, however the search wrote it', () => {
    const sourceOf = (source: string) => {
      const [record] = of(
        readRecords(
          memoryWorkspace({
            'searches/2026-10-hn-whos-hiring/jobs.json': JSON.stringify({
              meta: { source },
              jobs: [{ company: 'Acme Robotics', role: 'Staff Engineer' }],
            }),
          }),
        ),
        'search',
      );
      return record?.source;
    };
    expect(sourceOf('Hacker News · Who is hiring? (October 2026)')).toBe('HN October 2026');
    expect(sourceOf('HN November 2026')).toBe('HN November 2026');
    expect(sourceOf('LinkedIn Oct 12')).toBe('LinkedIn Oct 12');
  });

  it('reads each run of a search in its folder, and the job find_job named for each job', () => {
    const records = of(
      readRecords(
        memoryWorkspace({
          'searches/2026-11-03-linkedin/jobs.json': JSON.stringify({
            meta: { source: 'LinkedIn Nov 3', checked: '2026-11-03' },
            jobs: [{ company: 'Acme Robotics', role: 'Staff Engineer' }],
          }),
          // The next run the same day, as the job search writes it beside the first.
          'searches/2026-11-03-linkedin/jobs-2.json': JSON.stringify({
            meta: { source: 'LinkedIn Nov 3', checked: '2026-11-03' },
            jobs: [
              {
                company: 'Acme Robotics',
                role: 'Staff Engineer',
                job: 'Acme-Robotics--Staff-Engineer',
              },
              { company: 'Lumen Health', role: 'Engineer', job: '../not an id' },
            ],
            longShots: [{ company: 'Fernway', role: 'Engineer', job: 'fernway--engineer' }],
          }),
          'searches/2026-11-03-linkedin/jobs-10.json': JSON.stringify({
            jobs: [{ company: 'Northwind Labs', role: 'Engineer' }],
          }),
          'searches/2026-11-03-linkedin/jobs-old.json': JSON.stringify({
            jobs: [{ company: 'Skipped Inc', role: 'Engineer' }],
          }),
        }),
      ),
      'search',
    );
    expect(records.map(({ key, run, job }) => [key, run, job])).toEqual([
      ['2026-11-03-linkedin:acme-robotics:staff-engineer', 1, null],
      ['2026-11-03-linkedin#2:acme-robotics:staff-engineer', 2, 'acme-robotics--staff-engineer'],
      ['2026-11-03-linkedin#2:lumen-health:engineer', 2, null],
      ['2026-11-03-linkedin#2:fernway:engineer', 2, 'fernway--engineer'],
      ['2026-11-03-linkedin#10:northwind-labs:engineer', 10, null],
    ]);
  });

  it('names a focused search from the focus the app kept for it', () => {
    const focus = {
      stages: ['early'],
      payMin: 150_000,
      payMax: 200_000,
      workplaces: ['remote'],
      industries: [],
      avoid: [],
      posted: 0,
      notes: 'Founding roles.',
    };
    const sourceOf = (meta: Record<string, unknown>, files: Record<string, string> = {}) =>
      of(
        readRecords(
          memoryWorkspace({
            'searches/focus/2026-10-20-a3f9.json': JSON.stringify(focus),
            'searches/2026-10-20-linkedin-focus-a3f9/jobs.json': JSON.stringify({
              meta: { source: 'LinkedIn Oct 20', ...meta },
              jobs: [{ company: 'Acme Robotics', role: 'Staff Engineer' }],
            }),
            ...files,
          }),
        ),
        'search',
      )[0]?.source;
    expect(sourceOf({ focus: '2026-10-20-a3f9' })).toBe(
      'LinkedIn Oct 20 · early startups, $150k–$200k, remote',
    );
    // Named so already, or with a focus that's gone or doesn't read, it's left as it is.
    expect(
      sourceOf({
        focus: '2026-10-20-a3f9',
        source: 'LinkedIn Oct 20 · early startups, $150k–$200k, remote',
      }),
    ).toBe('LinkedIn Oct 20 · early startups, $150k–$200k, remote');
    expect(sourceOf({ focus: '2026-10-20-b4e0' })).toBe('LinkedIn Oct 20');
    expect(sourceOf({ focus: '../criteria' })).toBe('LinkedIn Oct 20');
    expect(
      sourceOf({ focus: '2026-10-20-a3f9' }, { 'searches/focus/2026-10-20-a3f9.json': '{ broken' }),
    ).toBe('LinkedIn Oct 20');
  });

  it('reads the kind of job a search or fit check gave each job', () => {
    const records = readRecords(
      memoryWorkspace({
        'searches/2026-11-03-linkedin/jobs.json': JSON.stringify({
          meta: { source: 'LinkedIn Nov 3', kind: 'project-manager' },
          jobs: [
            { company: 'Acme Robotics', role: 'Technical Program Manager' },
            { company: 'Fernway', role: 'Staff Engineer', kind: 'developer' },
          ],
        }),
        'searches/2026-11-hn-whos-hiring/jobs.json': JSON.stringify({
          meta: { source: 'HN November 2026' },
          jobs: [{ company: 'Northwind Labs', role: 'Engineer' }],
        }),
        [`${ACME}/job.md`]:
          '# Acme Robotics: Program Manager\n\n- **Kind of job:** project-manager',
      }),
    );
    expect(of(records, 'search').map((record) => [record.company, record.kind])).toEqual([
      ['Acme Robotics', 'project-manager'],
      ['Fernway', 'developer'],
      ['Northwind Labs', null],
    ]);
    expect(of(records, 'folder')[0]?.kind).toBe('project-manager');
    expect(of(readRecords(WORKSPACE), 'folder')[0]?.kind).toBeNull();
  });
});
