import { describe, expect, it } from 'vitest';
import { jobNotesSentiment, parseFitReport, parseVerdict } from './fit-report.ts';

/** How long something takes, in milliseconds. */
function timed(work: () => unknown): number {
  const start = Date.now();
  work();
  return Date.now() - start;
}

const REPORT = `# Fit check: Acme Robotics, Staff Engineer

- **Date:** 2026-10-07
- **Verdict:** Strong, 82 · work 33/40 · role 20/25 · stack 14/20 · reqs 15/15
- **Filters:** Pass. Remote in the US, and pay clears the floor.
  - Remote: yes
  - Pay: $185k–$215k

## Score
- **Work 33/40:** build and CI tooling for hundreds of engineers
  - ✓ Build-system rewrite: cut CI time by 60%, live
  - ~ Developer portal: partly, a smaller internal version
  - ✗ Rust services
- **Role shape 20/25:** staff scope on a platform team
- **Stack 14/20** - Go and TypeScript match; Rust would be new
- **Reqs 15/15:** every must-have is covered

## Why it fits
- Eight years of platform work
- Led the build-system rewrite

## Gaps
- No Rust in production

## Watch for
- Promotions are said to be slow

## Company sentiment (2026-10-09)
- **Overall:** Liked. Engineers praise the tooling budget.
- A few say promotions are slow.
`;

describe('parseFitReport', () => {
  it('reads the verdict, the score parts and the evidence', () => {
    const report = parseFitReport(REPORT);
    expect(report).toMatchObject({ date: '2026-10-07', verdict: 'Strong', total: 82 });
    expect(report?.parts).toEqual([
      {
        key: 'work',
        points: 33,
        max: 40,
        why: 'Build and CI tooling for hundreds of engineers',
        items: [
          { mark: 'yes', text: 'Build-system rewrite: cut CI time by 60%, live' },
          { mark: 'part', text: 'Developer portal: partly, a smaller internal version' },
          { mark: 'no', text: 'Rust services' },
        ],
      },
      { key: 'role', points: 20, max: 25, why: 'Staff scope on a platform team', items: [] },
      {
        key: 'stack',
        points: 14,
        max: 20,
        why: 'Go and TypeScript match; Rust would be new',
        items: [],
      },
      { key: 'reqs', points: 15, max: 15, why: 'Every must-have is covered', items: [] },
    ]);
  });

  it('reads the filters and the lists', () => {
    const report = parseFitReport(REPORT);
    expect(report?.filters).toEqual({
      pass: true,
      text: 'Pass. Remote in the US, and pay clears the floor.',
      details: ['Remote: yes', 'Pay: $185k–$215k'],
    });
    expect(report?.why.map((item) => item.text)).toEqual([
      'Eight years of platform work',
      'Led the build-system rewrite',
    ]);
    expect(report?.gaps.map((item) => item.text)).toEqual(['No Rust in production']);
    expect(report?.flags.map((item) => item.text)).toEqual(['Promotions are said to be slow']);
  });

  it('reads what people say, dated by its heading', () => {
    expect(parseFitReport(REPORT)?.sentiment).toEqual({
      date: '2026-10-09',
      from: 'fit-check',
      mood: 'liked',
      summary: 'Engineers praise the tooling budget.',
      points: [{ text: 'A few say promotions are slow.', sub: [] }],
    });
  });

  it('takes the parts from the verdict line when there is no score section', () => {
    const report = parseFitReport('- **Verdict:** Good, 70 · work 28/40 · stack 12/20');
    expect(report?.parts?.map((part) => [part.key, part.points, part.max, part.why])).toEqual([
      ['work', 28, 40, null],
      ['stack', 12, 20, null],
    ]);
  });

  it('reads an older write-up that leads with its mood', () => {
    const report = parseFitReport('## Company sentiment\n- Thin data: only two reviews.');
    expect(report?.sentiment).toMatchObject({ mood: 'thin', summary: 'Only two reviews.' });
  });

  it('notes failed filters', () => {
    const report = parseFitReport('- **Filters:** Fail: onsite five days a week.');
    expect(report?.filters?.pass).toBe(false);
  });

  it('returns nulls and empty lists for a bare write-up', () => {
    expect(parseFitReport('Just notes.')).toEqual({
      date: null,
      verdict: null,
      total: null,
      parts: null,
      filters: null,
      why: [],
      gaps: [],
      ask: [],
      flags: [],
      sentiment: null,
    });
    expect(parseFitReport(null)).toBeNull();
  });

  it('reads what’s worth asking the user, for the tailored resume to ask', () => {
    const report = parseFitReport(
      [
        '## Gaps',
        '- No Kafka on file',
        '## Worth asking you',
        '- Kafka (must-have): your facts show RabbitMQ at Beacon. Have you run Kafka?',
        '## Flags',
      ].join('\n'),
    );
    expect(report?.ask).toEqual([
      {
        text: 'Kafka (must-have): your facts show RabbitMQ at Beacon. Have you run Kafka?',
        sub: [],
      },
    ]);
    expect(report?.gaps.map((item) => item.text)).toEqual(['No Kafka on file']);
  });
});

