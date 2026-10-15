import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import type { FiledFacts } from '../../shared/facts.ts';
import { FactBankFiles, keepsConfirmed } from '../about/facts.ts';
import { type FilingTool, hookToolName } from '../claude/questions.ts';
import { JobsService } from '../jobs/service.ts';
import { Tracker } from '../jobs/tracker.ts';
import { factwrightTools } from './index.ts';
import { type McpTool, newCall, type ToolCall } from './mcp.ts';

const NOW = () => new Date(2026, 9, 14, 9, 30);
const JOB = 'acme-robotics--staff-engineer';
const GRAPHQL = 'Have you used GraphQL in production?';
const WHERE = 'Where was that, and how big was it?';
const KAFKA = 'Have you run Kafka, or another event-streaming platform?';

const ACME = [
  '# Acme Health',
  '',
  '## Overview',
  'Staff engineer, 2021–2026.',
  '',
  '### Scheduling platform',
  '`live` `led-and-built` `high`',
  '> Built a scheduling platform used by 40 clinics.',
  '- **Source:** Alex 2026-10-01',
  '',
  '### Reminder texts',
  '`unconfirmed` `shipped` `solo` `medium`',
  '> Shipped appointment reminder texts.',
  '- **Source:** resume alex.pdf 2026-10-10',
  '',
  "## Don't claim",
  '- Never "HIPAA certified".',
  '',
].join('\n');

const GAPS = [
  '# Gaps',
  '',
  "## Doesn't have",
  '| Topic | Their answer | Date |',
  '|---|---|---|',
  '| Rust in production | No | 2026-10-12 |',
  '',
  '## Open questions',
  '',
].join('\n');

/** The question that offers the user a fact that waits to be verified, as the standing rules word it. */
const OFFER =
  'Your fact bank has “Reminder texts” (shipped, solo, medium confidence), from your resume and not verified yet: “Shipped appointment reminder texts.” Can I use it?';

let root: string;
let tracker: Tracker;
let tools: McpTool[];
let call: ToolCall;
let filed: Mock<(filed: FiledFacts) => void>;
let rounds = 0;

