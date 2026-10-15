import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import type { FiledFacts } from '../../shared/facts.ts';
import { FactBankFiles, keepsConfirmed } from '../about/facts.ts';
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

const tool = (name: string) => {
  const found = tools.find((each) => each.name === name);
  if (!found) throw new Error(`No tool ${name}`);
  return (input: Record<string, unknown>) => found.run(input, call);
};

/** A question round the user answered, as Claude Code's hooks report it. */
function answered(answers: Record<string, string>, notes: Record<string, string> = {}) {
  const id = `toolu_${++rounds}`;
  const questions = Object.keys(answers).map((question) => ({
    question,
    header: 'Experience',
    options: [
      { label: 'Yes, in production', description: '' },
      { label: 'No', description: '' },
    ],
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
  wording: 'Built and ran the partner API in GraphQL, used by 30 partners.',
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
    expect(await tool('save_fact')({ ...FACT, questions: [GRAPHQL, WHERE] })).toBe(
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
      facts: [{ path: 'facts/acme.md', title: 'GraphQL for the partner API' }],
      gaps: 0,
    });
  });

  it('keeps the user’s notes with their answer, and leaves out the job when there’s none', async () => {
    answered({ [GRAPHQL]: 'Yes, in production' }, { [GRAPHQL]: 'Two years' });
    await tool('save_fact')({ ...FACT, job: undefined, task: undefined });
    const text = read('facts/acme.md');
    expect(text).toContain('- **Source:** answer 2026-10-14\n');
    expect(text).toContain('- **Answer:** Yes, in production (Two years)\n');
  });

  it('files nothing the user wasn’t asked, or was asked some other way', async () => {
    await expect(tool('save_fact')(FACT)).rejects.toThrow(
      'Not saved: Factwright has no record of the user answering “Have you used GraphQL in production?” in this run. Facts from answers come only from questions you asked with AskUserQuestion, given word for word. The user hasn’t answered any questions in this run yet.',
    );
    answered({ [KAFKA]: 'No' });
    await expect(tool('save_fact')(FACT)).rejects.toThrow(`Answered so far: “${KAFKA}”.`);
    expect(read('facts/acme.md')).toBe(ACME);
    expect(filed).not.toHaveBeenCalled();
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
    await expect(tool('save_fact')({ ...FACT, questions: [] })).rejects.toThrow('Give questions');
    await expect(tool('save_fact')({ ...FACT, job: 'nobody--nothing' })).rejects.toThrow(
      'Nothing on file for nobody--nothing.',
    );
    await expect(tool('save_fact')({ ...FACT, title: 'Scheduling platform' })).rejects.toThrow(
      'Not saved: facts/acme.md has a fact titled “Scheduling platform” already.',
    );
  });

  it('lets one answer back a few facts, and no more', async () => {
    answered({ [GRAPHQL]: 'Yes, in production' });
    for (let i = 1; i <= 4; i++) await tool('save_fact')({ ...FACT, title: `Fact ${i}` });
    await expect(tool('save_fact')({ ...FACT, title: 'Fact 5' })).rejects.toThrow(
      'has been used for as much as one answer can back',
    );
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
      facts: [{ path: 'facts/acme.md', title: 'GraphQL partner API' }],
      gaps: 0,
    });

    const correction = 'Is “Reminder texts” right: Shipped appointment reminder texts?';
    answered({ [correction]: 'Only to two clinics, as a pilot' });
    await tool('save_fact')({
      ...FACT,
      title: 'Reminder texts',
      replaces: 'Reminder texts',
      status: 'beta',
      wording: 'Piloted appointment reminder texts at two clinics.',
      questions: [correction],
    });
    expect(read('facts/acme.md')).toContain(
      '### Reminder texts\n`unconfirmed` `beta` `solo` `medium`\n> Piloted appointment reminder texts at two clinics.',
    );
  });

  it('claims nothing from a plain no', async () => {
    answered({ [KAFKA]: 'No' });
    await expect(tool('save_fact')({ ...FACT, questions: [KAFKA] })).rejects.toThrow(
      `Not saved: the user answered “No” to “${KAFKA}”. Save that with save_gap, and claim nothing from it.`,
    );
    // A no with more to it can still back a fact, such as about what they used instead.
    answered({ [GRAPHQL]: 'No, but REST at scale' });
    expect(await tool('save_fact')({ ...FACT, questions: [GRAPHQL] })).toMatch(/^Saved/);
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
        questions: [passing],
      }),
    ).rejects.toThrow('wasn’t filed in this run, and no answer here is about it');
    expect(read('facts/acme.md')).toBe(ACME);
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
    answered({ [GRAPHQL]: 'No' });
    expect(await tool('save_gap')({ topic: 'kafka', question: GRAPHQL })).toBe(
      '“kafka” is in facts/gaps.md under Doesn’t have already.',
    );
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

  it('notes nothing from a yes', async () => {
    answered({ [KAFKA]: 'Yes, in production' });
    await expect(tool('save_gap')({ topic: 'Kafka', question: KAFKA })).rejects.toThrow(
      'Not saved: the user answered “Yes, in production”, a yes. Save what they have with save_fact instead.',
    );
    expect(read('facts/gaps.md')).toBe(GAPS);
  });

  it('notes one gap for each answer', async () => {
    answered({ [KAFKA]: 'No' });
    await tool('save_gap')({ topic: 'Kafka', question: KAFKA });
    await expect(tool('save_gap')({ topic: 'Pulsar', question: KAFKA })).rejects.toThrow(
      'has been used for as much as one answer can back',
    );
  });
});

describe('verify_fact', () => {
  const ASKED =
    'Your fact bank has “Reminder texts”: “Shipped appointment reminder texts.” Can I use it?';

  it('verifies a fact on the user’s own pick, as the app does', async () => {
    answered({ [ASKED]: 'Use and verify' });
    expect(
      await tool('verify_fact')({
        file: 'facts/acme.md',
        title: 'Reminder texts',
        question: ASKED,
      }),
    ).toBe('Verified “Reminder texts”, on the user’s pick. Use it as any verified fact.');
    expect(read('facts/acme.md')).toBe(
      ACME.replace(
        '`unconfirmed` `shipped` `solo` `medium`\n> Shipped appointment reminder texts.\n- **Source:** resume alex.pdf 2026-10-10',
        '`shipped` `solo` `medium`\n> Shipped appointment reminder texts.\n- **Source:** Alex 2026-10-14',
      ),
    );
  });

  it('verifies nothing on any other answer, or a question that doesn’t name it', async () => {
    answered({ [ASKED]: 'Use this once' });
    await expect(
      tool('verify_fact')({ file: 'facts/acme.md', title: 'Reminder texts', question: ASKED }),
    ).rejects.toThrow('Not verified: the user answered “Use this once”, not “Use and verify”.');
    const vague = 'Can I use Reminder texts, the fact about texts?';
    answered({ [vague]: 'Use and verify' });
    await expect(
      tool('verify_fact')({ file: 'facts/acme.md', title: 'Reminder texts', question: vague }),
    ).rejects.toThrow('Not verified: the question doesn’t name “Reminder texts”.');
    await expect(
      tool('verify_fact')({ file: 'facts/acme.md', title: 'Reminder texts', question: GRAPHQL }),
    ).rejects.toThrow('Factwright has no record of the user answering');
    expect(read('facts/acme.md')).toBe(ACME);
  });

  it('says when a fact is verified already, or not there', async () => {
    const asked = 'Can I use “Scheduling platform”?';
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
