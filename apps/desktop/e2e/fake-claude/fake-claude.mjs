// A stand-in for Claude Code, for the end-to-end tests. It answers the app's version and
// sign-in checks, and in a run it talks to the app the way Claude Code does: it reaches
// Factwright's tools with the run's token, and sends the prompt, Stop and session-end hooks. It
// never reaches Anthropic. FAKE_CLAUDE_TRUST=ask makes it ask whether to trust the folder first.
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);

if (args[0] === '--version') {
  console.log('2.1.300 (Claude Code)');
  process.exit(0);
}
if (args[0] === 'auth' && args[1] === 'status') {
  console.log(JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', subscriptionType: 'max' }));
  process.exit(0);
}

const after = (flag) => args[args.indexOf(flag) + 1];
const given = (flag) => (args.includes(flag) ? after(flag) : 'default');
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

async function work(text) {
  await hook('UserPromptSubmit', { prompt: text });
  show(`> ${text}\nWorking on it…\n`);
  // As Claude would for a question about a job: read what's on file, then answer each one
  // that's waiting, with the tool that keeps the answer with the job.
  const asked = text.match(/^\/factwright:ask job (\S+)/);
  if (asked) {
    const details = await call('job_details', { job: asked[1] });
    for (const [, id] of details.matchAll(/^- (\S+) \(asked [^)]+\): not answered yet$/gm)) {
      await call('save_answer', { job: asked[1], question: id, answer: ANSWER });
    }
  }
  setTimeout(async () => {
    show('Done.\n> ');
    await hook('Stop');
  }, 300);
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
  if (line) await work(line);
});
process.on('SIGHUP', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));

if (askingTrust) {
  show('Quick safety check: Is this a project you created or one you trust?\n');
  show('❯ 1. Yes, I trust this folder\n  2. No, exit\n');
} else {
  await begin();
}