const write = (path: string, text: string) => {
  const file = join(root, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
};
const read = (path: string) => readFileSync(join(root, path), 'utf8');

/** Claude Code's PreToolUse hook for a call, from the run's own Claude or a subagent. */
const shown = (name: FilingTool, input: Record<string, unknown>, agent?: string) =>
  call.questions.hear({
    hook_event_name: 'PreToolUse',
    tool_name: hookToolName(name),
    tool_use_id: `toolu_call_${++rounds}`,
    tool_input: input,
    ...(agent && { agent_id: agent }),
  });

/** A call to a filing tool as Claude Code makes it: shown in its hook first, then made. */
const tool = (name: FilingTool) => {
  const found = tools.find((each) => each.name === name);
  if (!found) throw new Error(`No tool ${name}`);
  return (input: Record<string, unknown>, { agent }: { agent?: string } = {}) => {
    shown(name, input, agent);
    return found.run(input, call);
  };
};

/** The options Claude offers, as the resume skill words them. */
const OPTIONS = [
  { label: 'Yes, in production', description: '' },
  { label: 'Some', description: 'A side project, a course, or an earlier role' },
  { label: 'No', description: '' },
];

/** A question round the user answered, as Claude Code's hooks report it. */
function answered(
  answers: Record<string, string>,
  notes: Record<string, string> = {},
  options = OPTIONS,
) {
  const id = `toolu_${++rounds}`;
  const questions = Object.keys(answers).map((question) => ({
    question,
    header: 'Experience',
    options,
  }));
  call.questions.hear({
    hook_event_name: 'PreToolUse',
    tool_name: 'AskUserQuestion',
    tool_use_id: id,
    tool_input: { questions },
  });
  call.questions.hear({
    hook_event_name: 'PostToolUse',
    tool_name: 'AskUserQuestion',
    tool_use_id: id,
    tool_input: { questions },
    tool_response: {
      questions,
      answers,
      annotations: Object.fromEntries(
        Object.entries(notes).map(([question, note]) => [question, { notes: note }]),
      ),
    },
  });
}

const FACT = {
  file: 'facts/acme.md',
  title: 'GraphQL for the partner API',
  status: 'live',
  ownership: 'solo',
  confidence: 'medium',
  wording: 'Built and ran the partner API in GraphQL.',
  keywords: 'GraphQL',
  questions: [GRAPHQL],
  job: JOB,
  task: 'resume',
};

beforeEach(() => {
  rounds = 0;
  root = mkdtempSync(join(tmpdir(), 'factwright-fact-tools-'));
  write(
    'applications/2026-10-07-acme-staff-engineer/job.md',
    '# Acme Robotics: Staff Engineer\n\n- **Date:** 2026-10-07\n',
  );
  write('facts/acme.md', ACME);
  write('facts/gaps.md', GAPS);
  write('facts/skills.md', '# Skills\n\n| Skill | Depth |\n|---|---|\n| Go | Daily |\n');
  tracker = new Tracker(':memory:');
  const jobs = new JobsService({ workspace: root, tracker, onChange: () => {}, now: NOW });
  jobs.read();
  const facts = new FactBankFiles({
    workspace: root,
    name: () => 'Alex Rivera',
    today: () => '2026-10-14',
  });
  tools = factwrightTools({
    jobs,
    about: {} as never,
    facts,
    workspace: root,
    now: NOW,
    printer: {} as never,
    templates: {} as never,
    answerWaitMs: 0,
  });
  filed = vi.fn<(filed: FiledFacts) => void>();
  call = newCall('hunt', filed);
});

afterEach(() => {
  tracker.close();
  rmSync(root, { recursive: true, force: true });
});

describe('save_fact', () => {
  it('files a yes as a fact to verify, with where it came from as Claude Code reported it', async () => {
    answered({ [GRAPHQL]: 'Yes, in production', [WHERE]: 'The partner API, about 30 partners' });
    expect(
      await tool('save_fact')({
        ...FACT,
        wording: 'Built and ran the partner API in GraphQL, used by 30 partners.',
        questions: [GRAPHQL, WHERE],
      }),
    ).toBe(
      'Saved “GraphQL for the partner API” in facts/acme.md, unverified, from the user’s answer: “Yes, in production”, then “The partner API, about 30 partners”. Use it in this run’s work: the user just said it. Say which lines rest on it when you report. Later runs offer it to the user before using it, until they verify it.',
    );
    expect(read('facts/acme.md')).toBe(
      ACME.replace(
        "## Don't claim",
        [
          '### GraphQL for the partner API',
          '`unconfirmed` `live` `solo` `medium`',
          '> Built and ran the partner API in GraphQL, used by 30 partners.',
          '- **Keywords:** GraphQL',
          '- **Source:** answer 2026-10-14, tailoring a resume for Acme Robotics',
          '- **Question:** Have you used GraphQL in production?',
          '- **Answer:** Yes, in production',
          '- **Question:** Where was that, and how big was it?',
          '- **Answer:** The partner API, about 30 partners',
          '',
          "## Don't claim",
        ].join('\n'),
      ),
    );
    expect(filed).toHaveBeenCalledWith({
      facts: [{ path: 'facts/acme.md', title: 'GraphQL for the partner API', save: 1 }],
      gaps: 0,
    });
  });

  it('keeps what the pick said and the user’s notes with their answer, and leaves out the job when there’s none', async () => {
    answered({ [GRAPHQL]: 'Some' }, { [GRAPHQL]: 'Two years' });
    await tool('save_fact')({ ...FACT, job: undefined, task: undefined });
    const text = read('facts/acme.md');
    expect(text).toContain('- **Source:** answer 2026-10-14\n');
    expect(text).toContain(
      '- **Answer:** Some: A side project, a course, or an earlier role (Two years)\n',
    );
  });

  it('files nothing the user wasn’t asked, or was asked some other way', async () => {
    await expect(tool('save_fact')(FACT)).rejects.toThrow(
      'Not saved: Factwright has no record of the user answering “Have you used GraphQL in production?” in this run. Facts from answers come only from questions you asked with AskUserQuestion, given word for word.',
    );
    answered({ [KAFKA]: 'No' });
    // Claude's own call hears which of its questions were answered, to give one word for word.
    await expect(tool('save_fact')(FACT)).rejects.toThrow(`Answered in this run: “${KAFKA}”.`);
    expect(read('facts/acme.md')).toBe(ACME);
    expect(filed).not.toHaveBeenCalled();
  });

  it('files nothing for a call Claude Code didn’t show from the run’s own Claude', async () => {
    answered({ [GRAPHQL]: 'Yes, in production' });
    const saveFact = tools.find((each) => each.name === 'save_fact');
    await expect(saveFact?.run(FACT, call)).rejects.toThrow(
      'Not saved: Factwright takes this only from your own call, once Claude Code’s hook has shown it, and never from a subagent’s. If it was your own call, make it again.',
    );
    await expect(tool('save_fact')(FACT, { agent: 'agent-7' })).rejects.toThrow(
      'never from a subagent’s',
    );
    // Shown with other words, it isn't this call.
    shown('save_fact', { ...FACT, wording: 'Something else.' });
    await expect(saveFact?.run(FACT, call)).rejects.toThrow('never from a subagent’s');
    expect(read('facts/acme.md')).toBe(ACME);
    // The answer is still there for the call that's shown.
    expect(await tool('save_fact')(FACT)).toMatch(/^Saved/);
  });

  it('turns away files that don’t hold claims, and one that isn’t there', async () => {
    answered({ [GRAPHQL]: 'Yes, in production' });
    for (const file of [
      'facts/skills.md',
      'facts/gaps.md',
      'facts/README.md',
      'notes.md',
      '../x.md',
    ]) {
      await expect(tool('save_fact')({ ...FACT, file })).rejects.toThrow();
    }
    await expect(tool('save_fact')({ ...FACT, file: 'facts/fernway.md' })).rejects.toThrow(
      'Not saved: there’s no facts/fernway.md in the fact bank.',
    );
  });

  it('starts a file of projects when there’s none', async () => {
    answered({ [GRAPHQL]: 'Yes, in production' });
    await tool('save_fact')({ ...FACT, file: 'facts/projects.md', status: 'pre-launch' });
    expect(read('facts/projects.md')).toMatch(
      /^# Projects\n\n### GraphQL for the partner API\n`unconfirmed` `pre-launch`/,
    );
  });

  it('checks every part of the fact', async () => {
    answered({ [GRAPHQL]: 'Yes, in production' });
    await expect(tool('save_fact')({ ...FACT, status: 'launched' })).rejects.toThrow(
      'The status should be one of live, shipped, beta, built, in-progress, pre-launch, plan-only.',
    );
    await expect(tool('save_fact')({ ...FACT, wording: 'x'.repeat(401) })).rejects.toThrow(
      'The wording should be 400 characters or fewer.',
    );
    await expect(tool('save_fact')({ ...FACT, keywords: undefined })).rejects.toThrow(
      'Give the keywords.',
    );
    await expect(tool('save_fact')({ ...FACT, questions: [] })).rejects.toThrow('Give questions');
    await expect(tool('save_fact')({ ...FACT, job: 'nobody--nothing' })).rejects.toThrow(
      'Nothing on file for nobody--nothing.',
    );
    await expect(tool('save_fact')({ ...FACT, title: 'Scheduling platform' })).rejects.toThrow(
      'Not saved: facts/acme.md has a fact titled “Scheduling platform” already.',
    );
  });

  it('saves a note the user added to their pick, as a correction of the fact it named', async () => {
    answered({ [OFFER]: 'Use and verify' }, { [OFFER]: 'Only at two clinics' });
    expect(
      await tool('save_fact')({
        ...FACT,
        title: 'Reminder texts',
        replaces: 'Reminder texts',
        status: 'beta',
        wording: 'Piloted appointment reminder texts at two clinics.',
        keywords: 'appointment reminder texts',
        questions: [OFFER],
      }),
    ).toMatch(/^Replaced “Reminder texts”/);
    expect(read('facts/acme.md')).toContain('- **Answer:** Use and verify (Only at two clinics)\n');
    // Without a note, the pick backs nothing, and neither does a note on a fact it didn't name.
    answered({ [`${OFFER} `]: 'Use this once' });
    await expect(
      tool('save_fact')({ ...FACT, keywords: 'reminder texts', questions: [`${OFFER} `] }),
    ).rejects.toThrow('answers whether to use a fact');
  });

  it('files a fact only about what was asked, by its keywords', async () => {
    const asked = 'Shall I carry on with the resume?';
    answered({ [asked]: 'Yes, in production' });
    await expect(
      tool('save_fact')({
        ...FACT,
        title: 'Led a big team',
        wording: 'Led the platform team.',
        keywords: 'leadership, people management',
        questions: [asked],
      }),
    ).rejects.toThrow('Not saved: “leadership” isn’t in the question or the user’s answer.');
    expect(read('facts/acme.md')).toBe(ACME);
    answered({ [KAFKA]: 'Yes, in production' });
    // Every keyword is one the exchange used: an answer about Kafka proves nothing about Rust.
    await expect(
      tool('save_fact')({
        ...FACT,
        title: 'Event streaming',
        wording: 'Ran an event-streaming pipeline.',
        keywords: 'Kafka, you, Rust',
        questions: [KAFKA],
      }),
    ).rejects.toThrow('Not saved: “Rust” isn’t in the question or the user’s answer.');
    // And the fact itself is about it.
    await expect(
      tool('save_fact')({
        ...FACT,
        title: 'Platform work',
        wording: 'Ran the data platform.',
        keywords: 'Kafka',
        questions: [KAFKA],
      }),
    ).rejects.toThrow('Not saved: the fact’s title and wording don’t say what you asked about');
    expect(
      await tool('save_fact')({
        ...FACT,
        title: 'Event streaming',
        wording: 'Ran an event-streaming pipeline on Kafka.',
        keywords: 'Kafka, event streaming',
        questions: [KAFKA],
      }),
    ).toMatch(/^Saved/);
  });

  it('files no number the user didn’t give or see', async () => {
    answered({ [GRAPHQL]: 'Yes, in production', [WHERE]: 'The partner API, about 3,000 users' });
    await expect(
      tool('save_fact')({
        ...FACT,
        wording: 'Built the partner API in GraphQL for 3,000 users, cutting load ~40%.',
        questions: [GRAPHQL, WHERE],
      }),
    ).rejects.toThrow(
      'Not saved: 40 isn’t in the user’s answer or your question. Leave out a number they didn’t give, or ask them for it.',
    );
    await expect(
      tool('save_fact')({ ...FACT, numbers: '5,000 users', questions: [GRAPHQL, WHERE] }),
    ).rejects.toThrow('Not saved: 5000 isn’t in the user’s answer');
    // A number's scale counts, and so do numbers in words, and in every part of the fact.
    answered({ [`${GRAPHQL} `]: 'Yes, for about 2 years' });
    for (const wording of [
      'Built the GraphQL API behind $2M in sales.',
      'Built the GraphQL API with fifty engineers.',
      'Built the GraphQL API, answering in 40ms.',
    ]) {
      await expect(
        tool('save_fact')({ ...FACT, wording, questions: [`${GRAPHQL} `] }),
      ).rejects.toThrow('isn’t in the user’s answer or your question');
    }
    await expect(
      tool('save_fact')({
        ...FACT,
        say: '“led a 12-person team”',
        questions: [`${GRAPHQL} `],
      }),
    ).rejects.toThrow('Not saved: 12 isn’t in the user’s answer');
    for (const wording of [
      'Built the GraphQL API behind $2mm in sales.',
      'Built the GraphQL API for 2bn calls.',
      'Built the GraphQL API behind $2 mm in sales.',
      'Built the GraphQL API for 2 bn calls.',
      'Built the GraphQL API behind $2 mil in sales.',
      'Built the GraphQL API behind $2 M in sales.',
    ]) {
      await expect(
        tool('save_fact')({ ...FACT, wording, questions: [`${GRAPHQL} `] }),
      ).rejects.toThrow('isn’t in the user’s answer or your question');
    }
    // A number written with its scale in letters or in words reads alike.
    const scale = 'How many calls a day?';
    answered({ [scale]: 'About 100 million' });
    expect(
      await tool('save_fact')({
        ...FACT,
        title: 'GraphQL at scale',
        wording: 'Ran the GraphQL API at 100M calls a day.',
        questions: [GRAPHQL, scale],
        keywords: 'GraphQL',
      }),
    ).toMatch(/^Saved/);
    // Their own numbers, as they gave them or written another way, and names with digits in
    // them, such as S3 or OAuth2, are fine.
    expect(
      await tool('save_fact')({
        ...FACT,
        wording: 'Built the partner API in GraphQL, on S3 and OAuth2, for 3000 users.',
        numbers: '3,000 users',
        questions: [GRAPHQL, WHERE],
      }),
    ).toMatch(/^Saved/);
  });

  it('claims nothing from a plain no, or from a pick about using a fact', async () => {
    answered({ [KAFKA]: 'No' });
    await expect(
      tool('save_fact')({ ...FACT, keywords: 'Kafka', questions: [KAFKA] }),
    ).rejects.toThrow(
      `Not saved: the user answered “No” to “${KAFKA}”. Save that no with save_gap, and claim nothing from it.`,
    );
    answered({ [OFFER]: 'Use this once' });
    await expect(
      tool('save_fact')({ ...FACT, keywords: 'reminder texts', questions: [OFFER] }),
    ).rejects.toThrow(
      'Not saved: “Use this once” answers whether to use a fact, not what the user has done.',
    );
    // A no in other words is still a no: what else they have, they say in answer to a
    // question about it.
    for (const no of ['No, I have not', 'Never used it', 'Not really', 'I don’t, sorry']) {
      answered({ [GRAPHQL]: no });
      await expect(tool('save_fact')(FACT)).rejects.toThrow('Save that no with save_gap');
    }
    // A no to a follow-up after a yes can back a fact.
    const prod = 'Was that in production?';
    answered({ [WHERE]: 'The partner API', [prod]: 'No' });
    expect(
      await tool('save_fact')({
        ...FACT,
        title: 'Partner API in GraphQL',
        keywords: 'partner API',
        status: 'built',
        questions: [WHERE, prod],
      }),
    ).toMatch(/^Saved/);
  });

  it('reads a yes, a no and not sure in what the user picked or typed, never in an option’s words', async () => {
    // A yes with a note that's unsure about a detail is still a yes.
    answered({ [GRAPHQL]: 'Yes, in production' }, { [GRAPHQL]: 'not sure of the exact year' });
    expect(await tool('save_fact')(FACT)).toMatch(/^Saved/);
    // What an option said under it doesn't change the pick, either way.
    answered({ [KAFKA]: 'Some' }, {}, [
      { label: 'Some', description: 'Not sure it counts? A side project or a course' },
      { label: 'No', description: '0 times' },
    ]);
    expect(
      await tool('save_fact')({
        ...FACT,
        title: 'Kafka on a side project',
        wording: 'Ran Kafka on a side project.',
        keywords: 'Kafka',
        questions: [KAFKA],
      }),
    ).toMatch(/^Saved/);
    const prod = 'Have you run Kafka in production?';
    answered({ [prod]: 'No' }, {}, [
      { label: 'Yes', description: '' },
      { label: 'No', description: '0 times' },
    ]);
    await expect(
      tool('save_fact')({
        ...FACT,
        title: 'Kafka in production',
        wording: 'Ran Kafka in production.',
        keywords: 'Kafka',
        questions: [prod],
      }),
    ).rejects.toThrow('Save that no with save_gap');
    // A question that also asks how long doesn't make a no anything else.
    const howLong = 'Have you run Kafka in production, and if so, how long?';
    answered({ [howLong]: 'No' });
    await expect(
      tool('save_fact')({
        ...FACT,
        title: 'Kafka in production',
        wording: 'Ran Kafka in production.',
        keywords: 'Kafka',
        questions: [howLong],
      }),
    ).rejects.toThrow('Save that no with save_gap');
    // A no with a number in passing is still a no, and is something they don't have.
    const backend = 'Have you used Kafka at all?';
    answered({ [backend]: 'No, never used it in 10 years of backend work' });
    await expect(
      tool('save_fact')({
        ...FACT,
        title: 'Kafka at all',
        wording: 'Used Kafka.',
        keywords: 'Kafka',
        questions: [backend],
      }),
    ).rejects.toThrow('Save that no with save_gap');
    expect(await tool('save_gap')({ topic: 'Kafka', question: backend })).toMatch(/^Noted/);
  });

  it('takes a hedged or unsure answer to how many as just that, never as a no', async () => {
    const rough = 'Roughly how many teams used the GraphQL API?';
    answered({ [rough]: 'Not many, maybe 5' });
    expect(
      await tool('save_fact')({
        ...FACT,
        title: 'GraphQL for a few teams',
        wording: 'Built the GraphQL API that about 5 teams used.',
        questions: [rough],
      }),
    ).toMatch(/^Saved/);
    // Unsure, with an estimate, is an answer to hedge, not a no.
    const share = 'Roughly what share of load did the GraphQL API take?';
    answered({ [share]: 'Not sure, maybe 18%' });
    expect(
      await tool('save_fact')({
        ...FACT,
        title: 'GraphQL share of load',
        wording: 'Built the GraphQL API, which took about 18% of load.',
        confidence: 'medium',
        questions: [share],
      }),
    ).toMatch(/^Saved/);
    const many = 'About how many partners used the GraphQL API?';
    answered({ [many]: 'No more than 30' });
    expect(
      await tool('save_fact')({
        ...FACT,
        wording: 'Built the partner API in GraphQL, used by up to 30 partners.',
        questions: [many],
      }),
    ).toMatch(/^Saved/);
    const unsure = 'About how many requests a day did the GraphQL API serve?';
    answered({ [unsure]: 'Not sure, no idea really' });
    await expect(
      tool('save_fact')({ ...FACT, title: 'GraphQL load', questions: [unsure] }),
    ).rejects.toThrow('Not saved: the user wasn’t sure (“Not sure, no idea really”).');
    // Nor is either something they don't have.
    await expect(tool('save_gap')({ topic: 'GraphQL', question: unsure })).rejects.toThrow(
      'isn’t a no to whether they have it',
    );
    await expect(tool('save_gap')({ topic: 'GraphQL', question: many })).rejects.toThrow(
      'isn’t a no to whether they have it',
    );
    expect(read('facts/gaps.md')).toBe(GAPS);
  });

  it('lets one answer back a few facts, and no more, even all at once', async () => {
    answered({ [GRAPHQL]: 'Yes, in production' });
    const saves = ['A', 'B', 'C', 'D', 'E'].map((letter) =>
      tool('save_fact')({ ...FACT, title: `Fact ${letter}` }),
    );
    const results = await Promise.allSettled(saves);
    expect(results.filter((each) => each.status === 'fulfilled')).toHaveLength(4);
    expect(results.filter((each) => each.status === 'rejected')).toEqual([
      expect.objectContaining({
        reason: expect.objectContaining({
          message: expect.stringContaining('has been used for as much as one answer can back'),
        }),
      }),
    ]);
  });

  it('gives back what an answer backed when the fact isn’t saved', async () => {
    answered({ [GRAPHQL]: 'Yes, in production' });
    for (let i = 0; i < 5; i++) {
      await expect(tool('save_fact')({ ...FACT, file: 'facts/fernway.md' })).rejects.toThrow();
    }
    expect(await tool('save_fact')(FACT)).toMatch(/^Saved/);
  });

  it('replaces a fact it filed in this run, or one the user just corrected by its title', async () => {
    answered({ [GRAPHQL]: 'Yes, in production' });
    await tool('save_fact')(FACT);
    answered({ [WHERE]: 'The partner API' });
    await tool('save_fact')({
      ...FACT,
      title: 'GraphQL partner API',
      replaces: 'GraphQL for the partner API',
      questions: [GRAPHQL, WHERE],
      wording: 'Built the partner API in GraphQL.',
    });
    const text = read('facts/acme.md');
    expect(text).not.toContain('### GraphQL for the partner API');
    expect(text.match(/### GraphQL partner API/g)).toHaveLength(1);
    expect(filed).toHaveBeenLastCalledWith({
      facts: [{ path: 'facts/acme.md', title: 'GraphQL partner API', save: 2 }],
      gaps: 0,
    });

    answered({ [OFFER]: 'Only to two clinics, as a pilot' });
    await tool('save_fact')({
      ...FACT,
      title: 'Reminder texts',
      replaces: 'Reminder texts',
      status: 'beta',
      wording: 'Piloted appointment reminder texts at two clinics.',
      keywords: 'appointment reminder texts',
      questions: [OFFER],
    });
    expect(read('facts/acme.md')).toContain(
      '### Reminder texts\n`unconfirmed` `beta` `solo` `medium`\n> Piloted appointment reminder texts at two clinics.',
    );
  });

  it('never replaces a verified fact, or an unverified one the user wasn’t asked about', async () => {
    answered({ [GRAPHQL]: 'Yes, in production' });
    await expect(
      tool('save_fact')({ ...FACT, replaces: 'Scheduling platform', title: 'Scheduling' }),
    ).rejects.toThrow(
      'Not saved: “Scheduling platform” is verified, and only the user changes a verified fact',
    );
    await expect(
      tool('save_fact')({ ...FACT, replaces: 'Reminder texts', title: 'Texts' }),
    ).rejects.toThrow(
      'Not saved: “Reminder texts” wasn’t filed in this run, and no answer here is about it.',
    );
    // Naming it only in passing, not by its title in quotes, isn't asking about it.
    const passing = 'Do your reminder texts count for this?';
    answered({ [passing]: 'Only at two clinics' });
    await expect(
      tool('save_fact')({
        ...FACT,
        replaces: 'Reminder texts',
        title: 'Texts',
        wording: 'Shipped reminder texts.',
        keywords: 'reminder texts',
        questions: [passing],
      }),
    ).rejects.toThrow('wasn’t filed in this run, and no answer here is about it');
    expect(read('facts/acme.md')).toBe(ACME);
  });

  it('never replaces a fact whose code block runs on over the facts after it', async () => {
    write(
      'facts/acme.md',
      ACME.replace(
        '> Shipped appointment reminder texts.',
        '> Shipped appointment reminder texts.\n```\nnever closed',
      ),
    );
    const before = read('facts/acme.md');
    answered({ [OFFER]: 'Only at two clinics' });
    await expect(
      tool('save_fact')({
        ...FACT,
        title: 'Reminder texts',
        replaces: 'Reminder texts',
        wording: 'Piloted reminder texts at two clinics.',
        keywords: 'reminder texts',
        questions: [OFFER],
      }),
    ).rejects.toThrow('isn’t closed, so it runs on into what follows');
    expect(read('facts/acme.md')).toBe(before);
  });

  it('can’t be made to change a confirmed fact, even by a target that points at one', () => {
    const facts = new FactBankFiles({
      workspace: root,
      name: () => 'Alex',
      today: () => '2026-10-14',
    });
    const bank = facts.read();
    const platform = bank.files
      .find((file) => file.path === 'facts/acme.md')
      ?.blocks.find((block) => block.title === 'Scheduling platform');
    if (!platform) throw new Error('No claim');
    const result = facts.fileClaim(
      'facts/acme.md',
      '### Scheduling platform\n`unconfirmed` `live` `solo` `high`\n> Built it alone.',
      { path: 'facts/acme.md', index: platform.index, text: platform.text, unique: true },
    );
    expect(result).toEqual({
      ok: false,
      message: 'Only a fact that waits to be verified can be replaced.',
    });
    expect(read('facts/acme.md')).toBe(ACME);
  });

  it('never starts a file of projects through a link', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'factwright-outside-'));
    try {
      rmSync(join(root, 'facts'), { recursive: true });
      symlinkSync(outside, join(root, 'facts'));
      answered({ [GRAPHQL]: 'Yes, in production' });
      await expect(tool('save_fact')({ ...FACT, file: 'facts/projects.md' })).rejects.toThrow(
        'Not saved',
      );
      expect(() => readFileSync(join(outside, 'projects.md'))).toThrow();
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe('keepsConfirmed', () => {
  it('knows when a change keeps every confirmed claim as written', () => {
    const added = `${ACME}\n### New\n\`unconfirmed\` \`live\`\n> New.\n`;
    expect(keepsConfirmed(ACME, added)).toBe(true);
    expect(keepsConfirmed(ACME, ACME.replace('40 clinics', '400 clinics'))).toBe(false);
    expect(
      keepsConfirmed(ACME, ACME.replace('`live` `led-and-built`', '`unconfirmed` `live`')),
    ).toBe(false);
    expect(keepsConfirmed(ACME, ACME.replace('### Reminder texts', '### Reminders'))).toBe(true);
    // Two of the same, then one, is a claim gone.
    const twice = `${ACME}\n### Scheduling platform\n\`live\` \`led-and-built\` \`high\`\n> Built a scheduling platform used by 40 clinics.\n- **Source:** Alex 2026-10-01\n`;
    expect(keepsConfirmed(twice, ACME)).toBe(false);
  });
});

describe('save_gap', () => {
  it('notes a no under Doesn’t have, with the user’s answer and the question', async () => {
    answered({ [KAFKA]: 'No' });
    expect(
      await tool('save_gap')({ topic: 'Kafka', question: KAFKA, job: JOB, task: 'resume' }),
    ).toBe(
      'Noted in facts/gaps.md, under Doesn’t have: “Kafka”, from the user’s answer “No”. Don’t claim it, and don’t ask about it again.',
    );
    expect(read('facts/gaps.md')).toBe(
      GAPS.replace(
        '| Rust in production | No | 2026-10-12 |\n',
        `| Rust in production | No | 2026-10-12 |\n| Kafka | No (asked “${KAFKA}” while tailoring a resume for Acme Robotics) | 2026-10-14 |\n`,
      ),
    );
    expect(filed).toHaveBeenCalledWith({ facts: [], gaps: 1 });
    // The same topic again stays as it was, and uses up nothing.
    const asked = 'Have you used Kafka Streams?';
    answered({ [asked]: 'No' });
    expect(await tool('save_gap')({ topic: 'kafka', question: asked })).toBe(
      '“kafka” is in facts/gaps.md under Doesn’t have already.',
    );
    expect(await tool('save_gap')({ topic: 'Kafka Streams', question: asked })).toMatch(/^Noted/);
  });

  it('starts gaps.md when there’s none, and files nothing the user wasn’t asked', async () => {
    rmSync(join(root, 'facts', 'gaps.md'));
    await expect(tool('save_gap')({ topic: 'Kafka', question: KAFKA })).rejects.toThrow(
      'Factwright has no record of the user answering',
    );
    answered({ [KAFKA]: 'No' });
    await tool('save_gap')({ topic: 'Kafka', question: KAFKA });
    expect(read('facts/gaps.md')).toContain(`| Kafka | No (asked “${KAFKA}”) | 2026-10-14 |`);
  });

  it('notes nothing from a yes, a pick about using a fact, or a topic nobody asked about', async () => {
    answered({ [KAFKA]: 'Yes, in production' });
    await expect(tool('save_gap')({ topic: 'Kafka', question: KAFKA })).rejects.toThrow(
      'Not saved: the user answered “Yes, in production”, a yes. Save what they have with save_fact instead.',
    );
    answered({ [OFFER]: "Don't use" });
    await expect(tool('save_gap')({ topic: 'reminder texts', question: OFFER })).rejects.toThrow(
      'answers whether to use a fact',
    );
    answered({ [GRAPHQL]: 'No' });
    await expect(tool('save_gap')({ topic: 'Python', question: GRAPHQL })).rejects.toThrow(
      'Not saved: “Python” isn’t in the question or the user’s answer.',
    );
    expect(read('facts/gaps.md')).toBe(GAPS);
  });

  it('notes one gap for each answer, even asked for twice at once', async () => {
    answered({ [KAFKA]: 'No' });
    const results = await Promise.allSettled([
      tool('save_gap')({ topic: 'Kafka', question: KAFKA }),
      tool('save_gap')({ topic: 'event streaming', question: KAFKA }),
    ]);
    expect(results.map((each) => each.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(read('facts/gaps.md').match(/\| Kafka \||\| event streaming \|/g)).toHaveLength(1);
  });
});

describe('verify_fact', () => {
  const VERIFY = { file: 'facts/acme.md', title: 'Reminder texts', question: OFFER };

  it('verifies a fact on the user’s own pick, as the app does', async () => {
    answered({ [OFFER]: 'Use and verify' });
    expect(await tool('verify_fact')(VERIFY)).toBe(
      'Verified “Reminder texts”, on the user’s pick. Use it as any verified fact.',
    );
    expect(read('facts/acme.md')).toBe(
      ACME.replace(
        '`unconfirmed` `shipped` `solo` `medium`\n> Shipped appointment reminder texts.\n- **Source:** resume alex.pdf 2026-10-10',
        '`shipped` `solo` `medium`\n> Shipped appointment reminder texts.\n- **Source:** Alex 2026-10-14',
      ),
    );
  });

  it('verifies nothing on any other answer, or with notes the user added', async () => {
    answered({ [OFFER]: 'Use this once' });
    await expect(tool('verify_fact')(VERIFY)).rejects.toThrow(
      'Not verified: the user answered “Use this once”, not “Use and verify”.',
    );
    answered({ [OFFER]: 'Use and verify' }, { [OFFER]: 'It was two clinics, not all' });
    await expect(tool('verify_fact')(VERIFY)).rejects.toThrow(
      'Not verified: the user added “It was two clinics, not all”. Correct the fact with save_fact and replaces',
    );
    expect(read('facts/acme.md')).toBe(ACME);
  });

  it('verifies only the tags the user saw, and only the one fact by that title', async () => {
    const untagged =
      'Your fact bank has “Reminder texts”: “Shipped appointment reminder texts.” Can I use it?';
    answered({ [untagged]: 'Use and verify' });
    await expect(tool('verify_fact')({ ...VERIFY, question: untagged })).rejects.toThrow(
      'Not verified: the question doesn’t say the fact is shipped.',
    );
    // Tags count only where the question says them, not inside the words it quotes.
    write(
      'facts/acme.md',
      ACME.replace(
        '`unconfirmed` `shipped` `solo` `medium`\n> Shipped appointment reminder texts.',
        '`unconfirmed` `live` `solo` `high`\n> Solo, live, high-volume reminder texts.',
      ),
    );
    const sneaky =
      'Your fact bank has “Reminder texts”: “Solo, live, high-volume reminder texts.” Can I use it?';
    answered({ [sneaky]: 'Use and verify' });
    await expect(tool('verify_fact')({ ...VERIFY, question: sneaky })).rejects.toThrow(
      'Not verified: the question doesn’t say the fact is live.',
    );
    const twice = `${sneaky} Again: “Solo, live, high-volume reminder texts.”`;
    answered({ [twice]: 'Use and verify' });
    await expect(tool('verify_fact')({ ...VERIFY, question: twice })).rejects.toThrow(
      'Not verified: the question doesn’t say the fact is live.',
    );
    write('facts/acme.md', ACME);
    // A copy waiting elsewhere, with the same title and words, could be the one meant.
    write(
      'facts/projects.md',
      '# Projects\n\n### Reminder texts\n`unconfirmed` `shipped` `led-team` `high`\n> Shipped appointment reminder texts.\n',
    );
    answered({ [OFFER]: 'Use and verify' });
    await expect(tool('verify_fact')(VERIFY)).rejects.toThrow(
      'Not verified: more than one fact waiting to be verified is titled “Reminder texts”.',
    );
    expect(read('facts/acme.md')).toBe(ACME);
  });

  it('verifies only the words the user saw, in a question naming the fact', async () => {
    const vague = 'Can I use Reminder texts, the fact about texts?';
    answered({ [vague]: 'Use and verify' });
    await expect(tool('verify_fact')({ ...VERIFY, question: vague })).rejects.toThrow(
      'Not verified: the question doesn’t name “Reminder texts”.',
    );
    const titleOnly = 'Can I use “Reminder texts”?';
    answered({ [titleOnly]: 'Use and verify' });
    await expect(tool('verify_fact')({ ...VERIFY, question: titleOnly })).rejects.toThrow(
      'Not verified: the question doesn’t quote what “Reminder texts” says now.',
    );
    await expect(tool('verify_fact')({ ...VERIFY, question: GRAPHQL })).rejects.toThrow(
      'Factwright has no record of the user answering',
    );
    expect(read('facts/acme.md')).toBe(ACME);
  });

  it('never verifies a fact this run saved, or put new words in', async () => {
    // A fact titled as the question quotes the old words, saved with words of its own, isn't
    // what the user saw.
    answered({ [OFFER]: 'Use and verify' });
    const planted = 'Shipped appointment reminder texts.';
    answered({ [GRAPHQL]: 'Yes, in production' });
    await tool('save_fact')({ ...FACT, file: 'facts/projects.md', title: planted });
    await expect(
      tool('verify_fact')({ file: 'facts/projects.md', title: planted, question: OFFER }),
    ).rejects.toThrow(`Not verified: “${planted}” was saved in this run`);
    // And one this run corrected is the user's to verify in the Fact bank.
    const corrected = `${OFFER} Or is it out of date?`;
    answered({ [corrected]: 'Only at two clinics' });
    await tool('save_fact')({
      ...FACT,
      title: 'Reminder texts',
      replaces: 'Reminder texts',
      wording: 'Piloted reminder texts at two clinics.',
      keywords: 'reminder texts',
      questions: [corrected],
    });
    await expect(tool('verify_fact')(VERIFY)).rejects.toThrow(
      'Not verified: “Reminder texts” was saved in this run',
    );
  });

  it('says when a fact is verified already, or not there', async () => {
    const asked =
      'Can I use “Scheduling platform”: “Built a scheduling platform used by 40 clinics.”?';
    answered({ [asked]: 'Use and verify' });
    expect(
      await tool('verify_fact')({
        file: 'facts/acme.md',
        title: 'Scheduling platform',
        question: asked,
      }),
    ).toBe('“Scheduling platform” is verified already.');
    const missing = 'Can I use “Night shifts”?';
    answered({ [missing]: 'Use and verify' });
    await expect(
      tool('verify_fact')({ file: 'facts/acme.md', title: 'Night shifts', question: missing }),
    ).rejects.toThrow('Not verified: facts/acme.md has no fact titled “Night shifts”.');
  });
});
