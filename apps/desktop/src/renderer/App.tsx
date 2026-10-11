import type { FactwrightApi } from '../shared/api.ts';
import styles from './App.module.css';
import { JobsPage } from './JobsPage.tsx';
import { Sidebar } from './Sidebar.tsx';
import { TopBar } from './TopBar.tsx';
import { useClaudeStatus } from './useClaudeStatus.ts';

/** The app's window: the top bar, the sidebar and the page. */
export function App({ api }: { api: FactwrightApi }) {
  const { status, recheck } = useClaudeStatus(api);
  return (
    <div className={styles.app}>
      <TopBar platform={api.platform} />
      <div className={styles.body}>
        <Sidebar claude={status} onRecheckClaude={recheck} />
        <JobsPage />
      </div>
    </div>
  );
}
