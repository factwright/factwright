import { describe, expect, it } from 'vitest';
import { readFacts } from './facts.ts';

const texts = (sources: readonly { text: string }[]) => sources.map((source) => source.text);
/** Each skill's name, as a term is looked for in it. */
const names = (sources: readonly { name: string }[]) => sources.map((source) => source.name);

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
    // A term in brackets names it too, so "Kubernetes (EKS)" names Kubernetes and EKS.
    expect(names(facts.skills)).toEqual(['Go', 'Kubernetes EKS', 'Terraform', 'Python']);
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
    expect(texts(facts.keywords)).toEqual(['CI/CD', 'platform engineering']);
    expect(facts.keywords[0]?.where).toBe('acme.md · Cut deploy time');
    expect(texts(facts.toCheck)).toEqual(['incident management', 'Splunk']);
    expect(facts.toCheck.map((source) => source.where)).toEqual([
      'acme.md · Ran the on-call rotation',
      'acme.md · Moved logs to one place',
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
    // Everything in gaps.md says what the user doesn't have, but what needs confirming and the
    // open questions: its title too, which names nothing.
    expect(facts.saidNo).toEqual(['Gaps', 'Rust in production, No, 2026-10-12', 'Kafka']);
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

describe('readFacts, with what each line is under', () => {
  it('leaves out skills a heading above says are to come, however deep, or a line or cell says so', () => {
    const facts = readFacts([
      {
        path: 'facts/skills.md',
        text: [
          '## Tools',
          '- SQL',
          '| Skill | Depth |',
          '|---|---|',
          '| Go | Daily |',
          '| Zig | In progress |',
          '| Haskell | Wanted |',
          '- AWS Certified Solutions Architect — exam in March',
          '## Want to learn',
          '### Cloud',
          '- Kubernetes',
          '## Studying',
          '- Rust',
          '## In progress',
          '- Elixir',
        ].join('\n'),
      },
    ]);
    expect(names(facts.skills)).toEqual(['SQL', 'Go']);
  });

  it('reads only the credentials profile.md says are earned and still held', () => {
    const facts = readFacts([
      {
        path: 'facts/profile.md',
        text: [
          '## Certifications',
          '- AWS Solutions Architect, 2022',
          '- RN license pending NCLEX results',
          '- CPA: passed 2 of 4 exams',
          '- CISSP next year',
          '- PMP: not yet',
          '- CPR (expired 2019)',
          '| Certification | Have it |',
          '|---|---|',
          '| CFA | Yes |',
          '| PMP | No |',
          '## Certifications in progress',
          '- CISM',
          '## Certifications to get',
          '- CCNA',
          '## Goals for next year',
          '### Certifications',
          '- PMI-ACP',
          '## Education',
          '- MBA, 2018',
          '- B.S. Biology (did not finish)',
        ].join('\n'),
      },
    ]);
    expect(texts(facts.credentials)).toEqual([
      'AWS Solutions Architect, 2022',
      'CFA, Yes',
      'MBA, 2018',
    ]);
  });

  it('reads every line of gaps.md’s parts, under a heading or a bold label', () => {
    const facts = readFacts([
      {
        path: 'facts/gaps.md',
        text: [
          '**Doesn’t have**',
          '- Kafka',
          '**Needs confirmation**',
          '- Kubernetes: production?',
          '## Doesn’t have',
          'Flink. Never used it.',
          '### Pulsar',
          '## Open questions',
          '- How many users?',
        ].join('\n'),
      },
    ]);
    expect(facts.saidNo).toEqual(['Kafka', 'Flink. Never used it.', 'Pulsar']);
    expect(facts.toConfirm).toEqual(['Kubernetes: production?']);
  });

  it('reads what a Don’t claim part names', () => {
    const facts = readFacts([
      {
        path: 'facts/acme.md',
        text: '## Don’t claim\n- Kubernetes: only via the platform team',
      },
    ]);
    expect(texts(facts.dontClaim)).toEqual([
      'Don’t claim',
      'Kubernetes: only via the platform team',
    ]);
    expect(facts.dontClaim[1]?.where).toBe('acme.md · Don’t claim');
  });

  it('backs terms only with a claim that says it’s confirmed, whatever its tags’ case', () => {
    const claim = (title: string, tags: string, keywords: string) =>
      `### ${title}\n${tags}\n- **Keywords:** ${keywords}`;
    const facts = readFacts([
      {
        path: 'facts/acme.md',
        text: [
          // As core reads a claim, its first tag is in small letters.
          claim('A', '`live` `Solo` `High`', 'Terraform'),
          claim('F', '`Live` `solo` `high`', 'Looker'),
          claim('B', '`solo` `Plan-only`', 'Snowflake'),
          claim('C', '`planned` `solo` `high`', 'dbt'),
          claim('D', '`live` `Unconfirmed` `high`', 'Airflow'),
          claim('E', '`solo` `high`', 'Spark'),
        ].join('\n'),
      },
    ]);
    expect(texts(facts.keywords)).toEqual(['Terraform']);
    expect(texts(facts.toCheck)).toEqual(['Airflow', 'Spark']);
  });

  it('keeps a code block open past a fence with words after it, as core does', () => {
    const facts = readFacts([
      {
        path: 'facts/skills.md',
        text: ['- SQL', '```', '```js', '- Haskell', '```', '- Go'].join('\n'),
      },
    ]);
    expect(texts(facts.skills)).toEqual(['SQL', 'Go']);
  });
});

describe('readFacts, in nested lists', () => {
  it('reads a nested item with the items it’s in, and items after a label item with it', () => {
    const facts = readFacts([
      {
        path: 'facts/skills.md',
        text: [
          '- Daily:',
          '  - Python',
          '- Want to learn:',
          '  - Rust',
          '    - Tokio',
          '- Go',
        ].join('\n'),
      },
      {
        path: 'facts/gaps.md',
        text: ['- Doesn’t have:', '  - Kafka', '- Open questions:', '  - How many users?'].join(
          '\n',
        ),
      },
      {
        path: 'facts/profile.md',
        text: [
          '- Certifications:',
          '  - PMP, 2021',
          '- Goals:',
          '  - Certifications:',
          '    - CISSP',
        ].join('\n'),
      },
    ]);
    // "- Go" comes after "- Want to learn:" at its depth, so it may be one to learn too.
    expect(texts(facts.skills)).toEqual(['Python']);
    expect(facts.saidNo).toEqual(['Kafka']);
    expect(texts(facts.credentials)).toEqual(['PMP, 2021']);
  });
});

describe('readFacts, on a file made to be slow to read', () => {
  it('reads a long heading over many lines in time with the file’s length', () => {
    const text = `## ${'Tools '.repeat(20_000)}\n${Array.from(
      { length: 20_000 },
      (_, at) => `- Skill ${at}`,
    ).join('\n')}`;
    const started = performance.now();
    expect(readFacts([{ path: 'facts/skills.md', text }]).skills).toHaveLength(20_000);
    // Each line read every heading above it again: seconds for a file this size.
    expect(performance.now() - started).toBeLessThan(1_500);
  });
});
