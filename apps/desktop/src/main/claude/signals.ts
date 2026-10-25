import type { RunSignal } from '../../shared/api.ts';
import { canonical } from './questions.ts';

/**
 * A tool call waiting on the user, by its tool and input, since PermissionRequest has no id. The
 * input's keys can come in any order.
 */
const waitKey = (fields: { tool_name?: unknown; tool_input?: unknown }) => {
  const input = fields.tool_input ?? null;
  return `${String(fields.tool_name)}:${canonical(input) ?? JSON.stringify(input)}`;
};

/** How many calls answered in the app are kept, until their PostToolUse comes. */
const MAX_ANSWERED = 50;

/**
 * Turns one run's hook events from Claude Code into signals for the panel. While Claude waits on
 * the user, for a permission or a question, tools that finish alongside don't make the run read
 * as working again: Claude often reads files while a permission prompt is open. It keeps where
 * the run stands too, for what waits while it has work going, such as an update.
 */
export class RunSignals {
  private readonly tell: (signal: RunSignal) => void;
  /** The tool calls waiting on the user, oldest first. */
  private readonly waiting: string[] = [];
  /**
   * Calls the user answered in the app, as they then run, whose PostToolUse settles nothing more:
   * another wait on the same tool is still waiting.
   */
  private readonly answeredInApp: string[] = [];
  /** Where the run stands, by the last signal, or null while Claude Code starts. */
  private last: RunSignal | null = null;

  constructor(emit: (signal: RunSignal) => void) {
    this.tell = emit;
  }

  /**
   * Whether the run has work going: Claude Code is starting, Claude is working, or it waits on the
   * user. One that's done, or ready with nothing to do yet, has none, so it can close.
   */
  hasWork(): boolean {
    return this.last !== 'done' && this.last !== 'ready';
  }

  /** Claude Code is past its first screens, with no prompt, waiting for what the user types. */
  ready(): void {
    this.emit('ready');
  }

  /**
   * A prompt went in, such as a task or the user's reply, so Claude has work going before its
   * hook says so. The hook tells the panel.
   */
  prompted(): void {
    this.last = 'working';
  }

  hear(event: unknown): void {
    if (typeof event !== 'object' || event === null) return;
    const fields = event as Record<string, unknown>;
    switch (fields.hook_event_name) {
      case 'UserPromptSubmit':
        this.waiting.length = 0;
        this.answeredInApp.length = 0;
        this.emit('working');
        return;
      case 'PreToolUse':
        if (fields.tool_name === 'AskUserQuestion') this.wait(fields);
        return;
      case 'PermissionRequest':
        this.wait(fields);
        return;
      case 'PostToolUse':
      case 'PostToolUseFailure':
        this.settle(fields);
        return;
      case 'Notification':
        if (
          fields.notification_type === 'permission_prompt' ||
          fields.notification_type === 'elicitation_dialog'
        ) {
          this.emit('needs-answer');
        }
        return;
      // A turn that ends in an error, such as a rate limit, is over too, and Claude Code waits
      // for the user's next message: the window says what the error was.
      case 'Stop':
      case 'StopFailure':
        this.waiting.length = 0;
        this.answeredInApp.length = 0;
        this.emit('done');
        return;
    }
  }

  /**
   * A round of questions or a permission prompt the user answered in the app, which Claude Code
   * no longer waits on them for: that call alone, by its tool and input. One that runs, with the
   * input it runs with, settles nothing more when its PostToolUse comes. One the user said no to
   * never runs, so nothing else says it's over.
   */
  answered(call: { tool_name: string; tool_input: unknown; ranWith: unknown }): void {
    const at = this.waiting.indexOf(waitKey(call));
    if (at >= 0) this.waiting.splice(at, 1);
    if (call.ranWith !== null) {
      this.answeredInApp.push(waitKey({ tool_name: call.tool_name, tool_input: call.ranWith }));
      if (this.answeredInApp.length > MAX_ANSWERED) this.answeredInApp.shift();
    }
    if (this.waiting.length === 0) this.emit('working');
  }

  private emit(signal: RunSignal): void {
    this.last = signal;
    this.tell(signal);
  }

  private wait(fields: Record<string, unknown>): void {
    this.waiting.push(waitKey(fields));
    this.emit('needs-answer');
  }

  /** A tool finished. If it was one the user had to answer for, it's no longer waiting. */
  private settle(fields: Record<string, unknown>): void {
    const key = waitKey(fields);
    // One the user answered in the app is over already.
    const answered = this.answeredInApp.indexOf(key);
    if (answered >= 0) {
      this.answeredInApp.splice(answered, 1);
      return;
    }
    let at = this.waiting.indexOf(key);
    // An input can come back reworded, so fall back to the oldest wait on the same tool.
    if (at < 0)
      at = this.waiting.findIndex((key) => key.startsWith(`${String(fields.tool_name)}:`));
    if (at >= 0) this.waiting.splice(at, 1);
    // A denied call never finishes, so the run waits on the user until their next message.
    if (this.waiting.length === 0) this.emit('working');
  }
}

/** The token in an `Authorization: Bearer <token>` header, if there is one. */
export function bearerToken(header: string | undefined): string | null {
  const match = /^Bearer ([0-9a-f]{64})$/.exec(header ?? '');
  return match?.[1] ?? null;
}

/** JSON text as a value, or null when it isn't JSON. */
export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
