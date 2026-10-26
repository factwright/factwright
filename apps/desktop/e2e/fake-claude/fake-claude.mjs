// A stand-in for Claude Code, for the end-to-end tests. It answers the app's version and
// sign-in checks, and in a run it talks to the app the way Claude Code does: it reaches
// Factwright's tools with the run's token, and sends the prompt, Stop and session-end hooks. It
// never reaches Anthropic. FAKE_CLAUDE_TRUST=ask makes it ask whether to trust the folder first,
// FAKE_CLAUDE_PLAN=pro signs it in on a Pro plan rather than Max, FAKE_CLAUDE_METHOD=api_key
// signs it in with a key instead, and FAKE_CLAUDE_FIRST_RUN=show has it show Claude Code's
// first-run screens until someone presses Enter through them once, as Claude Code does.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const args = process.argv.slice(2);

if (args[0] === '--version') {
  console.log('2.1.300 (Claude Code)');
  process.exit(0);
}
// Its folder, always one of the tests' own, never the user's: a profile's own, or the one the
// tests give the first profile.
const folder = process.env.CLAUDE_CONFIG_DIR;

if (args[0] === 'auth' && args[1] === 'status') {
  // It's signed in only once a test signs it in, as `claude auth login` would.
  if (!folder || !existsSync(join(folder, 'signed-in'))) {
    console.log(JSON.stringify({ loggedIn: false, authMethod: 'none' }));
    process.exit(1);
  }
  const plan = process.env.FAKE_CLAUDE_PLAN ?? 'max';
  console.log(
    JSON.stringify(
      process.env.FAKE_CLAUDE_METHOD === 'api_key'
        ? { loggedIn: true, authMethod: 'api_key', apiKeySource: 'ANTHROPIC_API_KEY' }
        : { loggedIn: true, authMethod: 'claude.ai', subscriptionType: plan },
    ),
  );
  process.exit(0);
}

const after = (flag) => args[args.indexOf(flag) + 1];
const given = (flag) => (args.includes(flag) ? after(flag) : 'default');

// Like Claude Code, it can't start a run without the plugin and standing rules the app hands it,
// so a built app that leaves them out fails its tests.
for (const file of [
  join(after('--plugin-dir'), '.claude-plugin', 'plugin.json'),
  after('--append-system-prompt-file'),
]) {
  if (!existsSync(file)) {
    console.error(`Factwright's plugin is missing: ${file}`);
    process.exit(1);
  }
}
const settings = JSON.parse(readFileSync(after('--settings'), 'utf8'));
const tools = JSON.parse(readFileSync(after('--mcp-config'), 'utf8')).mcpServers.factwright;
const hookUrl = settings.hooks.Stop[0].hooks[0].url;
// Where Claude Code says each tool call is starting: the one PreToolUse hook every call has.
const activityUrl = settings.hooks.PreToolUse.find((group) => !group.matcher)?.hooks[0]?.url;
const token = process.env.FACTWRIGHT_RUN_TOKEN;
// The app puts the prompt, when there is one, right after the settings file.
const prompt = args[args.indexOf('--settings') + 2];

const post = (url, body) =>
  fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
const hook = (event, fields = {}) =>
  post(hookUrl, { hook_event_name: event, session_id: 'fake', ...fields }).catch(() => {});
const show = (text) => process.stdout.write(text.replace(/\n/g, '\r\n'));

/**
 * Calls one of the tools that file the user's answers, as Claude Code does: its PreToolUse hook
 * first, from the run's own Claude, or from a subagent.
 */
async function file(name, args, { agent } = {}) {
  await hook('PreToolUse', {
    tool_name: `mcp__factwright__${name}`,
    tool_use_id: `toolu_${name}_${Date.now()}`,
    tool_input: args,
    ...(agent && { agent_id: agent }),
  });
  return call(name, args);
}

/**
 * Calls one of Factwright's tools, as Claude Code does, and gives back its text: its start to the
 * hook every call has, then, once it's run, PostToolUse.
 */
