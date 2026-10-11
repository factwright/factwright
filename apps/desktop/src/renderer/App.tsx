import type { FactwrightApi } from '../shared/api.ts';
import styles from './App.module.css';
import { ClaudePanel } from './ClaudePanel.tsx';
import { JobsPage } from './JobsPage.tsx';
import { isRunning } from './PanelHeader.tsx';
import { planName } from './plan.ts';
import { Sidebar } from './Sidebar.tsx';
import { TopBar } from './TopBar.tsx';
import { useClaudeRun } from './useClaudeRun.ts';
import { useClaudeStatus } from './useClaudeStatus.ts';

/** The app's window: the top bar, the sidebar, the page, and Claude's panel. */
export function App({ api }: { api: FactwrightApi }) {
  const { status, recheck } = useClaudeStatus(api);
  const run = useClaudeRun(api);
  const ready = status !== 'checking' && status.state === 'ready';
  const plan = ready ? planName(status.plan) : undefined;
  return (
    <div className={styles.app}>
      <TopBar platform={api.platform} />
      <div className={styles.body}>
        <Sidebar claude={status} onRecheckClaude={recheck} />
        <div className={styles.content}>
          <JobsPage
            canStartClaude={ready && !isRunning(run.phase)}
            onStartClaude={run.requestStart}
          />
          <ClaudePanel api={api} run={run} plan={plan} />
        </div>
      </div>
    </div>
  );
}
