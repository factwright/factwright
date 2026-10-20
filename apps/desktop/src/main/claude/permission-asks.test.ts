import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  parsePermissionAnswer,
  permissionAskFrom,
  permissionReply,
  toolKey,
} from './permission-asks.ts';

const workspace = mkdtempSync(join(tmpdir(), 'factwright-permissions-'));
writeFileSync(join(workspace, 'kept.md'), 'Already here');
afterAll(() => rmSync(workspace, { recursive: true, force: true }));

// Files outside the job hunt, by their whole paths as Claude Code gives them on this system.
const WINDOWS = process.platform === 'win32';
const HOSTS = WINDOWS ? 'C:\\Windows\\System32\\drivers\\etc\\hosts' : '/etc/hosts';
const SSH_KEY = WINDOWS ? 'C:\\Users\\alex\\.ssh\\id_rsa' : '/Users/alex/.ssh/id_rsa';

const asks = (tool_name: string, tool_input: unknown, fields: Record<string, unknown> = {}) => ({
  hook_event_name: 'PermissionRequest',
  tool_name,
  tool_input,
  permission_suggestions: [{ type: 'setMode', mode: 'acceptEdits', destination: 'session' }],
  ...fields,
});

const described = (tool: string, input: unknown) => {
  const heard = permissionAskFrom(asks(tool, input), { workspace });
  if (!heard) return null;
  const { id, ...rest } = heard.ask;
  expect(id).toMatch(/^[0-9a-f-]{36}$/);
  return rest;
};

