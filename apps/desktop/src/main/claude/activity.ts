import { basename, isAbsolute, relative, sep } from 'node:path';
import type { RunStep, TurnEnd } from '../../shared/activity.ts';

/** The most of a web search's words a step keeps. */
const MAX_WORDS = 60;

/** The most of what Claude said last that the window gets, which is plenty for a question. */
const MAX_SAID = 4000;

const textIn = (value: unknown, most: number): string | null =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, most) : null;

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
 * What a tool call is on, in a few words: a file, by its path in the workspace, or by its name
 * when it's elsewhere; a page, by its host; or a web search, by its words.
 */
export function stepDetail(tool: string, input: unknown, workspace: string): string | null {
  const fields = (typeof input === 'object' && input !== null ? input : {}) as Record<
    string,
    unknown
  >;
  const path = fields.file_path ?? fields.notebook_path;
  if (typeof path === 'string') {
    const inside = relative(workspace, path);
    return inside && !inside.startsWith('..') && !isAbsolute(inside)
      ? inside.split(sep).join('/')
      : basename(path);
  }
  if (tool === 'WebSearch' && typeof fields.query === 'string') {
    const query = fields.query.trim().replace(/\s+/g, ' ');
    return query.length > MAX_WORDS ? `${query.slice(0, MAX_WORDS - 1)}…` : query || null;
  }
  return hostOf(fields.url);
}

/**
 * Follows what Claude does in one run, from Claude Code's hooks, as steps: each tool call as it
 * starts, from the hook every call has, then once it's done or failed, from the run's own hooks.
 */
export class RunActivity {
  private readonly emit: (step: RunStep) => void;
  /** The run's workspace, which a file's path is told from. */
  private readonly workspace: string;

  constructor(emit: (step: RunStep) => void, workspace: string) {
    this.emit = emit;
    this.workspace = workspace;
  }

  /** A tool call about to run. */
  started(event: unknown): void {
    const call = this.callIn(event, 'PreToolUse');
    if (call) this.emit({ ...call, state: 'running' });
  }

  /** A hook from the run: a tool call that ran, or failed, says so. Others say nothing here. */
  hear(event: unknown): void {
    const ran = this.callIn(event, 'PostToolUse');
    if (ran) {
      this.emit({ ...ran, state: 'done' });
      return;
    }
    const failed = this.callIn(event, 'PostToolUseFailure');
    if (failed) this.emit({ ...failed, state: 'failed' });
  }

  /**
   * The call a hook is about, by its ID, or else by its tool and input, which its start and end
   * share. Null for a hook of another kind.
   */
  private callIn(event: unknown, kind: string): Omit<RunStep, 'state'> | null {
    if (typeof event !== 'object' || event === null) return null;
    const fields = event as Record<string, unknown>;
    if (fields.hook_event_name !== kind || typeof fields.tool_name !== 'string') return null;
    const id =
      typeof fields.tool_use_id === 'string' && fields.tool_use_id
        ? fields.tool_use_id
        : `${fields.tool_name}:${JSON.stringify(fields.tool_input ?? null)}`;
    return {
      id,
      tool: fields.tool_name,
      detail: stepDetail(fields.tool_name, fields.tool_input, this.workspace),
    };
  }
}
