import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RunProgress, RunStep } from '../../shared/activity.ts';
import { helpersAtWork, RunActivity, stepDetail, turnEnd } from './activity.ts';

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

  it('says which helper made a step, by Claude Code’s ID for it', () => {
    const { steps, activity } = run();
    activity.started(call('PreToolUse', { agent_id: 'agent-a1' }));
    activity.hear(call('PostToolUse', { agent_id: 'agent-a1' }));
    expect(steps.map((step) => step.helper)).toEqual(['agent-a1', 'agent-a1']);
    activity.started(call('PreToolUse', { tool_use_id: 'toolu_2', agent_id: '' }));
    expect(steps.at(-1)).not.toHaveProperty('helper');
  });
});

describe('stepDetail for skills, helpers and to-do lists', () => {
  it('names a skill, and what Claude asked of a helper', () => {
    expect(stepDetail('Skill', { skill: 'factwright:focused-resume' }, WORKSPACE)).toBe(
      'factwright:focused-resume',
    );
    expect(
      stepDetail('Agent', { description: ' Fact-check  the resume ', prompt: '…' }, WORKSPACE),
    ).toBe('Fact-check the resume');
  });

  it('counts the steps of a new to-do list, and says nothing of an update to one', () => {
    const todos = (...states: string[]) => ({
      todos: states.map((status, at) => ({
        content: `Do ${at}`,
        activeForm: `Doing ${at}`,
        status,
      })),
    });
    expect(stepDetail('TodoWrite', todos('in_progress', 'pending', 'pending'), WORKSPACE)).toBe(
      '3 steps',
    );
    expect(stepDetail('TodoWrite', todos('pending'), WORKSPACE)).toBe('1 step');
    expect(stepDetail('TodoWrite', todos('completed', 'in_progress'), WORKSPACE)).toBeNull();
    expect(stepDetail('TodoWrite', { todos: [] }, WORKSPACE)).toBeNull();
  });
});

