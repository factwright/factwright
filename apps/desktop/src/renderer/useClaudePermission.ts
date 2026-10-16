import type { FactwrightApi } from '../shared/api.ts';
import type { PermissionAsk } from '../shared/permission-asks.ts';
import { useWaiting } from './useWaiting.ts';

export interface ClaudePermission {
  /** The permission prompt Claude Code is waiting on the user to answer, or null. */
  ask: PermissionAsk | null;
  /** Whether its dialog is open. The user can put it aside and open it again from Claude's panel. */
  open: boolean;
  show: () => void;
  hide: () => void;
}

/** Follows the permission prompts Claude Code waits on the user to answer, opening each new one. */
export function useClaudePermission(
  api: Pick<FactwrightApi, 'claudePermission' | 'onClaudePermission'>,
): ClaudePermission {
  const { item: ask, ...rest } = useWaiting(api.claudePermission, api.onClaudePermission);
  return { ask, ...rest };
}
