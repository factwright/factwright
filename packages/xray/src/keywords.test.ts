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

  it('asks to check a credential profile.md lists, and backs one with nothing else', () => {
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
      ['Certified ScrumMaster', 'credential'],
      ['PMP', 'none'],
      ['Computer Science', 'none'],
    ]);
    // Whether it's earned and current is the user's to say, so it quotes the line to check.
    expect(report.terms[0]?.backing).toEqual({
      kind: 'credential',
      where: 'profile.md',
      said: 'Certified ScrumMaster, 2021',
    });
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

describe('matchKeywords, honestly', () => {
  const backing = (report: ReturnType<typeof matchKeywords>) =>
    Object.fromEntries(report.terms.map(({ term, backing: { kind } }) => [term, kind]));

  it('backs a credential only with a credential, however the posting or the user’s files name it', () => {
    const facts = readFacts([
      { path: 'facts/skills.md', text: '- CSM tooling\n- Kubernetes' },
      {
        path: 'facts/acme.md',
        text: '### Studying\n`in-progress` `solo` `high`\n- **Keywords:** PMP certification, RN license',
      },
    ]);
    const report = matchKeywords(
      posting([
        'Certified ScrumMaster (CSM)',
        'Active CKA certification',
        'PMP certification required',
        'RN license',
      ]),
      'Platform engineer.',
      facts,
    );
    expect(backing(report)).toEqual({
      'Certified ScrumMaster': 'none',
      CSM: 'none',
      CKA: 'none',
      'PMP certification': 'none',
      'RN license': 'none',
    });
  });

  it('backs a skill only with skills.md or a confirmed claim, not a degree’s college', () => {
    const facts = readFacts([
      {
        path: 'facts/profile.md',
        text: '## Education\n- Lambda School, 2020\n- B.A. Biology, Rust College\n## Languages\n- Python, Go, Rust (learning)',
      },
    ]);
    const report = matchKeywords(posting(['AWS Lambda and Rust']), 'Engineer.', facts);
    expect(backing(report)).toEqual({ 'AWS Lambda': 'none', Rust: 'none' });
  });

  it('keeps a term off whatever case the user said no to it in, and checks one not to claim', () => {
    const facts = readFacts([
      { path: 'facts/skills.md', text: '- Go\n- Kubernetes' },
      { path: 'facts/gaps.md', text: '## Doesn’t have\n- go in production' },
      { path: 'facts/acme.md', text: '## Don’t claim\n- Kubernetes: only via the platform team' },
    ]);
    const report = matchKeywords(posting(['Go and Kubernetes']), 'Engineer.', facts);
    expect(backing(report)).toEqual({ Go: 'said-no', Kubernetes: 'dont-claim' });
    expect(report.terms[1]?.backing).toEqual({
      kind: 'dont-claim',
      where: 'acme.md · Don’t claim',
      said: 'Kubernetes: only via the platform team',
    });
  });

  it('says to check a term first when some of the fact bank couldn’t be read', () => {
    const facts = readFacts([{ path: 'facts/skills.md', text: '- Terraform' }]);
    const report = matchKeywords(posting(['Terraform']), 'Engineer.', facts, 'some');
    expect(report.bank).toBe('some');
    expect(report.terms[0]?.backing).toEqual({ kind: 'unread', where: 'skills.md' });
  });

  it('tells continuous integration from continuous delivery and deployment', () => {
    const facts = readFacts([
      {
        path: 'facts/acme.md',
        text: '### Pipelines\n`live` `solo` `high`\n- **Keywords:** continuous integration',
      },
    ]);
    const report = matchKeywords(
      posting(['Continuous delivery', 'Continuous deployment', 'CI/CD']),
      'Set up continuous integration.',
      facts,
    );
    expect(backing(report)).toEqual({
      'Continuous delivery': 'none',
      'Continuous deployment': 'none',
      'CI/CD': 'none',
    });
  });

  it('leaves out a place’s code and a currency that spell a term', () => {
    const report = matchKeywords(
      'Location: Montreal, QC\nPay: CAD 120,000\nQC and CAD skills',
      'Engineer.',
      null,
    );
    expect(report.terms.map(({ term }) => term)).toEqual(['QC', 'CAD']);
    expect(report.terms.every(({ context }) => context === 'QC and CAD skills')).toBe(true);
  });

  it('finds Go and Excel joined to a word, but not in "go-to-market"', () => {
    const report = matchKeywords(
      posting(['Go and Excel']),
      'Built Go-based services and Excel-based models.',
      null,
    );
    expect(report.terms.map(({ term, found }) => [term, found])).toEqual([
      ['Go', 'Go'],
      ['Excel', 'Excel'],
    ]);
    expect(
      matchKeywords(posting(['Go']), 'Led the go-to-market plan.', null).terms[0]?.found,
    ).toBeNull();
  });
});

