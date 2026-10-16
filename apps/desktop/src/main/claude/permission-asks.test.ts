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

const asks = (tool_name: string, tool_input: unknown, fields: Record<string, unknown> = {}) => ({
  hook_event_name: 'PermissionRequest',
  tool_name,
  tool_input,
  permission_suggestions: [{ type: 'setMode', mode: 'acceptEdits', destination: 'session' }],
  ...fields,
});

const described = (tool: string, input: unknown) => {
  const heard = permissionAskFrom(asks(tool, input), workspace);
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
        file_path: '/etc/hosts',
        old_string: 'a',
        new_string: 'b',
        replace_all: true,
      }),
    ).toMatchObject({ file: '/etc/hosts', outside: true, everywhere: true });
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
    ).toMatchObject({
      replaces: true,
    });
  });

  it('shows reading a file outside the job hunt in full', () => {
    expect(described('Read', { file_path: '/Users/alex/.ssh/id_rsa' })).toEqual({
      kind: 'read',
      file: '/Users/alex/.ssh/id_rsa',
      outside: true,
    });
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
    expect(described('WebFetch', { url: 'file:///etc/passwd' })).toBeNull();
    expect(described('WebFetch', { url: 'not a link' })).toBeNull();
  });

  it('shows what saving to the profile saves, in words, in the profile’s order', () => {
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
      ],
    });
    expect(
      described('mcp__factwright__save_about_you', { start: 'Now', nickname: 'Al' }),
    ).toBeNull();
    expect(described('mcp__factwright__save_about_you', { relocate: 'sometimes' })).toBeNull();
    expect(described('mcp__factwright__save_about_you', { phone: ' ' })).toBeNull();
  });

  it('shows a template to save by its name and look, and whether it changes one of the user’s', () => {
    expect(
      described('mcp__factwright__save_template', {
        id: 'navy-clean',
        template: { name: 'Navy (clean)', look: 'Navy headings.', css: 'h2{}' },
        replace: true,
      }),
    ).toEqual({
      kind: 'template',
      template: 'navy-clean',
      name: 'Navy (clean)',
      look: 'Navy headings.',
      replace: true,
    });
    expect(
      described('mcp__factwright__save_template', { id: 'x', template: { css: 'h2{}' } }),
    ).toBeNull();
  });

  it('leaves to the terminal other hooks, other tools, a subagent’s request, and what it can’t show in full', () => {
    expect(
      permissionAskFrom({ ...asks('Edit', {}), hook_event_name: 'PreToolUse' }, workspace),
    ).toBeNull();
    for (const tool of ['Bash', 'AskUserQuestion', 'ExitPlanMode', 'NotebookEdit']) {
      expect(permissionAskFrom(asks(tool, { command: 'ls' }), workspace)).toBeNull();
    }
    const read = { file_path: '/tmp/a' };
    expect(permissionAskFrom(asks('Read', read, { agent_id: 'research' }), workspace)).toBeNull();
    expect(permissionAskFrom(asks('Read', read, { agent_id: '' }), workspace)).not.toBeNull();
    expect(
      described('Write', { file_path: join(workspace, 'big.md'), content: 'x'.repeat(50_001) }),
    ).toBeNull();
    expect(described('Edit', { file_path: join(workspace, 'a.md'), old_string: 'a' })).toBeNull();
    expect(permissionAskFrom(asks('Read', 'path'), workspace)).toBeNull();
    expect(permissionAskFrom(null, workspace)).toBeNull();
  });

  it('names the call it asks about, as its PostToolUse names it, whatever order the input’s keys', () => {
    const heard = permissionAskFrom(
      asks('Write', { file_path: '/tmp/a', content: 'b' }),
      workspace,
    );
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