describe('RunActivity’s to-do list and helpers', () => {
  const run = () => {
    const told: RunProgress[] = [];
    const activity = new RunActivity(
      () => {},
      WORKSPACE,
      (progress) => told.push(progress),
    );
    return { told, activity, now: () => told.at(-1) ?? { todos: [], helpers: [] } };
  };
  let ids = 0;
  /** One of Claude's calls, as it starts and then as it ran, with what it gave back. */
  const ran = (
    activity: RunActivity,
    tool: string,
    input: unknown,
    answer: unknown = null,
    extra: Record<string, unknown> = {},
  ) => {
    ids += 1;
    const fields = { tool_name: tool, tool_input: input, tool_use_id: `toolu_${ids}`, ...extra };
    activity.started({ hook_event_name: 'PreToolUse', ...fields });
    activity.hear({ hook_event_name: 'PostToolUse', ...fields, tool_response: answer });
    return `toolu_${ids}`;
  };
  const todo = (content: string, status: string) => ({
    content,
    activeForm: content.replace(/^Read/, 'Reading').replace(/^Write/, 'Writing'),
    status,
  });

  it('keeps the to-do list TodoWrite sends, whole, each time', () => {
    const { told, activity, now } = run();
    ran(activity, 'TodoWrite', {
      todos: [todo('Read the posting', 'in_progress'), todo('Write the resume', 'pending')],
    });
    expect(now().todos).toEqual([
      { text: 'Read the posting', doing: 'Reading the posting', state: 'in_progress' },
      { text: 'Write the resume', doing: 'Writing the resume', state: 'pending' },
    ]);
    ran(activity, 'TodoWrite', {
      todos: [todo('Read the posting', 'completed'), todo('Write the resume', 'in_progress')],
    });
    expect(now().todos.map((each) => each.state)).toEqual(['completed', 'in_progress']);
    // The window hears only of a change.
    const heard = told.length;
    ran(activity, 'TodoWrite', {
      todos: [todo('Read the posting', 'completed'), todo('Write the resume', 'in_progress')],
    });
    expect(told).toHaveLength(heard);
  });

  it('keeps the list the Task tools make, item by item, by their IDs', () => {
    const { activity, now } = run();
    ran(
      activity,
      'TaskCreate',
      { subject: 'Read the posting', description: '…', activeForm: 'Reading the posting' },
      { task: { id: '1', subject: 'Read the posting' } },
    );
    // Its answer can come as JSON too.
    ran(
      activity,
      'TaskCreate',
      { subject: 'Write the resume', description: '…' },
      JSON.stringify({ task: { id: '2', subject: 'Write the resume' } }),
    );
    ran(activity, 'TaskCreate', { subject: 'Drop this', description: '…' }, { task: { id: '3' } });
    ran(activity, 'TaskUpdate', { taskId: '1', status: 'completed' }, { success: true });
    ran(
      activity,
      'TaskUpdate',
      { taskId: '2', status: 'in_progress', activeForm: 'Writing it' },
      {
        success: true,
      },
    );
    ran(activity, 'TaskUpdate', { taskId: '3', status: 'deleted' }, { success: true });
    // One that didn't take changes nothing, nor does one for an item the app never heard of.
    ran(activity, 'TaskUpdate', { taskId: '1', status: 'pending' }, { success: false });
    ran(activity, 'TaskUpdate', { taskId: '9', status: 'completed' }, { success: true });
    expect(now().todos).toEqual([
      { text: 'Read the posting', doing: 'Reading the posting', state: 'completed' },
      { text: 'Write the resume', doing: 'Writing it', state: 'in_progress' },
    ]);
    // TaskList's whole list settles anything the app missed, keeping what Claude says on each.
    ran(
      activity,
      'TaskList',
      {},
      {
        tasks: [
          { id: '1', subject: 'Read the posting', status: 'completed', blockedBy: [] },
          { id: '2', subject: 'Write the resume', status: 'completed', blockedBy: [] },
          { id: '4', subject: 'Build it', status: 'in_progress', blockedBy: [] },
        ],
      },
    );
    expect(now().todos).toEqual([
      { text: 'Read the posting', doing: 'Reading the posting', state: 'completed' },
      { text: 'Write the resume', doing: 'Writing it', state: 'completed' },
      { text: 'Build it', doing: null, state: 'in_progress' },
    ]);
  });

  it('keeps only the run’s own Claude’s list, not a helper’s', () => {
    const { activity, now } = run();
    ran(activity, 'TodoWrite', { todos: [todo('Read the posting', 'pending')] }, null, {
      agent_id: 'agent-a1',
    });
    expect(now().todos).toEqual([]);
  });

  it('follows a helper in the background from its start until Claude Code says it’s done', () => {
    const { activity, now } = run();
    const launch = 'toolu_launch';
    activity.started({
      hook_event_name: 'PreToolUse',
      tool_name: 'Agent',
      tool_use_id: launch,
      tool_input: { description: 'Fact-check the resume', prompt: '…' },
    });
    expect(now().helpers).toEqual([{ id: launch, what: 'Fact-check the resume' }]);
    activity.hear({ hook_event_name: 'SubagentStart', agent_id: 'agent-a1', agent_type: 'x' });
    activity.hear({
      hook_event_name: 'PostToolUse',
      tool_name: 'Agent',
      tool_use_id: launch,
      tool_input: { description: 'Fact-check the resume', prompt: '…' },
      tool_response: { status: 'async_launched', agentId: 'agent-a1', description: 'x' },
    });
    expect(now().helpers).toEqual([{ id: 'agent-a1', what: 'Fact-check the resume' }]);
    // Its own calls say nothing new, and a turn that ends with it at work keeps it.
    ran(activity, 'Read', { file_path: join(WORKSPACE, 'facts', 'a.md') }, null, {
      agent_id: 'agent-a1',
    });
    activity.hear({
      hook_event_name: 'Stop',
      background_tasks: [{ id: 'agent-a1', type: 'subagent', status: 'running' }],
    });
    expect(now().helpers).toHaveLength(1);
    activity.hear({ hook_event_name: 'SubagentStop', agent_id: 'agent-a1', agent_type: 'x' });
    expect(now().helpers).toEqual([]);
    // A late hook of its own brings it back no more.
    ran(activity, 'Read', { file_path: join(WORKSPACE, 'facts', 'a.md') }, null, {
      agent_id: 'agent-a1',
    });
    expect(now().helpers).toEqual([]);
  });

  it('lets a helper Claude waited for go as its call ends, and one that didn’t start', () => {
    const { activity, now } = run();
    ran(
      activity,
      'Agent',
      { description: 'Read the posting' },
      {
        status: 'completed',
        agentId: 'agent-a1',
        content: [],
      },
    );
    ran(activity, 'Task', { description: 'Read the board' }, { status: 'remote_launched' });
    expect(now().helpers).toEqual([]);
    activity.started({
      hook_event_name: 'PreToolUse',
      tool_name: 'Agent',
      tool_use_id: 'toolu_failed',
      tool_input: { description: 'Read it' },
    });
    activity.hear({
      hook_event_name: 'PostToolUseFailure',
      tool_name: 'Agent',
      tool_use_id: 'toolu_failed',
      tool_input: { description: 'Read it' },
    });
    expect(now().helpers).toEqual([]);
  });

  it('tells helpers started together apart, whichever starts first', () => {
    const { activity, now } = run();
    const start = (id: string, what: string) =>
      activity.started({
        hook_event_name: 'PreToolUse',
        tool_name: 'Agent',
        tool_use_id: id,
        tool_input: { description: what },
      });
    const back = (id: string, what: string, agent: string) =>
      activity.hear({
        hook_event_name: 'PostToolUse',
        tool_name: 'Agent',
        tool_use_id: id,
        tool_input: { description: what },
        tool_response: { status: 'async_launched', agentId: agent },
      });
    start('toolu_a', 'Analyze Acme');
    start('toolu_b', 'Analyze Seeq');
    // The second starts first, and is taken for the first until Claude Code says.
    activity.hear({ hook_event_name: 'SubagentStart', agent_id: 'agent-b', agent_type: 'x' });
    activity.hear({ hook_event_name: 'SubagentStart', agent_id: 'agent-a', agent_type: 'x' });
    back('toolu_a', 'Analyze Acme', 'agent-a');
    back('toolu_b', 'Analyze Seeq', 'agent-b');
    expect(now().helpers).toEqual([
      { id: 'agent-a', what: 'Analyze Acme' },
      { id: 'agent-b', what: 'Analyze Seeq' },
    ]);
    activity.hear({ hook_event_name: 'SubagentStop', agent_id: 'agent-b', agent_type: 'x' });
    expect(now().helpers).toEqual([{ id: 'agent-a', what: 'Analyze Acme' }]);
  });

  it('takes the helpers at work as a turn ends from Claude Code, missed ones included', () => {
    const { activity, now } = run();
    // One heard from only by its own calls, as when its start came before the app listened.
    ran(activity, 'Read', { file_path: join(WORKSPACE, 'a.md') }, null, { agent_id: 'agent-x' });
    ran(
      activity,
      'Agent',
      { description: 'Gone' },
      { status: 'async_launched', agentId: 'agent-y' },
    );
    expect(now().helpers.map((each) => each.id)).toEqual(['agent-x', 'agent-y']);
    activity.hear({
      hook_event_name: 'Stop',
      background_tasks: [
        { id: 'agent-x', type: 'subagent', status: 'running', description: 'Read listings' },
        { id: 'agent-z', type: 'subagent', status: 'pending', description: 'Read the board' },
        { id: 'agent-w', type: 'subagent', status: 'completed', description: 'Done' },
        { id: 'shell-1', type: 'shell', status: 'running', description: 'tail logs' },
        { id: 'main-1', type: 'subagent', agent_type: 'main-session', status: 'running' },
      ],
    });
    // Claude Code says what Claude asked of the one the app knew only by its calls.
    expect(now().helpers).toEqual([
      { id: 'agent-x', what: 'Read listings' },
      { id: 'agent-z', what: 'Read the board' },
    ]);
    // A Stop from a Claude Code that doesn't say leaves them be.
    activity.hear({ hook_event_name: 'Stop' });
    expect(now().helpers).toHaveLength(2);
  });

  it('brings a helper back that Claude sends back to work, as Claude Code says', () => {
    const { activity, now } = run();
    ran(
      activity,
      'Agent',
      { description: 'Read the posting' },
      { status: 'async_launched', agentId: 'agent-a1' },
    );
    activity.hear({ hook_event_name: 'SubagentStop', agent_id: 'agent-a1', agent_type: 'x' });
    expect(now().helpers).toEqual([]);
    // Claude sends it a message, and it starts again.
    activity.hear({ hook_event_name: 'SubagentStart', agent_id: 'agent-a1', agent_type: 'x' });
    expect(now().helpers).toEqual([{ id: 'agent-a1', what: null }]);
    activity.hear({ hook_event_name: 'SubagentStop', agent_id: 'agent-a1', agent_type: 'x' });
    // And one Claude Code says is at work as a turn ends is, whatever the app took it for.
    activity.hear({
      hook_event_name: 'Stop',
      background_tasks: [
        { id: 'agent-a1', type: 'subagent', status: 'running', description: 'Read it again' },
      ],
    });
    expect(now().helpers).toEqual([{ id: 'agent-a1', what: 'Read it again' }]);
  });

  it('starts a new list once every item on the last one is done, as Claude Code does', () => {
    const { activity, now } = run();
    const create = (id: string, subject: string) =>
      ran(activity, 'TaskCreate', { subject, description: '…' }, { task: { id, subject } });
    const update = (taskId: string, status: string) =>
      ran(activity, 'TaskUpdate', { taskId, status }, { success: true });
    create('1', 'Read the posting');
    create('2', 'Write the resume');
    update('1', 'completed');
    update('2', 'completed');
    // A follow-up's list goes on from Claude Code's last ID.
    create('3', 'Shorten the summary');
    create('4', 'Build it again');
    update('3', 'in_progress');
    expect(now().todos).toEqual([
      { text: 'Shorten the summary', doing: null, state: 'in_progress' },
      { text: 'Build it again', doing: null, state: 'pending' },
    ]);
  });
});

describe('helpersAtWork', () => {
  it('lists the helpers still at work in the background as a turn ends', () => {
    expect(
      helpersAtWork({
        hook_event_name: 'Stop',
        background_tasks: [
          { id: 'agent-a', type: 'subagent', status: 'running', description: '  Read  it ' },
          { id: 'agent-b', type: 'subagent', status: 'killed' },
          { id: 'bash-1', type: 'shell', status: 'running' },
          'nonsense',
        ],
      }),
    ).toEqual(new Map([['agent-a', 'Read it']]));
    expect(helpersAtWork({ hook_event_name: 'Stop', background_tasks: [] })?.size).toBe(0);
  });

  it('says nothing of another hook, or a Stop that doesn’t say', () => {
    expect(helpersAtWork({ hook_event_name: 'Stop' })).toBeNull();
    expect(helpersAtWork({ hook_event_name: 'SubagentStop', background_tasks: [] })).toBeNull();
    expect(helpersAtWork(null)).toBeNull();
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