describe('matchKeywords, on fact banks written every which way', () => {
  /** What the bank says about each term the posting names, with these files. */
  const kinds = (lines: string[], files: Record<string, string>) =>
    Object.fromEntries(
      matchKeywords(
        posting(lines),
        'Nothing.',
        readFacts(Object.entries(files).map(([path, text]) => ({ path: `facts/${path}`, text }))),
      ).terms.map(({ term, backing: { kind } }) => [term, kind]),
    );

  it('never says to add a credential, and lists only one profile.md doesn’t doubt', () => {
    const cases: Record<string, string>[] = [
      { 'profile.md': '## Certifications\n### PMP\nExam booked for March 2027.' },
      { 'profile.md': '## Certifications\n- PMP\n  - Status: exam scheduled' },
      { 'profile.md': '## Certifications\n- PMP (plan to get it in 2027)' },
      { 'profile.md': '## Certifications\n- PMP — want to earn it' },
      { 'profile.md': '## Certifications\n- PMP (failed, retaking in 2027)' },
      { 'profile.md': '## Certifications to pursue\n- PMP' },
      { 'profile.md': '## Training\n- PMP boot camp' },
      { 'profile.md': '## Certifications\n| Name | Have it |\n|---|---|\n| PMP | ❌ |' },
      { 'profile.md': '## Certifications\nNone yet. Thinking about PMP.' },
      { 'profile.md': 'Earned:\n- CSM\n\nIn progress:\n- PMP' },
      { 'profile.md': '## Certifications\n- PMP, 2099' },
    ];
    for (const files of cases) {
      expect(kinds(['PMP certification required'], files), JSON.stringify(files)).toEqual({
        PMP: 'none',
      });
    }
    expect(
      kinds(['PMP certification required'], { 'profile.md': '## Certifications\n- PMP, 2021' }),
    ).toEqual({ PMP: 'credential' });
  });

  it('takes a term as a credential wherever any line asks for it as one', () => {
    const claim = (keywords: string) =>
      `### Work\n\`live\` \`solo\` \`high\`\n- **Keywords:** ${keywords}`;
    expect(
      kinds(['Kubernetes (CKA a plus)', 'Active CKA certification required'], {
        'acme.md': claim('Kubernetes, CKA prep'),
      }).CKA,
    ).toBe('none');
    expect(
      kinds(['Series 7 license required'], { 'acme.md': claim('training, Series 7') }),
    ).toEqual({ 'Series 7': 'none' });
    expect(
      kinds(['Six Sigma Green Belt certified'], { 'acme.md': claim('Green Belt') })['Green Belt'],
    ).toBe('none');
    expect(kinds(['CPR and First Aid certification'], { 'skills.md': '- First aid' })).toEqual({
      CPR: 'none',
      'First Aid': 'none',
    });
    // Under a part for certifications, even a skill the X-ray knows is asked for as one.
    const certified = matchKeywords(
      '## Licenses and certifications\n- AWS',
      'Nothing.',
      readFacts([{ path: 'facts/skills.md', text: '- AWS' }]),
    );
    expect(certified.terms.map(({ term, backing: { kind } }) => [term, kind])).toEqual([
      ['AWS', 'none'],
    ]);
  });

  it('leaves out a skill anything says isn’t had or is to come', () => {
    const cases = [
      '- Python\n\nWant to learn:\n- Kubernetes',
      '**Want to learn** (2027):\n- Kubernetes',
      '| Learning next | Why |\n|---|---|\n| Kubernetes | jobs |',
      '## Next\n- Kubernetes',
      '## Gaps\n- Kubernetes',
      '## Not yet\n- Kubernetes',
      '## Don’t have\n- Kubernetes',
      '## Growth areas\n- Kubernetes',
      '- Kubernetes: no',
      '- Kubernetes: never used',
      '- Kubernetes (no hands-on experience)',
      '| Skill | Depth |\n|---|---|\n| Kubernetes | ❌ |',
      '| Skill | Depth |\n|---|---|\n| Kubernetes | — |',
      '| Skill | Depth |\n|---|---|\n| Kubernetes | No experience |',
      '- Kubernetes\n  - Depth: learning',
      '- Want to learn:\n- Kubernetes',
      '<!-- - Kubernetes -->',
      '---\nskills: Kubernetes\n- Kubernetes\n---',
      'Notes:\n\n    - Kubernetes',
      '- ~~Kubernetes~~',
    ];
    for (const skills of cases) {
      expect(kinds(['Kubernetes'], { 'skills.md': skills }), skills).toEqual({
        Kubernetes: 'none',
      });
    }
  });

  it('backs a skill only with nothing beside it, and never with a note that rules it out', () => {
    const skills = [
      '- Docker (but not Kubernetes)',
      '- SQL (Postgres; not Oracle)',
      '- Python: daily, did not use Django',
      '| Skill | Depth |\n|---|---|\n| Airflow | Daily, scheduled 200 DAGs |',
      '## Planning & delivery\n- Jira',
      '## Machine Learning\n- PyTorch',
      '- **Languages:** Go, Rust',
    ].join('\n\n');
    expect(
      kinds(['Docker, Kubernetes, SQL, Oracle, Python, Django, Airflow, Jira, PyTorch, Go, Rust'], {
        'skills.md': skills,
      }),
    ).toEqual({
      // Nothing beside these but other terms and harmless words: had beyond doubt.
      Go: 'facts',
      Rust: 'facts',
      Jira: 'facts',
      PyTorch: 'facts',
      // A note beside these the user should read: "(but not Kubernetes)", "did not use Django",
      // or words the X-ray can't vouch for, as "scheduled 200 DAGs".
      Docker: 'unsure',
      SQL: 'unsure',
      Python: 'unsure',
      Airflow: 'unsure',
      // Only in a note that rules them out: nothing backs them.
      Kubernetes: 'none',
      Oracle: 'none',
      Django: 'none',
    });
    expect(
      kinds(['Docker and Kubernetes'], {
        'acme.md': '### Work\n`live` `solo` `high`\n- **Keywords:** Docker, ECS (not Kubernetes)',
      }),
    ).toEqual({ Docker: 'facts', Kubernetes: 'none' });
  });

  it('checks first what a part of any name says not to claim', () => {
    const claim = '### Work\n`live` `solo` `high`\n- **Keywords:** Kubernetes';
    for (const part of [
      '## What never to claim\n- Kubernetes ownership',
      '## Avoid claiming\n- Kubernetes ownership',
      '#### Don’t claim Kubernetes ownership',
      '- **Don’t claim:** Kubernetes ownership',
    ]) {
      expect(kinds(['Kubernetes'], { 'acme.md': `${claim}\n\n${part}` }), part).toEqual({
        Kubernetes: 'dont-claim',
      });
    }
  });

  it('takes all of gaps.md as what the user doesn’t have, but what needs confirming', () => {
    for (const gaps of [
      '| Topic | Answer |\n|---|---|\n| Container orchestration | No: never ran Kubernetes |',
      '# Gaps\n- Kubernetes',
      '## Hasn’t used\n- Kubernetes',
      '## Needs confirmation\n- Kafka\n\nDoesn’t have:\n- Kubernetes',
    ]) {
      expect(kinds(['Kubernetes'], { 'skills.md': '- Kubernetes', 'gaps.md': gaps }), gaps).toEqual(
        {
          Kubernetes: 'said-no',
        },
      );
    }
    expect(
      kinds(['Python, R and SQL'], { 'skills.md': '- R', 'gaps.md': '- R (statistics)' }).R,
    ).toBe('said-no');
    expect(
      kinds(['Go'], { 'skills.md': '- Go', 'gaps.md': '## Doesn’t have\n- Go-to-market strategy' }),
    ).toEqual({ Go: 'facts' });
  });
});

