import { basename, isAbsolute, relative, sep } from 'node:path';
import {
  HELPER_TOOLS,
  type RunProgress,
  type RunStep,
  type TodoItem,
  type TodoState,
  type TurnEnd,
} from '../../shared/activity.ts';

/** The most of a web search's words a step keeps, or of what Claude asked of a helper. */
const MAX_WORDS = 60;

/** The most of what Claude said last that the window gets, which is plenty for a question. */
const MAX_SAID = 4000;

/** The most of an item's words on Claude's to-do list that the window gets. */
const MAX_TODO_WORDS = 200;

/** The most items of Claude's to-do list that the window gets, and of its helpers at work. */
const MAX_ITEMS = 50;

const TODO_STATES: readonly string[] = ['pending', 'in_progress', 'completed'];

const textIn = (value: unknown, most: number): string | null =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, most) : null;

/** Words on one line, no more than `most` of them, as a step says them. */
function shortened(value: unknown, most = MAX_WORDS): string | null {
  if (typeof value !== 'string') return null;
  const words = value.trim().replace(/\s+/g, ' ');
  return words.length > most ? `${words.slice(0, most - 1)}…` : words || null;
}

const fieldsOf = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

/** What a tool gave back, as its PostToolUse hook has it: its own fields, or them as JSON. */
function answerOf(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'string') return fieldsOf(value);
  try {
    return fieldsOf(JSON.parse(value));
  } catch {
    return null;
  }
}

/**
 * How a turn ended, from its Stop hook, with what Claude said last, or its StopFailure, with the
 * error that ended it, such as a rate limit. Null for any other hook.
 */
export function turnEnd(event: unknown): TurnEnd | null {
  if (typeof event !== 'object' || event === null) return null;
  const fields = event as Record<string, unknown>;
  if (fields.hook_event_name === 'Stop') {
    return { said: textIn(fields.last_assistant_message, MAX_SAID), error: null };
  }
  if (fields.hook_event_name !== 'StopFailure') return null;
  return {
    said: null,
    error: {
      kind: typeof fields.error === 'string' ? fields.error : 'unknown',
      // Here it holds the error's own words, such as "API Error: Rate limit reached".
      message: textIn(fields.last_assistant_message, 500),
    },
  };
}

/** Background work that's over, as Claude Code says it of a task. */
const OVER = ['completed', 'failed', 'killed'];

/**
 * The helpers still at work in the background as a turn of Claude's ends, from its Stop hook, by
 * Claude Code's ID for each, with what Claude asked of it. Claude Code wakes Claude again once
 * they're back, so the run isn't done. Null for another hook, or a Stop from a Claude Code that
 * doesn't say.
 */
export function helpersAtWork(event: unknown): Map<string, string | null> | null {
  const fields = fieldsOf(event);
  if (fields?.hook_event_name !== 'Stop' || !Array.isArray(fields.background_tasks)) return null;
  const helpers = new Map<string, string | null>();
  for (const task of fields.background_tasks) {
    const each = fieldsOf(task);
    // A session of Claude Code's own sent to the background is no helper.
    if (each?.type !== 'subagent' || each.agent_type === 'main-session') continue;
    if (typeof each.id !== 'string' || !each.id || OVER.includes(String(each.status))) continue;
    helpers.set(each.id, shortened(each.description));
  }
  return helpers;
}

/** A web address's host, without its "www.", or null when it isn't a web address. */
function hostOf(url: unknown): string | null {
  if (typeof url !== 'string') return null;
  try {
    const { protocol, hostname } = new URL(url);
    return protocol === 'https:' || protocol === 'http:' ? hostname.replace(/^www\./, '') : null;
  } catch {
    return null;
  }
}

/**
 * A to-do list Claude just made, by how many steps it has: one with nothing done on it yet. Null
 * for an update to one, as an item starts or ends.
 */
