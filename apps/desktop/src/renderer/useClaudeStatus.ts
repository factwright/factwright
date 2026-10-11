import { useCallback, useEffect, useRef, useState } from 'react';
import type { ClaudeStatus, FactwrightApi } from '../shared/api.ts';

/** The user's Claude Code status, or "checking" while the first answer is on its way. */
export type ClaudeStatusView = ClaudeStatus | 'checking';

/**
 * Checks the user's Claude Code when the window opens, quietly again whenever it comes back into
 * focus (say, after signing in from Terminal), and on request.
 */
export function useClaudeStatus(api: FactwrightApi): {
  status: ClaudeStatusView;
  recheck: () => void;
} {
  const [status, setStatus] = useState<ClaudeStatusView>('checking');
  // Only the newest check's answer counts, if two overlap.
  const latest = useRef(0);

  const check = useCallback(
    (showChecking: boolean) => {
      const id = ++latest.current;
      if (showChecking) setStatus('checking');
      api.claudeStatus().then(
        (answer) => id === latest.current && setStatus(answer),
        () => id === latest.current && setStatus({ state: 'unknown' }),
      );
    },
    [api],
  );

  useEffect(() => {
    check(true);
    const onFocus = () => check(false);
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [check]);

  return { status, recheck: useCallback(() => check(true), [check]) };
}
