import { NavItem } from '@factwright/ui';
import { Briefcase } from 'lucide-react';
import type { SetupCheck } from '../shared/api.ts';
import type { SyncStatus } from '../shared/sync.ts';
import { ClaudeCard } from './ClaudeCard.tsx';
import styles from './Sidebar.module.css';
import { SyncCard } from './sync/SyncCard.tsx';
import type { ClaudeStatusView } from './useClaudeStatus.ts';

/** The sidebar: the app's places, then sync and the user's Claude at the bottom. */
export function Sidebar({
  claude,
  onRecheckClaude,
  setup,
  sync,
  onOpenSync,
  onOpenPermissions,
  jobCount,
}: {
  claude: ClaudeStatusView;
  onRecheckClaude: () => void;
  /** The latest check of Factwright's setup, and how to run it again. */
  setup: { check: SetupCheck | null; checking: boolean; checkAgain: () => void };
  sync: SyncStatus | 'checking';
  onOpenSync: () => void;
  /** Opens what Claude may do without asking. */
  onOpenPermissions: () => void;
  /** How many jobs there are, once they've loaded. */
  jobCount?: number | undefined;
}) {
  return (
    <aside className={styles.sidebar}>
      <nav className={styles.nav} aria-label="Main">
        <NavItem
          icon={<Briefcase size={16} aria-hidden="true" />}
          label="Jobs"
          count={jobCount}
          current
        />
      </nav>
      <div className={styles.cards}>
        <SyncCard status={sync} onOpen={onOpenSync} />
        <ClaudeCard
          status={claude}
          onRecheck={onRecheckClaude}
          setup={setup.check}
          checkingSetup={setup.checking}
          onCheckSetup={setup.checkAgain}
          onPermissions={onOpenPermissions}
        />
      </div>
    </aside>
  );
}
