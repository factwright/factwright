import { describe, expect, it } from 'vitest';
import { readFacts } from './facts.ts';
import { matchKeywords } from './keywords.ts';

const posting = (lines: string[]) =>
  `## Requirements\n${lines.map((line) => `- ${line}`).join('\n')}`;

describe('matchKeywords', () => {
  it('finds terms by another name, and says so', () => {
    const report = matchKeywords(
      posting(['PostgreSQL and Kubernetes']),
      'Ran Postgres on Kubernetes.',
      null,
    );
    expect(report.terms.map(({ term, found, otherName }) => [term, found, otherName])).toEqual([
      ['PostgreSQL', 'Postgres', true],
      ['Kubernetes', 'Kubernetes', false],
    ]);
  });

  it('takes another form of the same word as the posting’s own', () => {
    const report = matchKeywords(
      posting(['Mentor engineers', 'Own the roadmap']),
      'Mentoring. Roadmapping.',
      null,
    );
    expect(report.terms.map(({ term, otherName }) => [term, otherName])).toEqual([
      ['Mentor', false],
      ['roadmap', false],
    ]);
  });

  it('backs a missing term with a confirmed claim before an unconfirmed one', () => {
    const facts = readFacts([
      {
        path: 'facts/acme.md',
        text: [
          '### Drafted from a resume',
          '`unconfirmed` `live` `solo` `high`',
          '- **Keywords:** Terraform',
          '### Confirmed',
          '`live` `solo` `high`',
          '- **Keywords:** Terraform, Ansible',
        ].join('\n'),
      },
    ]);
    const [terraform] = matchKeywords(posting(['Terraform']), 'Nothing.', facts).terms;
    expect(terraform?.backing).toEqual({ kind: 'facts', where: 'acme.md · Confirmed' });
  });

  it('says when the user told Factwright they don’t have a term', () => {
    const facts = readFacts([
      { path: 'facts/gaps.md', text: '## Doesn’t have\n- Rust in production' },
    ]);
    const [rust] = matchKeywords(posting(['Rust']), 'Nothing.', facts).terms;
    expect(rust?.backing).toEqual({ kind: 'said-no', where: 'Rust in production' });
  });

  it('finds the user’s own terms in a posting, from their skills and Keywords lines', () => {
    const facts = readFacts([{ path: 'facts/skills.md', text: '- Temporal workflows\n- Go' }]);
    const report = matchKeywords(
      posting(['Temporal workflows at scale', 'Go and gRPC']),
      'Nothing.',
      facts,
    );
    expect(report.terms.map((term) => [term.term, term.backing.kind])).toEqual([
      ['Temporal workflows', 'facts'],
      ['Go', 'facts'],
      ['gRPC', 'none'],
    ]);
  });

  it('finds tools by their look, but not acronyms that aren’t skills', () => {
    const report = matchKeywords(
      posting(['Experience with Hasura and tRPC in a US-based HQ, FHIR a plus']),
      '',
      null,
    );
    expect(report.terms.map((term) => term.term)).toEqual(['FHIR']);
  });

  it('makes a term a must-have when any line asks for it', () => {
    const text = '## What you’ll do\n- Build in Go\n## Requirements\n- Go';
    expect(matchKeywords(text, '', null).terms).toEqual([
      expect.objectContaining({ term: 'Go', need: 'must' }),
    ]);
  });

  it('lists must-haves first, and at most forty terms', () => {
    const many = Array.from({ length: 60 }, (_, i) => `ToolKit${i}`);
    const text = `## Nice to have\n- SQL\n## Requirements\n${many.map((tool) => `- ${tool}`).join('\n')}`;
    const report = matchKeywords(text, '', null);
    expect(report.terms).toHaveLength(40);
    expect(report.terms[0]?.need).toBe('must');
  });
});
