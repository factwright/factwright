import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RunStep } from '../../shared/activity.ts';
import { RunActivity, stepDetail, turnEnd } from './activity.ts';

const WORKSPACE = join('/', 'data', 'workspace');

describe('stepDetail', () => {
  it('names a file by its path in the workspace, or by its name when it’s elsewhere', () => {
    const inside = join(WORKSPACE, 'applications', 'acme--staff', 'resume.json');
    expect(stepDetail('Write', { file_path: inside }, WORKSPACE)).toBe(
      'applications/acme--staff/resume.json',
    );
    expect(stepDetail('Read', { file_path: join('/', 'etc', 'hosts') }, WORKSPACE)).toBe('hosts');
  });

  it('names a page by its host, and a web search by its words, not too many of them', () => {
    expect(stepDetail('WebFetch', { url: 'https://www.acme.com/careers?x=1' }, WORKSPACE)).toBe(
      'acme.com',
    );
    expect(
      stepDetail('mcp__factwright__read_page', { url: 'javascript:alert(1)' }, WORKSPACE),
    ).toBe(null);
    expect(stepDetail('WebSearch', { query: '  Acme   platform team  ' }, WORKSPACE)).toBe(
      'Acme platform team',
    );
    expect(stepDetail('WebSearch', { query: 'x'.repeat(100) }, WORKSPACE)).toBe(
      `${'x'.repeat(59)}…`,
    );
    expect(stepDetail('Glob', { pattern: '**/*.md' }, WORKSPACE)).toBeNull();
    expect(stepDetail('Read', null, WORKSPACE)).toBeNull();
  });
});

describe('RunActivity', () => {
  const run = () => {
    const steps: RunStep[] = [];
    return { steps, activity: new RunActivity((step) => steps.push(step), WORKSPACE) };
  };
  const call = (kind: string, extra: Record<string, unknown> = {}) => ({
    hook_event_name: kind,
    tool_name: 'Read',
    tool_input: { file_path: join(WORKSPACE, 'facts', 'platform.md') },
    tool_use_id: 'toolu_1',
    ...extra,
  });

  it('follows a call from its start to its end, by its ID', () => {
    const { steps, activity } = run();
    activity.started(call('PreToolUse'));
    activity.hear(call('PostToolUse'));
    const read = { id: 'toolu_1', tool: 'Read', detail: 'facts/platform.md' };
    expect(steps).toEqual([
      { ...read, state: 'running' },
      { ...read, state: 'done' },
    ]);
    activity.hear(call('PostToolUseFailure', { tool_use_id: 'toolu_2' }));
    expect(steps.at(-1)).toEqual({ ...read, id: 'toolu_2', state: 'failed' });
  });

  it('pairs a call’s start and end by its tool and input when they have no ID', () => {
    const { steps, activity } = run();
    activity.started(call('PreToolUse', { tool_use_id: undefined }));
    activity.hear(call('PostToolUse', { tool_use_id: '' }));
    expect(steps[0]?.id).toBe(steps[1]?.id);
  });

  it('says nothing of other hooks, or a start on the run’s own hooks', () => {
    const { steps, activity } = run();
    activity.hear({ hook_event_name: 'Stop' });
    activity.hear(call('PreToolUse'));
    activity.started(call('PostToolUse'));
    activity.hear('nonsense');
    activity.started(null);
    expect(steps).toEqual([]);
  });
});

describe('turnEnd', () => {
  it('says what Claude said last, or the error that ended its turn', () => {
    expect(
      turnEnd({ hook_event_name: 'Stop', last_assistant_message: '  Which template?  ' }),
    ).toEqual({ said: 'Which template?', error: null });
    expect(turnEnd({ hook_event_name: 'Stop' })).toEqual({ said: null, error: null });
    expect(
      turnEnd({
        hook_event_name: 'StopFailure',
        error: 'rate_limit',
        last_assistant_message: 'API Error: Rate limit reached',
      }),
    ).toEqual({
      said: null,
      error: { kind: 'rate_limit', message: 'API Error: Rate limit reached' },
    });
    expect(turnEnd({ hook_event_name: 'StopFailure' })).toEqual({
      said: null,
      error: { kind: 'unknown', message: null },
    });
    expect(turnEnd({ hook_event_name: 'PostToolUse' })).toBeNull();
    expect(turnEnd(undefined)).toBeNull();
  });

  it('keeps no more of what Claude said than the window shows', () => {
    const said = turnEnd({ hook_event_name: 'Stop', last_assistant_message: 'x'.repeat(10_000) });
    expect(said?.said).toHaveLength(4000);
  });
});