function newList(todos: unknown): string | null {
  if (!Array.isArray(todos) || todos.length === 0) return null;
  if (todos.some((todo) => fieldsOf(todo)?.status === 'completed')) return null;
  return todos.length === 1 ? '1 step' : `${todos.length} steps`;
}

/**
 * What a tool call is on, in a few words: a file, by its path in the workspace, or by its name
 * when it's elsewhere; a page, by its host; a web search, by its words; a skill, by its name; a
 * helper, by what Claude asked of it; or a new to-do list, by how many steps it has.
 */
export function stepDetail(tool: string, input: unknown, workspace: string): string | null {
  const fields = fieldsOf(input) ?? {};
  const path = fields.file_path ?? fields.notebook_path;
  if (typeof path === 'string') {
    const inside = relative(workspace, path);
    return inside && !inside.startsWith('..') && !isAbsolute(inside)
      ? inside.split(sep).join('/')
      : basename(path);
  }
  if (tool === 'WebSearch') return shortened(fields.query);
  if (tool === 'Skill') return shortened(fields.skill);
  if (HELPER_TOOLS.includes(tool)) return shortened(fields.description);
  if (tool === 'TodoWrite') return newList(fields.todos);
  return hostOf(fields.url);
}

/** An item on Claude's to-do list, from the fields its tool gives it, or null for none. */
function todoItem(text: unknown, doing: unknown, state: unknown): TodoItem | null {
  const words = textIn(text, MAX_TODO_WORDS);
  if (!words || typeof state !== 'string' || !TODO_STATES.includes(state)) return null;
  return { text: words, doing: textIn(doing, MAX_TODO_WORDS), state: state as TodoState };
}

/**
 * An item on Claude's to-do list as the app keeps it: with the Task tools, by its ID, which
 * TaskUpdate names it by. TodoWrite's have none, as each call sends the whole list.
 */
type Todo = TodoItem & { id: string | null };

/** A helper Claude started, as the app follows it. */
interface Helper {
  /** The call that started it, by its ID, while Claude Code hasn't said its own. */
  call: string | null;
  /** Claude Code's ID for it, which its own hooks carry. */
  agent: string | null;
  what: string | null;
}

/**
 * Follows what Claude does in one run, from Claude Code's hooks, as steps: each tool call as it
 * starts, from the hook every call has, then once it's done or failed, from the run's own hooks,
 * with the helper that made it, if one did. It keeps where the run's task stands too: the to-do
 * list the run's own Claude keeps, from TodoWrite or the Task tools that replaced it, and its
 * helpers at work, from each call that starts one until Claude Code says it's done.
 */
export class RunActivity {
  private readonly emit: (step: RunStep) => void;
  private readonly tell: ((progress: RunProgress) => void) | undefined;
  /** The run's workspace, which a file's path is told from. */
  private readonly workspace: string;
  private todos: Todo[] = [];
  private helpers: Helper[] = [];
  /** The helpers that are done, by Claude Code's ID, so a late hook of theirs brings none back. */
  private readonly finished = new Set<string>();
  /** Where the task stood when the window last heard, so it hears only of a change. */
  private told = JSON.stringify({ todos: [], helpers: [] });

  constructor(
    emit: (step: RunStep) => void,
    workspace: string,
    progress?: (progress: RunProgress) => void,
  ) {
    this.emit = emit;
    this.workspace = workspace;
    this.tell = progress;
  }

  /** A tool call about to run. */
  started(event: unknown): void {
    const call = this.callIn(event, 'PreToolUse');
    if (!call) return;
    this.emit({ ...call, state: 'running' });
    if (call.helper) this.heardFrom(call.helper);
    if (HELPER_TOOLS.includes(call.tool) && !this.helpers.some((each) => each.call === call.id)) {
      this.helpers = [...this.helpers, { call: call.id, agent: null, what: call.detail }].slice(
        -MAX_ITEMS,
      );
    }
    this.tellProgress();
  }

