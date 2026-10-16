import type { RunSignal } from '../../shared/api.ts';

/** A tool call waiting on the user, by its tool and input, since PermissionRequest has no id. */
const waitKey = (fields: Record<string, unknown>) =>
  `${String(fields.tool_name)}:${JSON.stringify(fields.tool_input ?? null)}`;

/**
 * Turns one run's hook events from Claude Code into signals for the panel. While Claude waits on
 * the user, for a permission or a question, tools that finish alongside don't make the run read
 * as working again: Claude often reads files while a permission prompt is open.
 */
export class RunSignals {
  private readonly emit: (signal: RunSignal) => void;
  /** The tool calls waiting on the user, oldest first. */
  private readonly waiting: string[] = [];

  constructor(emit: (signal: RunSignal) => void) {
    this.emit = emit;
  }

  hear(event: unknown): void {
    if (typeof event !== 'object' || event === null) return;
    const fields = event as Record<string, unknown>;
    switch (fields.hook_event_name) {
      case 'UserPromptSubmit':
        this.waiting.length = 0;
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
      case 'Stop':
        this.waiting.length = 0;
        this.emit('done');
        return;
    }
  }

  /**
   * A permission prompt the user answered no to in the app. Its call never runs, so nothing else
   * says it's over.
   */
  answered(call: { tool_name: string; tool_input: unknown }): void {
    this.settle(call);
  }

  private wait(fields: Record<string, unknown>): void {
    this.waiting.push(waitKey(fields));
    this.emit('needs-answer');
  }

  /** A tool finished. If it was one the user had to answer for, it's no longer waiting. */
  private settle(fields: Record<string, unknown>): void {
    let at = this.waiting.indexOf(waitKey(fields));
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
