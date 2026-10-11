import { Button, Notice, RunStatus } from '@factwright/ui';
import type { FactwrightApi } from '../shared/api.ts';
import styles from './ClaudePanel.module.css';
import { chipState, isRunning, PanelHeader } from './PanelHeader.tsx';
import { TerminalView } from './TerminalView.tsx';
import type { ClaudeRun } from './useClaudeRun.ts';

/**
 * Claude's panel along the bottom of the window: the user's own Claude Code, live. It can tuck
 * away into a slim bar while Claude works, and comes back when Claude needs the user.
 */
export function ClaudePanel({
  api,
  run,
  plan,
  title = 'Claude',
}: {
  api: FactwrightApi;
  run: ClaudeRun;
  plan: string | undefined;
  /** What the run is, such as "Fit check · Acme". */
  title?: string;
}) {
  if (run.phase === 'idle' && !run.problem) return null;
  const hidden = !run.open && isRunning(run.phase);
  // The question about trust waits on the user like any other.
  const shown = run.trustAsked ? 'needs-answer' : run.phase;
  return (
    <>
      <section className={`${styles.panel} ${hidden ? styles.hidden : ''}`} aria-label="Claude">
        <PanelHeader
          title={title}
          phase={shown}
          plan={plan}
          problem={run.problem}
          onStop={run.stop}
          onHide={run.hide}
          onClose={run.close}
        />
        {run.trustAsked && (
          <div className={styles.trust}>
            <Notice title="Claude Code asks once whether to trust your workspace">
              Use the arrow keys to pick “Yes, I trust this folder”, then press Enter. Its note
              about running files doesn’t apply here: in Factwright, Claude Code has no shell, so it
              can’t run programs. It only reads and writes files in your workspace, and asks you
              before it writes.
            </Notice>
          </div>
        )}
        {run.phase !== 'idle' && (
          <TerminalView key={run.runId} api={api} onSize={run.onTerminalSize} onTyped={run.typed} />
        )}
      </section>
      {hidden && (
        <div className={styles.slim}>
          <span role="status">
            <RunStatus state={chipState(shown, run.problem)} />
          </span>
          <span className={styles.title}>{title}</span>
          <Button className={styles.show} size="sm" onClick={run.show}>
            Show Claude
          </Button>
        </div>
      )}
    </>
  );
}