  /**
   * A hook from the run: a tool call that ran, or failed, says so, and one that changed Claude's
   * to-do list, or started a helper, changes them. A helper starting or ending, and a turn that
   * ends with some at work in the background, say which are at work. Others say nothing here.
   */
  hear(event: unknown): void {
    const fields = fieldsOf(event);
    if (!fields) return;
    const ran = this.callIn(event, 'PostToolUse');
    const failed = ran ? null : this.callIn(event, 'PostToolUseFailure');
    if (ran) {
      this.emit({ ...ran, state: 'done' });
      if (ran.helper) this.heardFrom(ran.helper);
      if (HELPER_TOOLS.includes(ran.tool)) this.launched(ran.id, answerOf(fields.tool_response));
      else if (!ran.helper) this.listChanged(ran.tool, fieldsOf(fields.tool_input) ?? {}, fields);
    } else if (failed) {
      this.emit({ ...failed, state: 'failed' });
      if (failed.helper) this.heardFrom(failed.helper);
      if (HELPER_TOOLS.includes(failed.tool)) this.drop((each) => each.call === failed.id);
    } else {
      const agent = typeof fields.agent_id === 'string' && fields.agent_id ? fields.agent_id : null;
      if (fields.hook_event_name === 'SubagentStart' && agent) this.heardFrom(agent);
      if (fields.hook_event_name === 'SubagentStop' && agent) {
        this.finished.add(agent);
        this.drop((each) => each.agent === agent);
      }
      const atWork = helpersAtWork(event);
      if (atWork) this.stillAtWork(atWork);
    }
    this.tellProgress();
  }

  /**
   * The call a hook is about, by its ID, or else by its tool and input, which its start and end
   * share, with the helper whose call it is, if it's one's. Null for a hook of another kind.
   */
  private callIn(event: unknown, kind: string): Omit<RunStep, 'state'> | null {
    if (typeof event !== 'object' || event === null) return null;
    const fields = event as Record<string, unknown>;
    if (fields.hook_event_name !== kind || typeof fields.tool_name !== 'string') return null;
    const id =
      typeof fields.tool_use_id === 'string' && fields.tool_use_id
        ? fields.tool_use_id
        : `${fields.tool_name}:${JSON.stringify(fields.tool_input ?? null)}`;
    // A subagent's hooks carry its ID. The run's own Claude's carry none.
    const helper = typeof fields.agent_id === 'string' && fields.agent_id ? fields.agent_id : null;
    return {
      id,
      tool: fields.tool_name,
      detail: stepDetail(fields.tool_name, fields.tool_input, this.workspace),
      ...(helper && { helper }),
    };
  }

  /**
   * A helper heard from, by Claude Code's ID for it: as it starts, or by a call of its own. One
   * the app hasn't placed is taken for the oldest start Claude Code hasn't said the ID of, until
   * it does, or else as one at work.
   */
  private heardFrom(agent: string): void {
    if (this.finished.has(agent) || this.helpers.some((each) => each.agent === agent)) return;
    const unnamed = this.helpers.find((each) => each.agent === null);
    if (unnamed) unnamed.agent = agent;
    else this.helpers = [...this.helpers, { call: null, agent, what: null }].slice(-MAX_ITEMS);
  }

  /**
   * A call that started a helper ran. Claude Code says the helper's ID, and whether it's at work
   * in the background, or done, as one Claude waited for is. Anything else, such as a helper in
   * the cloud, is out of the app's sight.
   */
  private launched(call: string, answer: Record<string, unknown> | null): void {
    const agent = typeof answer?.agentId === 'string' && answer.agentId ? answer.agentId : null;
    const mine = this.helpers.find((each) => each.call === call);
    if (answer?.status !== 'async_launched' || !agent || this.finished.has(agent)) {
      if (agent && answer?.status !== 'async_launched') this.finished.add(agent);
      this.drop((each) => each === mine || (agent !== null && each.agent === agent));
      return;
    }
    const helper = mine ?? { call, agent: null, what: textIn(answer.description, MAX_WORDS) };
    const other = this.helpers.find((each) => each !== helper && each.agent === agent);
    // Heard from before its start came back, it's the same helper. Taken for another start's,
    // the two swap.
    if (other?.call === null) {
      helper.what ??= other.what;
      this.drop((each) => each === other);
    } else if (other) {
      other.agent = helper.agent;
    }
    helper.agent = agent;
    if (!mine) this.helpers = [...this.helpers, helper].slice(-MAX_ITEMS);
  }