describe('matchKeywords, beyond doubt', () => {
  const kinds = (lines: string[], files: Record<string, string>) =>
    Object.fromEntries(
      matchKeywords(
        posting(lines),
        'Nothing.',
        readFacts(Object.entries(files).map(([path, text]) => ({ path: `facts/${path}`, text }))),
      ).terms.map(({ term, backing: { kind } }) => [term, kind]),
    );
  const claim = (keywords: string) =>
    `### Work\n\`live\` \`solo\` \`high\`\n- **Keywords:** ${keywords}`;

  it('never says to add a skill with anything beside it that may say otherwise', () => {
    const skills = [
      '- Kubernetes: never used, only ECS',
      '- Kubernetes\n  - never used it, only ECS',
      '## Needs confirmation\n- Kubernetes',
      '## To confirm\n- Kubernetes',
      '## Open questions\n- Kubernetes',
      '- Kubernetes (unconfirmed)',
      '- Kubernetes `unconfirmed`',
      '- Kubernetes?',
      '| Skill | Status |\n|---|---|\n| Kubernetes | To confirm |',
      '- Kubernetes <!-- unconfirmed -->',
      '- Kubernetes (havent used it)',
      '## Havent used\n- Kubernetes',
      '- Kubernetes (wouldn’t claim it)',
      '- Kubernetes: N/A',
      '- Kubernetes: 0 years',
      '| Skill | Years |\n|---|---|\n| Kubernetes | 0 |',
      '| Skill | Have? |\n|---|---|\n| Kubernetes | N |',
      '- Kubernetes ❌',
      '- Kubernetes 🚫',
      '- Kubernetes ✕',
      '- [ ] Kubernetes',
      '- Kubernetes (soon)',
      '- Kubernetes (maybe later)',
      '- Kubernetes (on my list)',
      '- Kubernetes (would like to try)',
      '- Kubernetes (only read about it)',
      '- Kubernetes (theory only)',
      '- ECS (non-Kubernetes deploys)',
      '- **Learning:**\n- Kubernetes',
      '*Learning:*\n- Kubernetes',
      '_Want to learn_\n- Kubernetes',
      'Want to learn\n-------------\n- Kubernetes',
      'Want to learn\n- Kubernetes',
    ];
    for (const text of skills) {
      expect(kinds(['Kubernetes'], { 'skills.md': text }).Kubernetes, text).not.toBe('facts');
    }
    for (const keywords of ['Kubernetes (to confirm)', 'ECS (not Kubernetes)']) {
      expect(kinds(['Kubernetes'], { 'acme.md': claim(keywords) }).Kubernetes, keywords).not.toBe(
        'facts',
      );
    }
    expect(
      kinds(['Snowflake'], { 'skills.md': '- Snowflake: no — BigQuery only' }).Snowflake,
    ).not.toBe('facts');
    expect(kinds(['GraphQL'], { 'skills.md': '- GraphQL: no, REST only' }).GraphQL).not.toBe(
      'facts',
    );
  });

  it('never says to add a credential the user wrote inside a note or a phrase', () => {
    expect(
      kinds(['Kubernetes (CKA a plus)'], { 'acme.md': claim('Kubernetes, CKA prep') }).CKA,
    ).not.toBe('facts');
    expect(kinds(['CKA a plus'], { 'skills.md': '- Preparing for the CKA' }).CKA).not.toBe('facts');
    expect(kinds(['CDL Class A'], { 'skills.md': '- Driving (CDL Class A, lapsed)' }).CDL).not.toBe(
      'facts',
    );
    expect(kinds(['CKA required'], { 'skills.md': '- Kubernetes (CKA, 2021)' }).CKA).not.toBe(
      'facts',
    );
    const certs = matchKeywords(
      '## Must-have certs\n- AWS',
      'Nothing.',
      readFacts([{ path: 'facts/skills.md', text: '- AWS' }]),
    );
    expect(certs.terms[0]?.backing.kind).toBe('none');
    expect(kinds(['Epic certification required'], { 'skills.md': '- Epic' }).Epic).toBe('unsure');
  });

  it('says to add a skill written plainly, in bold or with harmless notes', () => {
    for (const text of [
      '- **Python**',
      '- **Python** — daily, 6 years',
      '- **Python:** daily',
      '- Python: 6 years, daily',
      '| Skill | Depth | Proven in |\n|---|---|---|\n| Python | Daily | acme.md |',
      '| Skill | Depth | Proven in |\n|---|---|---|\n| Python | 4 years | — (no claim yet) |',
      '# Skills (not exhaustive)\n- Python',
      '## Skills, in no particular order\n- Python',
    ]) {
      expect(kinds(['Python'], { 'skills.md': text }), text).toEqual({ Python: 'facts' });
    }
    expect(kinds(['Python'], { 'archive/skills.md': '- Python' })).toEqual({ Python: 'none' });
  });

  it('reads gaps.md’s and Don’t claim’s labels as what they name', () => {
    expect(
      kinds(['Kubernetes'], {
        'skills.md': '- Kubernetes',
        'gaps.md': '## Doesn’t have\n**Kubernetes in production**\nNo, only minikube.',
      }),
    ).toEqual({ Kubernetes: 'said-no' });
    expect(
      kinds(['Kubernetes'], {
        'acme.md': `${claim('Kubernetes')}\n\n## Don’t claim\nKubernetes ownership:\n- only as a user`,
      }),
    ).toEqual({ Kubernetes: 'dont-claim' });
  });
});

describe('matchKeywords, under headings put in unknown words', () => {
  it('makes a skill under a heading or label with a doubt in it a check', () => {
    // A heading or label put in words the X-ray doesn't know as a part to come still leaves a
    // doubt, so what's under it is a check, never "Add it".
    for (const heading of [
      '## Not my strengths',
      '## Rusty',
      '## Skills I’d like to have',
      '## Used to use',
      '**Some exposure**',
      '- Familiar with:',
    ]) {
      const report = matchKeywords(
        posting(['Kubernetes']),
        'Nothing.',
        readFacts([{ path: 'facts/skills.md', text: `${heading}\n- Kubernetes` }]),
      );
      expect(report.terms[0]?.backing.kind, heading).not.toBe('facts');
    }
  });
});