describe('permissionAskFrom', () => {
  it('shows a change to a file in the job hunt by its path there, as replaced and replacing text', () => {
    expect(
      described('Edit', {
        file_path: join(workspace, 'facts', 'acme.md'),
        old_string: 'Cut deploy time',
        new_string: 'Cut deploy time by ~40%',
      }),
    ).toEqual({
      kind: 'edit',
      file: 'facts/acme.md',
      outside: false,
      before: 'Cut deploy time',
      after: 'Cut deploy time by ~40%',
      everywhere: false,
    });
    expect(
      described('Edit', {
        file_path: HOSTS,
        old_string: 'a',
        new_string: 'b',
        replace_all: true,
      }),
    ).toMatchObject({ file: HOSTS, outside: true, everywhere: true });
  });

  it('says whether writing a file makes a new one or replaces one there', () => {
    expect(
      described('Write', { file_path: join(workspace, 'guide', 'voice.md'), content: 'Plain' }),
    ).toEqual({
      kind: 'write',
      file: 'guide/voice.md',
      outside: false,
      content: 'Plain',
      replaces: false,
    });
    expect(
      described('Write', { file_path: join(workspace, 'kept.md'), content: '' }),
    ).toMatchObject({ replaces: true });
  });

  it('shows reading a file outside the job hunt in full', () => {
    expect(described('Read', { file_path: SSH_KEY })).toEqual({
      kind: 'read',
      file: SSH_KEY,
      outside: true,
    });
  });

  it('leaves to the terminal a path Claude Code could read another way: relative, padded, or from ~', () => {
    for (const file_path of [
      '~/.zshrc',
      ' /Users/alex/.zshrc',
      '/Users/alex/.zshrc\n',
      'notes/a.md',
    ]) {
      expect(described('Write', { file_path, content: 'x' })).toBeNull();
      expect(described('Read', { file_path })).toBeNull();
    }
  });

  it('shows the whole address of a page to read, and the site it goes to', () => {
    const url = 'https://jobs.example.com/careers/42?ref=a%20b';
    for (const tool of ['mcp__factwright__read_page', 'WebFetch']) {
      expect(described(tool, { url, prompt: 'Read it' })).toEqual({
        kind: 'page',
        url,
        host: 'jobs.example.com',
      });
    }
    // The site is the one the address goes to, whatever comes before an @.
    expect(described('WebFetch', { url: 'https://good.example@evil.example/' })).toMatchObject({
      host: 'evil.example',
    });
    expect(described('WebFetch', { url: 'file:///etc/passwd' })).toBeNull();
    expect(described('WebFetch', { url: 'not a link' })).toBeNull();
  });

  it('shows what saving to the profile saves, in words, in the profile’s order, blanks clearing', () => {
    expect(
      described('mcp__factwright__save_about_you', {
        targetPay: '$185,000',
        start: 'Two weeks’ notice',
        relocate: 'maybe',
        phone: '  ',
      }),
    ).toEqual({
      kind: 'profile',
      changes: [
        { label: 'When you can start', value: 'Two weeks’ notice' },
        { label: 'Whether you’d move for a job', value: 'Maybe, for the right one' },
        { label: 'Base pay you’re aiming for', value: '$185,000' },
        { label: 'Phone', value: null },
      ],
    });
    expect(described('mcp__factwright__save_about_you', { email: '' })).toEqual({
      kind: 'profile',
      changes: [{ label: 'Email', value: null }],
    });
    expect(
      described('mcp__factwright__save_about_you', { start: 'Now', nickname: 'Al' }),
    ).toBeNull();
    expect(described('mcp__factwright__save_about_you', { relocate: 'sometimes' })).toBeNull();
  });

  it('shows who the user is outside work as a line of what it adds', () => {
    expect(
      described('mcp__factwright__save_about_you', {
        cares: 'Getting kids into programming',
        interests: [' Trail running ', 'Chess'],
      }),
    ).toEqual({
      kind: 'profile',
      changes: [
        { label: 'Interests and hobbies to add', value: 'Trail running, Chess' },
        { label: 'What you care about', value: 'Getting kids into programming' },
      ],
    });
    // An empty list, a blank in one, or one that isn't words asks in the terminal.
    for (const interests of [[], ['Chess', '  '], 'Chess', [42]]) {
      expect(described('mcp__factwright__save_about_you', { interests })).toBeNull();
    }
  });

  it('leaves to the terminal a field or value only a lookup past an object’s own would find', () => {
    const save = 'mcp__factwright__save_about_you';
    expect(described(save, JSON.parse('{"__proto__": "x"}'))).toBeNull();
    expect(described(save, { constructor: 'x' })).toBeNull();
    for (const relocate of ['__proto__', 'constructor', 'toString']) {
      expect(described(save, { relocate })).toBeNull();
    }
  });

  it('shows a template by its ID, name, look and whole file, and the template of the user’s it replaces', () => {
    const template = { name: 'Navy (clean)', look: 'Navy headings.', css: 'h2{}' };
    const heard = permissionAskFrom(
      asks('mcp__factwright__save_template', { id: 'executive', template, replace: true }),
      { workspace, templateName: (id) => (id === 'executive' ? 'Executive' : null) },
    );
    expect(heard?.ask).toMatchObject({
      kind: 'template',
      template: 'executive',
      name: 'Navy (clean)',
      look: 'Navy headings.',
      replace: true,
      replacing: 'Executive',
      code: JSON.stringify(template, null, 2),
    });
    expect(
      described('mcp__factwright__save_template', { id: 'navy-clean', template, replace: false }),
    ).toMatchObject({ replace: false, replacing: null });
    expect(
      described('mcp__factwright__save_template', { id: 'x', template: { css: 'h2{}' } }),
    ).toBeNull();
    expect(
      described('mcp__factwright__save_template', {
        id: 'big',
        template: { name: 'Big', css: 'x'.repeat(50_000) },
      }),
    ).toBeNull();
  });

  it('leaves to the terminal other hooks, other tools, a subagent’s request, and what it can’t show in full', () => {
    expect(
      permissionAskFrom({ ...asks('Edit', {}), hook_event_name: 'PreToolUse' }, { workspace }),
    ).toBeNull();
    for (const tool of ['Bash', 'AskUserQuestion', 'ExitPlanMode', 'NotebookEdit']) {
      expect(permissionAskFrom(asks(tool, { command: 'ls' }), { workspace })).toBeNull();
    }
    const read = { file_path: '/tmp/a' };
    expect(
      permissionAskFrom(asks('Read', read, { agent_id: 'research' }), { workspace }),
    ).toBeNull();
    expect(permissionAskFrom(asks('Read', read, { agent_id: '' }), { workspace })).not.toBeNull();
    expect(
      described('Write', { file_path: join(workspace, 'big.md'), content: 'x'.repeat(50_001) }),
    ).toBeNull();
    expect(described('Edit', { file_path: join(workspace, 'a.md'), old_string: 'a' })).toBeNull();
    expect(permissionAskFrom(asks('Read', 'path'), { workspace })).toBeNull();
    expect(permissionAskFrom(null, { workspace })).toBeNull();
    // Nested past what a key can name, a yes in the terminal couldn't close it.
    const deep = { file_path: '/tmp/a', extra: { a: { b: { c: { d: { e: 1 } } } } } };
    expect(permissionAskFrom(asks('Read', deep), { workspace })).toBeNull();
  });

  it('names the call it asks about, as its PostToolUse names it, whatever order the input’s keys', () => {
    const heard = permissionAskFrom(asks('Write', { file_path: '/tmp/a', content: 'b' }), {
      workspace,
    });
    expect(heard?.key).toBe(toolKey('Write', { content: 'b', file_path: '/tmp/a' }));
    expect(heard?.key).not.toBe(toolKey('Write', { content: 'c', file_path: '/tmp/a' }));
    expect(toolKey(undefined, {})).toBeNull();
  });
});

describe('parsePermissionAnswer', () => {
  it('takes allow, or don’t allow with a note, and nothing else', () => {
    expect(parsePermissionAnswer({ allow: true })).toEqual({ allow: true });
    expect(parsePermissionAnswer({ allow: false, note: 'Not that site' })).toEqual({
      allow: false,
      note: 'Not that site',
    });
    expect(parsePermissionAnswer({ allow: true, note: 'x' })).toBeNull();
    expect(parsePermissionAnswer({ allow: false })).toBeNull();
    expect(parsePermissionAnswer({ allow: false, note: 'x'.repeat(2001) })).toBeNull();
    expect(parsePermissionAnswer({ allow: 'yes' })).toBeNull();
    expect(parsePermissionAnswer('allow')).toBeNull();
  });
});

describe('permissionReply', () => {
  it('allows the call as Claude asked it, with no new rules', () => {
    expect(permissionReply({ allow: true })).toEqual({
      hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } },
    });
  });

  it('denies it, telling Claude the user said no, with anything they added', () => {
    expect(permissionReply({ allow: false, note: '  ' })).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PermissionRequest',
        decision: { behavior: 'deny', message: 'The user said no, in Factwright.' },
      },
    });
    expect(permissionReply({ allow: false, note: ' Use the posting instead ' })).toMatchObject({
      hookSpecificOutput: {
        decision: {
          behavior: 'deny',
          message: 'The user said no, in Factwright, and added: Use the posting instead',
        },
      },
    });
  });
});