describe('parseVerdict', () => {
  it('reads "Verdict, score"', () => {
    expect(parseVerdict('Worth a look, 58 (on 2026-10-01)')).toEqual({
      verdict: 'Worth a look',
      score: 58,
    });
    expect(parseVerdict('Not checked yet')).toBeNull();
  });
});

describe('jobNotesSentiment', () => {
  it('reads the one-line sentiment older job notes carry', () => {
    const notes = '- **Sentiment (fit check, 2026-10-06):** Mixed — good pay, long hours.';
    expect(jobNotesSentiment(notes)).toEqual({
      date: '2026-10-06',
      from: 'job-notes',
      mood: 'mixed',
      summary: 'Good pay, long hours.',
      points: [],
    });
    expect(jobNotesSentiment('# No sentiment here')).toBeNull();
  });
});

describe('a write-up made to keep the app busy', () => {
  it('reads a verdict, its score parts, and an old sentiment line, in a moment', () => {
    expect(timed(() => parseVerdict(`A${' '.repeat(80_000)}`))).toBeLessThan(1000);
    expect(timed(() => parseFitReport(`- **Verdict:** work${' '.repeat(100_000)}x`))).toBeLessThan(
      1000,
    );
    // A line break no pattern's "." crosses kept the old score pattern trying every way to split
    // the spaces before it.
    expect(
      timed(() => parseFitReport(`## Score\n- work 1/2${' '.repeat(3_000)}z\n  more\u2028x`)),
    ).toBeLessThan(1000);
    // Each "(" left open made the old pattern read to the end of the notes again.
    expect(
      timed(() => jobNotesSentiment('- **Sentiment (left open\n'.repeat(20_000))),
    ).toBeLessThan(1000);
  });

  it('reads 100,000 spaces in a score line in well under 100 ms', () => {
    // Before #69, 4,000 of them took 14 seconds, and the time grew with their number cubed.
    expect(
      timed(() => parseFitReport(`## Score\n- work 1/2${' '.repeat(100_000)}z\n  more\u2028x`)),
    ).toBeLessThan(100);
    expect(timed(() => parseFitReport(`- **Verdict:** work${' '.repeat(100_000)}x`))).toBeLessThan(
      100,
    );
  });

  it('reads them as before', () => {
    expect(parseVerdict('Very strong , 90')).toEqual({ verdict: 'Very strong', score: 90 });
    expect(jobNotesSentiment('- **Sentiment (fit check,\n2026-10-06):** Positive')).toMatchObject({
      date: '2026-10-06',
      summary: 'Positive',
    });
  });

  it('finds no sentiment in a line with nothing after it', () => {
    expect(jobNotesSentiment('- **Sentiment:**   ')).toBeNull();
  });
});