  /**
   * The helpers Claude Code says are still at work as a turn ends, which is the whole of them: no
   * call of the run's own Claude goes on past its turn, so the rest are done. One the app missed
   * the start of is at work too. A helper the app takes for done that isn't comes back with its
   * next call.
   */
  private stillAtWork(atWork: ReadonlyMap<string, string | null>): void {
    this.helpers = this.helpers.filter((each) => each.agent !== null && atWork.has(each.agent));
    for (const [agent, what] of atWork) {
      if (this.finished.has(agent) || this.helpers.some((each) => each.agent === agent)) continue;
      this.helpers = [...this.helpers, { call: null, agent, what }].slice(-MAX_ITEMS);
    }
  }

  private drop(done: (helper: Helper) => boolean): void {
    this.helpers = this.helpers.filter((each) => !done(each));
  }

  /**
   * A call of the run's own Claude that keeps its to-do list ran: TodoWrite, with the whole list,
   * or one of the Task tools, which make an item, change one by its ID, or list them all.
   */
  private listChanged(tool: string, input: Record<string, unknown>, hook: Record<string, unknown>) {
    const answer = answerOf(hook.tool_response);
    if (tool === 'TodoWrite' && Array.isArray(input.todos)) {
      this.todos = input.todos
        .flatMap((todo) => {
          const each = fieldsOf(todo);
          const item = todoItem(each?.content, each?.activeForm, each?.status);
          return item ? [{ ...item, id: null }] : [];
        })
        .slice(0, MAX_ITEMS);
      return;
    }
    if (tool === 'TaskCreate') {
      const task = fieldsOf(answer?.task);
      const id = textIn(task?.id, MAX_WORDS);
      const item = todoItem(input.subject ?? task?.subject, input.activeForm, 'pending');
      if (!id || !item) return;
      this.todos = [...this.todos.filter((todo) => todo.id !== id), { ...item, id }].slice(
        -MAX_ITEMS,
      );
      return;
    }
    if (tool === 'TaskUpdate') {
      const id = textIn(input.taskId, MAX_WORDS);
      if (!id || answer?.success === false) return;
      if (input.status === 'deleted') {
        this.todos = this.todos.filter((todo) => todo.id !== id);
        return;
      }
      this.todos = this.todos.map((todo) => {
        if (todo.id !== id) return todo;
        const changed = todoItem(
          input.subject ?? todo.text,
          input.activeForm ?? todo.doing,
          input.status ?? todo.state,
        );
        return changed ? { ...changed, id } : todo;
      });
      return;
    }
    // The whole list, as Claude Code keeps it, which settles anything the app missed.
    if (tool === 'TaskList' && Array.isArray(answer?.tasks)) {
      const doing = new Map(this.todos.map((todo) => [todo.id, todo.doing]));
      this.todos = answer.tasks
        .flatMap((task) => {
          const each = fieldsOf(task);
          const id = textIn(each?.id, MAX_WORDS);
          const item = id && todoItem(each?.subject, doing.get(id), each?.status);
          return item ? [{ ...item, id }] : [];
        })
        .slice(0, MAX_ITEMS);
    }
  }

  /** Tells the window where the task stands, when that changed. */
  private tellProgress(): void {
    if (!this.tell) return;
    const progress: RunProgress = {
      todos: this.todos.map(({ text, doing, state }) => ({ text, doing, state })),
      helpers: this.helpers.map(({ call, agent, what }) => ({ id: agent ?? call ?? '', what })),
    };
    const now = JSON.stringify(progress);
    if (now === this.told) return;
    this.told = now;
    this.tell(progress);
  }
}
