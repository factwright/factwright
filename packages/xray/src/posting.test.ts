import { describe, expect, it } from 'vitest';
import { readPosting } from './posting.ts';

const needs = (text: string) => readPosting(text).lines.map((line) => `${line.need}: ${line.text}`);

describe('readPosting', () => {
  it('reads must-haves from requirements and nice-to-haves from preferred parts', () => {
    const text = [
      '## About us',
      'We make tools for clinics.',
      '## Minimum qualifications',
      '- 5 years of Python',
      '## Preferred qualifications',
      '- Experience with FHIR',
      '## Benefits',
      '- Dental',
    ].join('\n');
    expect(needs(text)).toEqual(['must: 5 years of Python', 'nice: Experience with FHIR']);
    expect(readPosting(text).sectioned).toBe(true);
  });

  it('counts the work a posting describes as nice to have, unless a line says it’s required', () => {
    const text = [
      'What you’ll do:',
      '* Build services in Go',
      '* Keep Kafka healthy (required)',
      'What you’ll need:',
      '1. SQL',
    ].join('\n');
    expect(needs(text)).toEqual([
      'nice: Build services in Go',
      'must: Keep Kafka healthy (required)',
      'must: SQL',
    ]);
  });

  it('reads a line that says it’s a plus as nice to have, wherever it is', () => {
    expect(needs('**Requirements**\n- React\n- GraphQL is a plus')).toEqual([
      'must: React',
      'nice: GraphQL is a plus',
    ]);
  });

  it('reads each clause of a line on its own, so one preferred thing doesn’t make the rest optional', () => {
    expect(
      needs('## Requirements\n- Active RN license; BSN preferred\n- SQL. Python is preferred.'),
    ).toEqual([
      'must: Active RN license',
      'nice: BSN preferred',
      'must: SQL.',
      'nice: Python is preferred.',
    ]);
    expect(needs('## Requirements\n- B.S. Computer Science, e.g. Python')).toEqual([
      'must: B.S. Computer Science, e.g. Python',
    ]);
  });

  it('knows headings in capitals, in bold, and on their own', () => {
    expect(needs('REQUIREMENTS\n- Excel\nBonus points\n- Tableau')).toEqual([
      'must: Excel',
      'nice: Tableau',
    ]);
    expect(needs('__Nice to have__\n- Figma')).toEqual(['nice: Figma']);
  });

  it('reads a posting with no requirements part whole, as must-haves, but not its benefits', () => {
    const text =
      'We want someone with Python and SQL.\nAn AWS background is preferred.\n## Benefits\n- 401k';
    expect(needs(text)).toEqual([
      'must: We want someone with Python and SQL.',
      'nice: An AWS background is preferred.',
    ]);
    expect(readPosting(text).sectioned).toBe(false);
  });

  it('skips the lines Factwright adds when it saves a posting', () => {
    const text = [
      '# Job posting',
      '',
      '- **Source:** https://jobs.example.com/1',
      '- **Saved:** 2026-10-12 by Factwright (feed), word for word',
      '',
      '---',
      '',
      '## Requirements',
      '- SQL',
    ].join('\n');
    expect(needs(text)).toEqual(['must: SQL']);
  });

  it('leaves out what comes before the first heading once a posting has parts', () => {
    expect(needs('Join us to work with Python.\n## Requirements\n- Go')).toEqual(['must: Go']);
  });
});

describe('text made to be slow to read', () => {
  it('reads a heading line of "#" or tabs in time with its length', () => {
    for (const run of ['#'.repeat(80_000), '\t'.repeat(80_000)]) {
      const started = performance.now();
      readPosting(`# a${run}x\n- Go`);
      expect(performance.now() - started).toBeLessThan(500);
    }
  });

  it('reads a heading with closing marks, as in "## Nice to have ##"', () => {
    expect(needs('## Requirements ##\n- Go\n## Nice to have ##\n- Rust')).toEqual([
      'must: Go',
      'nice: Rust',
    ]);
  });
});

describe('readPosting’s parts', () => {
  it('reads education, license and certification parts as must-haves, under a plain heading too', () => {
    expect(
      needs(
        [
          '## Responsibilities',
          '- Care for patients',
          'Education',
          '- BS in Computer Science',
          '## Licenses and certifications',
          '- RN license',
        ].join('\n'),
      ),
    ).toEqual(['nice: Care for patients', 'must: BS in Computer Science', 'must: RN license']);
  });

  it('carries a line’s label to each of its clauses', () => {
    expect(needs('## Requirements\n- Go\n- Bonus: Kafka; Flink; Pulsar')).toEqual([
      'must: Go',
      'nice: Bonus: Kafka',
      'nice: Flink',
      'nice: Pulsar',
    ]);
  });
});
