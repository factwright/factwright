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

  it('settles a term the user said they don’t have, whatever else backs it', () => {
    const facts = readFacts([
      { path: 'facts/gaps.md', text: '## Doesn’t have\n- Kubernetes in production' },
      { path: 'facts/skills.md', text: '- Kubernetes' },
      {
        path: 'facts/acme.md',
        text: '### Ran clusters\n`unconfirmed` `live` `solo` `high`\n- **Keywords:** Docker, Kubernetes',
      },
    ]);
    const [kubernetes] = matchKeywords(posting(['Kubernetes']), 'Nothing.', facts).terms;
    expect(kubernetes?.backing).toEqual({ kind: 'said-no', where: 'Kubernetes in production' });
  });

  it('asks for a check first when gaps.md says a term needs confirming, or only a claim to check has it', () => {
    const facts = readFacts([
      { path: 'facts/gaps.md', text: '## Needs confirmation\n- Terraform: whose modules?' },
      { path: 'facts/skills.md', text: '- Terraform' },
      {
        path: 'facts/acme.md',
        text: [
          '### Logs',
          '`shipped` `solo` `low`',
          '- **Keywords:** Splunk',
          '### Plans',
          '`plan-only` `solo` `high`',
          '- **Keywords:** Snowflake',
        ].join('\n'),
      },
    ]);
    const report = matchKeywords(posting(['Terraform, Splunk and Snowflake']), 'Nothing.', facts);
    expect(report.terms.map((term) => [term.term, term.backing.kind])).toEqual([
      ['Terraform', 'doubted'],
      ['Splunk', 'to-check'],
      ['Snowflake', 'none'],
    ]);
  });

  it('backs a credential only with what profile.md says the user has earned', () => {
    const facts = readFacts([
      { path: 'facts/skills.md', text: '- CSM tooling\n- PMP prep' },
      {
        path: 'facts/acme.md',
        text: '### Ran sprints\n`live` `solo` `high`\n- **Keywords:** Scrum Master, CS operations',
      },
      {
        path: 'facts/profile.md',
        text: '## Certifications\n- PMP: studying, exam booked 2027-01\n- Certified ScrumMaster, 2021',
      },
    ]);
    const report = matchKeywords(
      posting(['Certified ScrumMaster', 'PMP', 'Computer Science degree']),
      'Nothing.',
      facts,
    );
    expect(report.terms.map((term) => [term.term, term.backing.kind])).toEqual([
      ['Certified ScrumMaster', 'facts'],
      ['PMP', 'none'],
      ['Computer Science', 'none'],
    ]);
  });

  it('never lets another sense of a word back a term', () => {
    const facts = readFacts([
      {
        path: 'facts/skills.md',
        text: [
          '- PRs reviewed weekly',
          '- GTM (Google Tag Manager)',
          '- QGIS',
          '- GitLab',
          '- Accessibility audit',
          '- Go-to-market',
          '- Python: daily, but never used Django',
        ].join('\n'),
      },
    ]);
    const asked = [
      'Public relations',
      'Go-to-market',
      'ArcGIS',
      'GitLab CI',
      'Auditing',
      'Go',
      'Django',
    ];
    const report = matchKeywords(posting(asked), 'Nothing.', facts);
    expect(report.terms.map((term) => [term.term, term.backing.kind])).toEqual([
      ['Public relations', 'none'],
      ['Go-to-market', 'facts'],
      ['ArcGIS', 'none'],
      ['GitLab CI', 'none'],
      ['Auditing', 'none'],
      ['Go', 'none'],
      ['Django', 'none'],
    ]);
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

  it('leaves places, regions and business numbers out of the terms', () => {
    const report = matchKeywords(
      posting([
        'Based in Austin, TX, covering EMEA and APAC',
        'Owns ROI, CAC and LTV',
        'Go-live support',
      ]),
      '',
      null,
    );
    expect(report.terms).toEqual([]);
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

describe('text made to be slow to read', () => {
  it('reads a Keywords line of open brackets in time with its length', () => {
    const facts = readFacts([
      {
        path: 'facts/acme.md',
        text: `### A\n\`live\` \`solo\` \`high\`\n- **Keywords:** ${'('.repeat(80_000)}`,
      },
    ]);
    const started = performance.now();
    matchKeywords(posting(['Go']), 'Go', facts);
    expect(performance.now() - started).toBeLessThan(500);
  });
});
