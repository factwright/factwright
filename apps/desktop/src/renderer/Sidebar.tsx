import { NavItem } from '@factwright/ui';
import { Briefcase } from 'lucide-react';
import { ClaudeCard } from './ClaudeCard.tsx';
import styles from './Sidebar.module.css';
import type { ClaudeStatusView } from './useClaudeStatus.ts';

/** The sidebar: the app's places, and the user's Claude at the bottom. */
export function Sidebar({
  claude,
  onRecheckClaude,
}: {
  claude: ClaudeStatusView;
  onRecheckClaude: () => void;
}) {
  return (
    <aside className={styles.sidebar}>
      <nav className={styles.nav} aria-label="Main">
        <NavItem icon={<Briefcase size={16} aria-hidden="true" />} label="Jobs" current />
      </nav>
      <div className={styles.claude}>
        <ClaudeCard status={claude} onRecheck={onRecheckClaude} />
      </div>
    </aside>
  );
}
