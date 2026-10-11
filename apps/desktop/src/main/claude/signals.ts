import type { RunSignal } from '../../shared/api.ts';

/** What a hook event from Claude Code means for the panel, or null when it changes nothing. */
export function signalFor(event: unknown): RunSignal | null {
  if (typeof event !== 'object' || event === null) return null;
  const fields = event as Record<string, unknown>;
  switch (fields.hook_event_name) {
    case 'UserPromptSubmit':
    case 'PostToolUse':
      return 'working';
    case 'PreToolUse':
      return fields.tool_name === 'AskUserQuestion' ? 'needs-answer' : null;
    case 'PermissionRequest':
      return 'needs-answer';
    case 'Notification':
      return fields.notification_type === 'permission_prompt' ||
        fields.notification_type === 'elicitation_dialog'
        ? 'needs-answer'
        : null;
    case 'Stop':
      return 'done';
    default:
      return null;
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
