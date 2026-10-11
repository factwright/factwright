import { Button, RunStatus } from '@factwright/ui';
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
  return (
    <>
      <section className={`${styles.panel} ${hidden ? styles.hidden : ''}`} aria-label="Claude">
        <PanelHeader
          title={title}
          phase={run.phase}
          plan={plan}
          problem={run.problem}
          onStop={run.stop}
          onHide={run.hide}
          onClose={run.close}
        />
        {run.phase !== 'idle' && (
          <TerminalView key={run.runId} api={api} onSize={run.onTerminalSize} />
        )}
      </section>
      {hidden && (
        <div className={styles.slim}>
          <span role="status">
            <RunStatus state={chipState(run.phase, run.problem)} />
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
