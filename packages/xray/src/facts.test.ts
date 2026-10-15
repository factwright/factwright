import { describe, expect, it } from 'vitest';
import { readFacts } from './facts.ts';

const texts = (sources: readonly { text: string }[]) => sources.map((source) => source.text);

describe('readFacts', () => {
  it('reads skills from a table, past its header row, and by name from a list', () => {
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
          '| Rust | Learning | — |',
          '',
          '## Tools',
          '- Terraform',
          '- Python: daily, but never used Django',
          '- Elixir — learning it now',
        ].join('\n'),
      },
    ]);
    expect(texts(facts.skills)).toEqual(['Go', 'Kubernetes (EKS)', 'Terraform', 'Python']);
    expect(facts.skills[0]?.where).toBe('skills.md');
  });

  it('leaves out a part about skills to come, and anything in a code block', () => {
    const facts = readFacts([
      {
        path: 'facts/skills.md',
        text: ['## Tools', '- SQL', '```', '- Haskell', '```', '## Want to learn', '- Rust'].join(
          '\n',
        ),
      },
    ]);
    expect(texts(facts.skills)).toEqual(['SQL']);
  });

  it('reads a claim’s Keywords line, by whether the claim can go on a resume', () => {
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
          '### Moved logs to one place',
          '`shipped` `solo` `low`',
          '- **Keywords:** Splunk',
          '### A data platform, someday',
          '`plan-only` `solo` `high`',
          '- **Keywords:** Snowflake',
        ].join('\n'),
      },
    ]);
    expect(facts.keywords).toEqual([
      { text: 'CI/CD, platform engineering', where: 'acme.md · Cut deploy time' },
    ]);
    expect(facts.toCheck).toEqual([
      { text: 'incident management', where: 'acme.md · Ran the on-call rotation' },
      { text: 'Splunk', where: 'acme.md · Moved logs to one place' },
    ]);
  });

  it('keeps a heading inside a code block as part of its claim', () => {
    const facts = readFacts([
      {
        path: 'facts/acme.md',
        text: [
          '### Nightly jobs',
          '`unconfirmed` `live` `solo` `high`',
          '```',
          '# run nightly',
          '```',
          '- **Keywords:** Airflow',
        ].join('\n'),
      },
    ]);
    expect(facts.keywords).toEqual([]);
    expect(texts(facts.toCheck)).toEqual(['Airflow']);
  });

  it('reads what gaps.md says the user doesn’t have, and what needs confirming', () => {
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
          '## Needs confirmation',
          '- Kubernetes: production, or a side project?',
          '## Open questions',
          '- How many users?',
        ].join('\n'),
      },
    ]);
    expect(facts.saidNo).toEqual(['Rust in production', 'Kafka']);
    expect(facts.toConfirm).toEqual(['Kubernetes: production, or a side project?']);
    expect(facts.keywords).toEqual([]);
  });

  it('reads the degrees and certifications profile.md says the user has, not ones in progress', () => {
    const facts = readFacts([
      {
        path: 'facts/profile.md',
        text: [
          '# Profile',
          '## Contact',
          '- a@example.com',
          '## Certifications',
          '- AWS Solutions Architect, 2022',
          '- PMP: studying, exam booked 2027-01',
          '## Education',
          '- MBA, 2018',
          '- M.S. Statistics, expected 2027',
        ].join('\n'),
      },
    ]);
    expect(texts(facts.credentials)).toEqual(['AWS Solutions Architect, 2022', 'MBA, 2018']);
  });

  it('skips the bank’s README', () => {
    const facts = readFacts([
      { path: 'facts/README.md', text: '### A claim\n`live`\n- **Keywords:** the terms it proves' },
    ]);
    expect(facts.keywords).toEqual([]);
  });
});
