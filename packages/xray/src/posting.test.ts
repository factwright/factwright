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
