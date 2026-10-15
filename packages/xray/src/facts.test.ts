import { describe, expect, it } from 'vitest';
import { readFacts } from './facts.ts';

describe('readFacts', () => {
  it('reads skills from a table, past its header row, and from a list', () => {
    const facts = readFacts([
      {
        path: 'facts/skills.md',
        text: [
          '# Skills',
          '',
          '| Skill | Depth | Proven in |',
          '|---|---|---|',
          '| **Go** | Daily | acme.md |',
          '| Kubernetes (EKS) | 4 years | acme.md |',
          '',
          '## Tools',
          '- Terraform',
        ].join('\n'),
      },
    ]);
    expect(facts.skills).toEqual(['Go', 'Kubernetes (EKS)', 'Terraform']);
  });

  it('reads each claim’s Keywords line, with its claim and whether it’s confirmed', () => {
    const facts = readFacts([
      {
        path: 'facts/acme.md',
        text: [
          '# Acme',
          '### Cut deploy time',
          '`live` `solo` `high`',
          '> Cut deploy time by 40%.',
          '- **Keywords:** CI/CD, platform engineering',
          '### Ran the on-call rotation',
          '`unconfirmed` `live` `led-team` `medium`',
          '- **Keywords:** incident management',
        ].join('\n'),
      },
    ]);
    expect(facts.keywords).toEqual([
      {
        text: 'CI/CD, platform engineering',
        where: 'acme.md · Cut deploy time',
        unconfirmed: false,
      },
      {
        text: 'incident management',
        where: 'acme.md · Ran the on-call rotation',
        unconfirmed: true,
      },
    ]);
  });

  it('reads what gaps.md says the user doesn’t have, and nothing from its other parts', () => {
    const facts = readFacts([
      {
        path: 'facts/gaps.md',
        text: [
          '# Gaps',
          '## Doesn’t have',
          '| Topic | Their answer | Date |',
          '|---|---|---|',
          '| Rust in production | No | 2026-10-12 |',
          '- Kafka',
          '## Open questions',
          '- How many users?',
        ].join('\n'),
      },
    ]);
    expect(facts.saidNo).toEqual(['Rust in production', 'Kafka']);
    expect(facts.keywords).toEqual([]);
  });

  it('reads degrees and certifications from profile.md, but not its other parts', () => {
    const facts = readFacts([
      {
        path: 'facts/profile.md',
        text: '# Profile\n## Contact\n- a@example.com\n## Certifications\n- PMP, 2022\n## Education\n- MBA',
      },
    ]);
    expect(facts.credentials).toEqual(['- PMP, 2022', '- MBA']);
  });

  it('skips the bank’s README', () => {
    const facts = readFacts([
      { path: 'facts/README.md', text: '- **Keywords:** the terms a claim proves' },
    ]);
    expect(facts.keywords).toEqual([]);
  });
});