async function call(name, args) {
  const step = {
    tool_name: `mcp__factwright__${name}`,
    tool_use_id: `toolu_${name}_${Date.now()}`,
    tool_input: args,
  };
  if (activityUrl) {
    await post(activityUrl, { hook_event_name: 'PreToolUse', session_id: 'fake', ...step }).catch(
      () => {},
    );
  }
  const response = await post(tools.url, {
    jsonrpc: '2.0',
    id: Date.now(),
    method: 'tools/call',
    params: { name, arguments: args },
  });
  const { result } = await response.json();
  const text = result?.content?.[0]?.text ?? '';
  await hook('PostToolUse', { ...step, tool_response: text });
  return text;
}

/**
 * Writes a file as Claude Code's Write tool does: its start to the hook every call has, which the
 * app holds while it keeps the file as it was, then the file, then PostToolUse.
 */
async function writeAsClaude(path, text) {
  const step = {
    tool_name: 'Write',
    tool_use_id: `toolu_write_${Date.now()}`,
    tool_input: { file_path: path, content: text },
  };
  if (activityUrl) {
    await post(activityUrl, { hook_event_name: 'PreToolUse', session_id: 'fake', ...step }).catch(
      () => {},
    );
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  await hook('PostToolUse', { ...step, tool_response: { type: 'create', filePath: path } });
}

/**
 * A call to one of Claude Code's own tools, as its hooks tell it: its start to the hook every
 * call has, then, unless it's left going, PostToolUse with what it gave back.
 */
async function claudeCall(step, answer, { going = false } = {}) {
  if (activityUrl) {
    await post(activityUrl, { hook_event_name: 'PreToolUse', session_id: 'fake', ...step }).catch(
      () => {},
    );
  }
  if (!going) await hook('PostToolUse', { ...step, tool_response: answer });
}

/** The next line the user types, while a turn waits for one, or null while none does. */
let lineWaiter = null;
const nextLine = () =>
  new Promise((resolve) => {
    lineWaiter = resolve;
  });

/**
 * As Claude does with a task in several steps and helpers: a to-do list with the Task tools, then
 * two helpers in the background, each on a step of its own, and a turn that ends while they work,
 * as Claude Code's does. They're back, and Claude finishes, once the user types another line.
 */
async function planWithHelpers() {
  const items = [
    ['Read the posting', 'Reading the posting'],
    ['Filter the listings', 'Filtering the listings'],
    ['Write the report', 'Writing the report'],
  ];
  for (const [at, [subject, activeForm]] of items.entries()) {
    const id = String(at + 1);
    await claudeCall(
      {
        tool_name: 'TaskCreate',
        tool_use_id: `toolu_create_${id}`,
        tool_input: { subject, description: subject, activeForm },
      },
      { task: { id, subject } },
    );
  }
  const update = (taskId, status) =>
    claudeCall(
      {
        tool_name: 'TaskUpdate',
        tool_use_id: `toolu_update_${taskId}_${status}`,
        tool_input: { taskId, status },
      },
      { success: true, taskId, updatedFields: ['status'] },
    );
  await update('1', 'completed');
  await update('2', 'in_progress');
  const helpers = [
    ['agent-fake-1', 'Filter listings 1–50'],
    ['agent-fake-2', 'Filter listings 51–100'],
  ];
  const listings = join(process.cwd(), 'searches', 'listings.md');
  const reading = (agent) => ({
    agent_id: agent,
    agent_type: 'general-purpose',
    tool_name: 'Read',
    tool_use_id: `toolu_read_${agent}`,
    tool_input: { file_path: listings },
  });
  for (const [agent, description] of helpers) {
    const launch = {
      tool_name: 'Agent',
      tool_use_id: `toolu_${agent}`,
      tool_input: {
        description,
        prompt: 'Filter these listings.',
        subagent_type: 'general-purpose',
      },
    };
    await claudeCall(launch, null, { going: true });
    await hook('SubagentStart', { agent_id: agent, agent_type: 'general-purpose' });
    await hook('PostToolUse', {
      ...launch,
      tool_response: { isAsync: true, status: 'async_launched', agentId: agent, description },
    });
    await claudeCall(reading(agent), null, { going: true });
  }
  show('Two helpers are filtering the listings.\n> ');
  await hook('Stop', {
    last_assistant_message: 'Two helpers are filtering the listings.',
    background_tasks: helpers.map(([id, description]) => ({
      id,
      type: 'subagent',
      status: 'running',
      description,
      agent_type: 'general-purpose',
    })),
    session_crons: [],
  });
  await nextLine();
  for (const [agent] of helpers) {
    await hook('PostToolUse', { ...reading(agent), tool_response: { type: 'text' } });
    await hook('SubagentStop', { agent_id: agent, agent_type: 'general-purpose' });
  }
  await update('2', 'completed');
  await update('3', 'in_progress');
  await update('3', 'completed');
  show('The report is written.\n> ');
  await hook('Stop', {
    last_assistant_message: 'The report is written.',
    background_tasks: [],
    session_crons: [],
  });
}

/**
 * Calls one of Factwright's tools as Claude Code does with the run's settings: without asking
 * when they allow it, and otherwise after the user's OK. Gives back its text, or what came of
 * asking.
 */
async function callAllowed(name, args) {
  const tool = `mcp__factwright__${name}`;
  if (settings.permissions.allow.includes(tool)) return call(name, args);
  const decision = await permission(tool, args);
  if (decision?.behavior === 'allow') return call(name, args);
  return decision?.behavior === 'deny'
    ? `Not saved: ${decision.message}`
    : 'Claude Code asked in the terminal.';
}

/** The answer it gives to every question about a job. */
const ANSWER = 'A short screen, from the stand-in Claude.';

/** What it asks while tailoring a resume, and what the user answers in Claude Code's dialog. */
const GRAPHQL = 'The posting wants GraphQL. Have you used GraphQL?';
const KAFKA = 'The posting wants Kafka. Have you run Kafka, or another event-streaming platform?';
const CHOICES = ['Yes, in production', 'Some: a side project, a course, or an earlier role', 'No'];

/**
 * As Claude Code does for a question round: PreToolUse with the questions as Claude wrote them,
 * which the app holds while the user answers in its dialog. A hook that answers "allow" with the
 * answers has the round run with them, and nothing is asked in the terminal. With no answers from
 * the hook, the user answers in the terminal, as `answers` says. Then PostToolUse, with what they
 * answered.
 */
async function askUser(answers) {
  const id = `toolu_${Date.now()}`;
  const questions = Object.keys(answers).map((question) => ({
    question,
    header: 'Experience',
    options: CHOICES.map((label) => ({ label, description: '' })),
    multiSelect: false,
  }));
  const asked = await post(hookUrl, {
    hook_event_name: 'PreToolUse',
    session_id: 'fake',
    tool_name: 'AskUserQuestion',
    tool_use_id: id,
    tool_input: { questions },
  });
  const decision = asked.status === 200 ? (await asked.json()).hookSpecificOutput : undefined;
  const fromHook = decision?.permissionDecision === 'allow' && decision.updatedInput?.answers;
  if (!fromHook) show('Claude Code asked in the terminal.\n');
  const round = fromHook ? decision.updatedInput : { questions, answers };
  const noted = Object.entries(round.answers).map(
    ([question, answer]) => `  · ${question} → ${answer}`,
  );
  show(`User answered Claude's questions:\n${noted.join('\n')}\n`);
  await hook('PostToolUse', {
    tool_name: 'AskUserQuestion',
    tool_use_id: id,
    tool_input: round,
    tool_response: round,
  });
}

/**
 * Asks a question anyway, as Claude would if a skill's words slipped: PreToolUse with the round,
 * as Claude Code sends it, for the app to hold for its dialog or turn away. Gives back what
 * Claude reads when the hook turns it away.
 */
async function askAnyway(question) {
  const asked = await post(hookUrl, {
    hook_event_name: 'PreToolUse',
    session_id: 'fake',
    tool_name: 'AskUserQuestion',
    tool_use_id: `toolu_${Date.now()}`,
    tool_input: {
      questions: [
        {
          question,
          header: 'Experience',
          options: CHOICES.map((label) => ({ label, description: '' })),
          multiSelect: false,
        },
      ],
    },
  });
  const decision = asked.status === 200 ? (await asked.json()).hookSpecificOutput : undefined;
  return decision?.permissionDecision === 'deny'
    ? `Not asked: ${decision.permissionDecisionReason}`
    : 'Claude Code asked anyway.';
}

/**
 * As Claude Code does for a call that needs the user's OK: PreToolUse, then a PermissionRequest
 * hook, which the app holds while the user answers in its dialog. Gives back the hook's decision,
 * or nothing when the hook left it to the terminal.
 */
async function permission(tool, input) {
  await hook('PreToolUse', {
    tool_name: tool,
    tool_use_id: `toolu_${Date.now()}`,
    tool_input: input,
  });
  const asked = await post(hookUrl, {
    hook_event_name: 'PermissionRequest',
    session_id: 'fake',
    tool_name: tool,
    tool_input: input,
    permission_suggestions: [],
  });
  return asked.status === 200 ? (await asked.json()).hookSpecificOutput?.decision : undefined;
}

async function work(text) {
  await hook('UserPromptSubmit', { prompt: text });
  show(`> ${text}\nWorking on it…\n`);
  // As Claude would for a question about a job: read what's on file, then answer each one
  // that's waiting, with the tool that keeps the answer with the job.
  const asked = text.match(/^\/factwright:ask job (\S+)(?: question (\S+))?/);
  if (asked) {
    const [, job, named] = asked;
    const details = await call('job_details', { job });
    const waiting = [...details.matchAll(/^- (\S+) \(asked [^)]+\): not answered yet$/gm)];
    const open = waiting.map(([, each]) => each);
    // A question named again after it was answered gets a fresh answer.
    const again = named && !open.includes(named);
    for (const id of named ? [named] : open) {
      await call('save_answer', { job, question: id, answer: again ? `${ANSWER} Again.` : ANSWER });
    }
  }
  // As Claude would for the questions of a job's application form: read in job_details how the
  // form asks each one, and say so.
  const drafting = text.match(/^\/factwright:answer-questions job (\S+) form$/);
  if (drafting) {
    const details = await call('job_details', { job: drafting[1] });
    const form = details
      .split('\n')
      .filter(
        (line) =>
          /^(Factwright got|The extension read) /.test(line) || /^ {3}On the form: /.test(line),
      );
    show(`${form.join('\n')}\n`);
  }
  // As Claude would for a call's prep: read what's on file, find the call by its ID, and save a
  // sheet for it with the tool that keeps it with the call. Practice writes nothing.
  const prepping = text.match(/^\/factwright:interview-prep job (\S+) call (\S+)( practice)?$/);
  if (prepping) {
    const [, job, callId, practice] = prepping;
    const details = await call('job_details', { job });
    const lines = details.split('\n');
    const at = lines.findIndex((line) => line.endsWith(`· call ${callId}`));
    const people = lines
      .slice(at + 1)
      .find((line) => /^ {6}With /.test(line))
      ?.trim();
    if (at >= 0 && !practice) {
      const prep = `# Prep: ${lines[at]?.trim()}\n\n## Five minutes before\n- ${people ?? 'Nobody named'}, from the stand-in Claude.`;
      show(`${await call('save_call_prep', { job, call: callId, prep })}\n`);
    }
  }
  // As Claude would for a cover letter: read what's on file, write the letter in the job's
  // folder, and build it with the tool that checks it.
  const lettered = text.match(/^\/factwright:cover-letter job (\S+)(?: new version)?$/);
  if (lettered) {
    const details = await call('job_details', { job: lettered[1] });
    const folder = details.match(/^- Folder: applications\/([^/\s]+)\/$/m)?.[1];
    if (folder) {
      await writeAsClaude(
        join(process.cwd(), 'applications', folder, 'cover-letter.json'),
        JSON.stringify({
          format: 'both',
          output_name: 'AlexRiveraCoverLetter10142026_Acme',
          name: 'Alex Rivera',
          headline: 'Staff Platform Engineer',
          contact: { email: 'alex@example.com', location: 'Remote, US' },
          date: 'October 14, 2026',
          recipient: ['Sam Lee', 'Engineering Manager', 'Acme Robotics'],
          greeting: 'Dear Sam Lee,',
          paragraphs: [
            'Acme’s posting asks for someone to make the tools engineers use every day feel fast. I cut deploy time by ~40% at Tidewater, from the stand-in Claude.',
            'I would bring the same habits to your developer tools team.',
          ],
          closing: 'Best regards,',
        }),
      );
      show(await call('build_cover_letter', { folder }));
      show('\n');
    }
  }
  // As Claude would for a Projects page: read what's on file, write the page in the job's folder,
  // and build it with the tool that checks it.
  const paged = text.match(/^\/factwright:projects-page job (\S+)(?: new version)?$/);
  if (paged) {
    const details = await call('job_details', { job: paged[1] });
    const folder = details.match(/^- Folder: applications\/([^/\s]+)\/$/m)?.[1];
    if (folder) {
      await writeAsClaude(
        join(process.cwd(), 'applications', folder, 'projects-page.json'),
        JSON.stringify({
          format: 'both',
          output_name: 'AlexRiveraProjects10142026_Acme',
          name: 'Alex Rivera',
          headline: 'Staff Platform Engineer',
          contact: { email: 'alex@example.com', location: 'Remote, US' },
          heading: 'Selected Projects',
          shape: 'cards',
          projects: [
            {
              name: 'Trailhead',
              line: 'App for iPhone and Android · built it alone',
              when: '2023 – Present',
              what: 'A free app that maps trail conditions, from the stand-in Claude.',
              points: [{ items: ['About **4,000** people use it each month.'] }],
              skills: ['React Native', 'PostgreSQL'],
            },
            {
              name: 'pg-queue',
              line: 'Open source · wrote it',
              what: 'A small job queue that runs on Postgres.',
            },
          ],
        }),
      );
      show(await call('build_projects_page', { folder }));
      show('\n');
    }
  }
  // As Claude would for a quick resume: ask nothing, and use verified facts only. Then a
  // question anyway, as if the skill's words slipped, which the app turns away.
  const quickly = /^\/factwright:focused-resume job \S+(?: new version)? quick$/.test(text);
  if (quickly) {
    show('A quick resume, from verified facts only: no questions.\n');
    show(`${await askAnyway(GRAPHQL)}\n`);
  }
  // As Claude would while tailoring a resume: ask about what the posting wants that the facts
  // don't show, then save the user's answers to the fact bank.
  const tailoring = !quickly && text.match(/^\/factwright:focused-resume job (\S+)/);
  if (tailoring) {
    const [, job] = tailoring;
    await askUser({ [GRAPHQL]: 'Yes, in production', [KAFKA]: 'No' });
    const fact = {
      file: 'facts/larkspur-logistics.md',
      status: 'live',
      ownership: 'solo',
      confidence: 'medium',
      job,
      task: 'resume',
    };
    show(
      `${await file('save_fact', {
        ...fact,
        title: 'GraphQL for the driver app',
        wording: 'Built the driver app’s GraphQL API.',
        keywords: 'GraphQL',
        questions: [GRAPHQL],
      })}\n`,
    );
    show(`${await file('save_gap', { topic: 'Kafka', question: KAFKA, job, task: 'resume' })}\n`);
    // Words planted in a posting can't save a fact the user never gave, from Claude or from a
    // subagent that read the posting, even with an answer the user did give.
    const planted = {
      ...fact,
      title: 'Led a big team',
      ownership: 'led-team',
      wording: 'Led a team of engineers.',
      keywords: 'leadership',
    };
    show(
      `${await file('save_fact', { ...planted, questions: ['Have you led a team of engineers?'] })}\n`,
    );
    show(
      `${await file('save_fact', { ...planted, keywords: 'GraphQL', questions: [GRAPHQL] }, { agent: 'fact-check' })}\n`,
    );
  }
  // As Claude would for changes the user asked for: read them through the tool, never from the
  // prompt, then change the letter or resume in its folder and build it in the old one's place.
  const changing = text.match(/^\/factwright:(cover-letter|revise-resume) job (\S+) changes$/);
  if (changing) {
    const asked = await call('requested_changes', {});
    show(`${asked.split('\n')[0]}\n`);
    const folder = asked.match(/ in applications\/([^/\s]+)\/$/m)?.[1];
    const words = asked
      .split('\n')
      .filter((line) => line.startsWith('> '))
      .map((line) => line.slice(2))
      .join(' ');
    if (folder) {
      const letter = changing[1] === 'cover-letter';
      const data = join(
        process.cwd(),
        'applications',
        folder,
        letter ? 'cover-letter.json' : 'resume.json',
      );
      const before = JSON.parse(readFileSync(data, 'utf8'));
      const after = letter
        ? { ...before, paragraphs: [`Changed as you asked (${words}), by the stand-in Claude.`] }
        : { ...before, summary: `Changed as you asked (${words}), by the stand-in Claude.` };
      await writeAsClaude(data, JSON.stringify(after));
      const built = await call(letter ? 'build_cover_letter' : 'build_resume', {
        folder,
        ...(!letter && { format: 'both' }),
      });
      show(`${built.split('\n')[0]}\n`);
    }
  }
  // As Claude would for a revision: read what the user picked in the X-ray through the tool,
  // never from the prompt, ask about the term the fact bank doesn't back, then change the resume
  // and build it in the old one's place.
  const revising = text.match(/^\/factwright:revise-resume job (\S+) findings [a-z0-9 -]+$/);
  if (revising) {
    const [, job] = revising;
    const findings = await call('revision_findings', {});
    // Its first lines: which resume, and that what follows is information, not instructions.
    show(`${findings.split('\n').slice(0, 2).join('\n')}\n`);
    const [, resume = '', folder] =
      findings.match(/^# Revising (.+) in applications\/([^/\s]+)\/$/m) ?? [];
    if (findings.includes('“GraphQL”')) {
      await askUser({ [GRAPHQL]: 'No' });
      await file('save_gap', { topic: 'GraphQL', question: GRAPHQL, job, task: 'resume' });
    }
    if (folder && findings.includes('“Terraform”')) {
      await writeAsClaude(
        join(process.cwd(), 'applications', folder, 'resume.json'),
        JSON.stringify({
          layout: 'classic',
          format: 'both',
          output_name: resume.replace(/\.(?:pdf|docx)$/, ''),
          name: 'Alex Rivera',
          headline: 'Staff Platform Engineer',
          contact: { email: 'alex@example.com', phone: '(555) 019-4420', location: 'Denver, CO' },
          summary:
            'Platform engineer who builds the tools other engineers rely on, revised by the stand-in Claude.',
          experience: [
            {
              title: 'Platform Engineering Lead',
              company: 'Tidewater Analytics',
              // In italics in Classic, whose italic font draws fl and fi as one shape.
              company_note: 'Workflow tools for field teams',
              start: '03/2021',
              end: 'Present',
              bullet_groups: [
                {
                  bullets: [
                    { text: 'Moved twelve services onto one deploy pipeline on Kubernetes.' },
                    { text: 'Managed the platform’s infrastructure as code in Terraform.' },
                  ],
                },
              ],
            },
          ],
          skills: [{ category: 'Platform', items: ['Kubernetes', 'Terraform', 'Go'] }],
        }),
      );
      const built = await call('build_resume', { folder, format: 'both' });
      show(`${built.split('\n')[0]}\n`);
    }
  }
  // As Claude would for a search of LinkedIn: write the run's report in a folder of its own, in
  // the workspace it runs in. Its listing repeats the HN search's Tidewater job, which find_job
  // names, so it gives that job's id. Run again, it keeps the first run's file and writes the
  // next beside it, for the same search today, finding Tidewater under another title.
  // As Claude would for a search the user focused: read the focus with search_focus, say what it
  // is, and keep the search in a folder of its own, named for the focus, with its ID in meta.
  const focused = text.match(/^\/factwright:job-search (?:for [a-z0-9-]+, )?focus ([0-9a-f-]+): /);
  if (focused) {
    const id = focused[1];
    const focus = await call('search_focus', { focus: id });
    show(`${focus.split('\n')[0]}\n`);
    const folder = join(process.cwd(), 'searches', `2026-10-12-linkedin-focus-${id.slice(11)}`);
    await writeAsClaude(
      join(folder, 'jobs.json'),
      JSON.stringify({
        meta: { source: 'LinkedIn Oct 12', checked: '2026-10-12', focus: id },
        jobs: [
          {
            company: 'Brightline Health',
            role: 'Founding Engineer',
            posting: 'https://jobs.ashbyhq.com/brightline/9c1e',
            tier: 'strong',
            score: 84,
            why: ['A seed-stage team, from the stand-in Claude'],
          },
        ],
      }),
    );
  }
  if (!focused && /^\/factwright:job-search .*\bLinkedIn\b/.test(text)) {
    const folder = join(process.cwd(), 'searches', '2026-10-12-linkedin');
    mkdirSync(folder, { recursive: true });
    const again = existsSync(join(folder, 'jobs.json'));
    const tidewater = again
      ? { company: 'Tidewater Analytics', role: 'Backend Engineer, Data Pipelines' }
      : {
          company: 'Tidewater Analytics',
          role: 'Sr. Backend Engineer',
          posting:
            'https://www.linkedin.com/jobs/view/sr-backend-engineer-at-tidewater-analytics-4012345678/?refId=a1&trackingId=b2',
        };
    const seen = await call('find_job', {
      company: tidewater.company,
      role: tidewater.role,
      ...(tidewater.posting && { link: tidewater.posting }),
    });
    const job = seen.match(/\(job ([a-z0-9-]+)\)/)?.[1];
    const today = new Date();
    const checked = again
      ? [today.getFullYear(), today.getMonth() + 1, today.getDate()]
          .map((part) => String(part).padStart(2, '0'))
          .join('-')
      : '2026-10-12';
    await writeAsClaude(
      join(folder, again ? 'jobs-2.json' : 'jobs.json'),
      JSON.stringify({
        meta: { source: 'LinkedIn Oct 12', checked },
        jobs: [
          ...(again
            ? []
            : [
                {
                  company: 'Lakeside Data',
                  role: 'Senior Platform Engineer',
                  posting: 'https://boards.greenhouse.io/lakeside/jobs/1',
                  tier: 'strong',
                  score: 81,
                  why: ['Platform work, from the stand-in Claude'],
                },
              ]),
          {
            ...tidewater,
            ...(job && { job }),
            tier: 'good',
            score: 70,
            flags: [job ? `Seen before: ${job}` : 'New'],
          },
        ],
      }),
    );
  }
  // As Claude would for a search for one kind of job: say which kind the jobs it found are.
  const forKind = text.match(/^\/factwright:job-search for ([a-z0-9-]+): /);
  if (forKind) {
    const folder = join(process.cwd(), 'searches', `2026-10-12-hn-${forKind[1]}`);
    await writeAsClaude(
      join(folder, 'jobs.json'),
      JSON.stringify({
        meta: { source: 'HN October 2026', checked: '2026-10-12', kind: forKind[1] },
        jobs: [
          {
            company: 'Harbor Light',
            role: 'Technical Program Manager',
            posting: 'https://boards.greenhouse.io/harborlight/jobs/2',
            tier: 'good',
            score: 72,
            why: ['Program work, from the stand-in Claude'],
          },
        ],
      }),
    );
  }
  // As Claude would, asked to save what the user said to their profile: without asking, when the
  // run's settings allow it, as they do for a run on the job hunt.
  const notice = {
    'save my notice period': 'Two weeks’ notice',
    'save a month of notice': 'One month’s notice',
    'save a month of notice, then interrupt': 'One month’s notice',
  }[text];
  if (notice) show(`${await callAllowed('save_about_you', { start: notice })}\n`);
  // As Claude would for a template: start from one of the app's, and save one of the user's own.
  if (/^\/factwright:make-template from templates\/sources\/\S+$/.test(text)) {
    const classic = await call('read_template', { id: 'classic' });
    const file = JSON.parse(classic.slice(classic.indexOf('{'), classic.lastIndexOf('}') + 1));
    show(
      await call('save_template', {
        id: 'liked-look',
        template: {
          ...file,
          name: 'Liked Look',
          look: 'Navy headings, copied by the stand-in Claude.',
          css: `${file.css}\nh2{color:#1f3a5f}`,
        },
      }),
    );
    show('\n');
  }
  if (text === 'plan it with helpers') {
    await planWithHelpers();
    return;
  }
  // A turn the user interrupts runs no Stop hook: Claude Code says it's waiting for them, later.
  if (text.endsWith(', then interrupt')) {
    show('Interrupted · What should Claude do instead?\n> ');
    await hook('Notification', {
      notification_type: 'idle_prompt',
      message: 'Claude is waiting for your input',
    });
    return;
  }
  // Its turn ends a moment later, with Stop, before it takes the next prompt, as Claude Code's does.
  await new Promise((resolve) => setTimeout(resolve, 300));
  show('Done.\n> ');
  await hook('Stop', { last_assistant_message: 'Done.' });
}

async function begin() {
  show(`Fake Claude Code 2.1.300 · ${given('--model')} · ${given('--effort')} effort\n`);
  await post(tools.url, { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
  const listed = await post(tools.url, { jsonrpc: '2.0', id: 2, method: 'tools/list' });
  const { result } = await listed.json();
  show(`Factwright's tools: ${result.tools.length}\n`);
  if (prompt) await work(prompt);
  else show('> ');
}

/** Its config, where Claude Code notes that someone pressed Enter through its first-run screens. */
const config = join(folder ?? '.', '.claude.json');
const readConfig = () => {
  try {
    return JSON.parse(readFileSync(config, 'utf8'));
  } catch {
    return {};
  }
};
/** Claude Code's first-run screens, as it words them, each until Enter. */
const FIRST_RUN = [
  "Let's get started.\n\nChoose the text style that looks best with your terminal\n❯ 1. Dark mode ✔\n  2. Light mode\n",
  'Security notes:\n\n1. Claude can make mistakes.\n2. Due to prompt injection risks, only use it with code you trust\n\nPress Enter to continue…\n',
];
let firstRunLeft =
  process.env.FAKE_CLAUDE_FIRST_RUN === 'show' && readConfig().hasCompletedOnboarding !== true
    ? FIRST_RUN.length
    : 0;
let askingTrust = process.env.FAKE_CLAUDE_TRUST === 'ask';
/** The prompt it's working on, which the next one waits for. */
let working = Promise.resolve();
let typed = '';
let interrupts = 0;

process.stdin.setRawMode?.(true);
process.stdin.on('data', async (chunk) => {
  const text = chunk.toString('utf8');
  // Ctrl-C twice closes it, as it does Claude Code, which ends the session.
  if (text.includes('\x03')) {
    interrupts += 1;
    if (interrupts >= 2) {
      await hook('SessionEnd', { reason: 'prompt_input_exit' });
      process.exit(0);
    }
    return;
  }
  if (!text.includes('\r')) {
    typed += text;
    return;
  }
  if (firstRunLeft > 0) {
    typed = '';
    firstRunLeft -= 1;
    if (firstRunLeft > 0) {
      show(`\x1b[H\x1b[2J${FIRST_RUN[FIRST_RUN.length - firstRunLeft]}`);
      return;
    }
    // Through them once, which Claude Code notes in its config, keeping the rest.
    writeFileSync(
      config,
      JSON.stringify({ ...readConfig(), hasCompletedOnboarding: true }, null, 2),
    );
    show('\x1b[H\x1b[2J');
    await start();
    return;
  }
  if (askingTrust) {
    askingTrust = false;
    await begin();
    return;
  }
  const line = typed.trim();
  typed = '';
  // A turn waiting on the user's next line takes it.
  if (line && lineWaiter) {
    const take = lineWaiter;
    lineWaiter = null;
    take(line);
    return;
  }
  // One prompt at a time, as Claude Code takes them, even if the next is typed while it works.
  if (line) working = working.then(() => work(line));
});
process.on('SIGHUP', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));

/** After the first-run screens: the question about trust, or the run. */
async function start() {
  if (askingTrust) {
    show('Quick safety check: Is this a project you created or one you trust?\n');
    show('❯ 1. Yes, I trust this folder\n  2. No, exit\n');
  } else {
    await begin();
  }
}

if (firstRunLeft > 0) show(FIRST_RUN[0]);
else await start();
