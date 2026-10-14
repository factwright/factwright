import { NavItem } from '@factwright/ui';
import { BookCheck, Briefcase, Heart, UserRound } from 'lucide-react';
import type { SetupCheck } from '../shared/api.ts';
import type { SyncStatus } from '../shared/sync.ts';
import type { UpdateStatus } from '../shared/updates.ts';
import { ClaudeCard } from './ClaudeCard.tsx';
import { LevelsChip } from './LevelsChip.tsx';
import styles from './Sidebar.module.css';
import { SyncCard } from './sync/SyncCard.tsx';
import { UpdateCard } from './updates/UpdateCard.tsx';
import type { ClaudeStatusView } from './useClaudeStatus.ts';
import type { LevelChoices } from './useLevelChoices.ts';

/** The app's places: the jobs, the fact bank, and everything else about the user. */
export type Page = 'jobs' | 'facts' | 'profile';

/** Steve Hillyer's page on Buy Me a Coffee, where anyone can chip in with a card and no account. */
const COFFEE_URL = 'https://buymeacoffee.com/stevehillyer';

/**
 * The sidebar: the app's places, then an update when there's one, sync, the user's Claude and the
 * levels it runs at, a way to support Factwright, and Factwright's version, so an update shows it
 * landed.
 */
export function Sidebar({
  page,
  onPage,
  gettingStarted,
  claude,
  onRecheckClaude,
  setup,
  sync,
  onOpenSync,
  onOpenClaudeSettings,
  levels,
  jobCount,
  factCount,
  update,
  version,
}: {
  page: Page;
  onPage: (page: Page) => void;
  /** Whether the user is still getting started, which their profile page walks them through. */
  gettingStarted: boolean;
  claude: ClaudeStatusView;
  onRecheckClaude: () => void;
  /** The latest check of Factwright's setup, and how to run it again. */
  setup: { check: SetupCheck | null; checking: boolean; checkAgain: () => void };
  sync: SyncStatus | 'checking';
  onOpenSync: () => void;
  /** Opens Claude's settings: its model, and what it may do without asking. */
  onOpenClaudeSettings: () => void;
  /** The user's choices of model and effort, once they've loaded. */
  levels: LevelChoices | null;
  /** How many jobs there are, once they've loaded. */
  jobCount?: number | undefined;
  /** How many facts the fact bank holds, once there are some. */
  factCount?: number | undefined;
  /** An update to Factwright that's ready to install, and restarting into it. */
  update: { status: UpdateStatus; busy: boolean; unsaved: () => boolean; onRestart: () => void };
  /** Factwright's version, such as "0.1.1". */
  version: string;
}) {
  return (
    <aside className={styles.sidebar}>
      <nav className={styles.nav} aria-label="Main">
        <NavItem
          icon={<Briefcase size={16} aria-hidden="true" />}
          label="Jobs"
          count={jobCount}
          current={page === 'jobs'}
          onClick={() => onPage('jobs')}
        />
        <NavItem
          icon={<BookCheck size={16} aria-hidden="true" />}
          label="Fact bank"
          count={factCount}
          current={page === 'facts'}
          onClick={() => onPage('facts')}
        />
        <NavItem
          icon={<UserRound size={16} aria-hidden="true" />}
          label={gettingStarted ? 'Get started' : 'Profile'}
          current={page === 'profile'}
          onClick={() => onPage('profile')}
        />
      </nav>
      <div className={styles.cards}>
        <UpdateCard
          status={update.status}
          busy={update.busy}
          unsaved={update.unsaved}
          onRestart={update.onRestart}
        />
        <SyncCard status={sync} onOpen={onOpenSync} />
        <div className={styles.claude}>
          <ClaudeCard
            status={claude}
            onRecheck={onRecheckClaude}
            setup={setup.check}
            checkingSetup={setup.checking}
            onCheckSetup={setup.checkAgain}
            onSettings={onOpenClaudeSettings}
          />
          {claude !== 'checking' && claude.state === 'ready' && levels && (
            <LevelsChip
              plan={claude.plan}
              method={claude.method}
              models={levels.models}
              effort={levels.effort}
              onOpen={onOpenClaudeSettings}
            />
          )}
        </div>
        <div className={styles.footer}>
          <a className={styles.support} href={COFFEE_URL} target="_blank" rel="noreferrer">
            <Heart size={14} aria-hidden="true" />
            Support Factwright
          </a>
          {version && <p className={styles.version}>Factwright {version}</p>}
        </div>
      </div>
    </aside>
  );
}
