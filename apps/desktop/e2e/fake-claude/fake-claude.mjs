// A stand-in for Claude Code, for the end-to-end tests. It answers the app's version and
// sign-in checks, and in a run it talks to the app the way Claude Code does: it reaches
// Factwright's tools with the run's token, and sends the prompt, Stop and session-end hooks. It
// never reaches Anthropic. FAKE_CLAUDE_TRUST=ask makes it ask whether to trust the folder first,
// and FAKE_CLAUDE_PLAN=pro signs it in on a Pro plan rather than Max.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);

if (args[0] === '--version') {
  console.log('2.1.300 (Claude Code)');
  process.exit(0);
}
if (args[0] === 'auth' && args[1] === 'status') {
  // A profile's own Claude Code folder is signed in only once a test signs it in, as
  // `claude auth login` would. Without one, it's the user's own Claude Code, signed in.
  const folder = process.env.CLAUDE_CONFIG_DIR;
  if (folder && !existsSync(join(folder, 'signed-in'))) {
    console.log(JSON.stringify({ loggedIn: false, authMethod: 'none' }));
    process.exit(1);
  }
  const plan = process.env.FAKE_CLAUDE_PLAN ?? 'max';
  console.log(JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', subscriptionType: plan }));
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

/** Calls one of Factwright's tools, as Claude Code does, and gives back its text. */
async function call(name, args) {
  const response = await post(tools.url, {
    jsonrpc: '2.0',
    id: Date.now(),
    method: 'tools/call',
    params: { name, arguments: args },
  });
  const { result } = await response.json();
  return result?.content?.[0]?.text ?? '';
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
  const lettered = text.match(/^\/factwright:cover-letter job (\S+)$/);
  if (lettered) {
    const details = await call('job_details', { job: lettered[1] });
    const folder = details.match(/^- Folder: applications\/([^/\s]+)\/$/m)?.[1];
    if (folder) {
      writeFileSync(
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
  // As Claude would while tailoring a resume: ask about what the posting wants that the facts
  // don't show, then save the user's answers to the fact bank.
  const tailoring = text.match(/^\/factwright:focused-resume job (\S+)/);
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
      writeFileSync(
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
  // As Claude would for a search of LinkedIn: write the run's report in a folder of its own,
  // in the workspace it runs in.
  if (/^\/factwright:job-search .*\bLinkedIn\b/.test(text)) {
    const folder = join(process.cwd(), 'searches', '2026-10-12-linkedin');
    mkdirSync(folder, { recursive: true });
    writeFileSync(
      join(folder, 'jobs.json'),
      JSON.stringify({
        meta: { source: 'LinkedIn Oct 12', checked: '2026-10-12' },
        jobs: [
          {
            company: 'Lakeside Data',
            role: 'Senior Platform Engineer',
            posting: 'https://boards.greenhouse.io/lakeside/jobs/1',
            tier: 'strong',
            score: 81,
            why: ['Platform work, from the stand-in Claude'],
          },
        ],
      }),
    );
  }
  // As Claude would for a search for one kind of job: say which kind the jobs it found are.
  const forKind = text.match(/^\/factwright:job-search for ([a-z0-9-]+): /);
  if (forKind) {
    const folder = join(process.cwd(), 'searches', `2026-10-12-hn-${forKind[1]}`);
    mkdirSync(folder, { recursive: true });
    writeFileSync(
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
  // As Claude would, asked to save what the user said to their profile, which Claude Code asks
  // their OK for first: saved on a yes, and not on a no, which says what they added.
  if (text === 'save my notice period') {
    const tool = 'mcp__factwright__save_about_you';
    const input = { start: 'Two weeks’ notice' };
    const decision = await permission(tool, input);
    if (decision?.behavior === 'allow') {
      show(`${await call('save_about_you', input)}\n`);
      await hook('PostToolUse', { tool_name: tool, tool_input: input, tool_response: {} });
    } else if (decision?.behavior === 'deny') {
      show(`Not saved: ${decision.message}\n`);
    } else {
      show('Claude Code asked in the terminal.\n');
    }
  }
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
  // Its turn ends a moment later, with Stop, before it takes the next prompt, as Claude Code's does.
  await new Promise((resolve) => setTimeout(resolve, 300));
  show('Done.\n> ');
  await hook('Stop');
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
  if (askingTrust) {
    askingTrust = false;
    await begin();
    return;
  }
  const line = typed.trim();
  typed = '';
  // One prompt at a time, as Claude Code takes them, even if the next is typed while it works.
  if (line) working = working.then(() => work(line));
});
process.on('SIGHUP', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));

if (askingTrust) {
  show('Quick safety check: Is this a project you created or one you trust?\n');
  show('❯ 1. Yes, I trust this folder\n  2. No, exit\n');
} else {
  await begin();
}
