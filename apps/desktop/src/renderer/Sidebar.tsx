import { NavItem } from '@factwright/ui';
import { BookCheck, Briefcase, Flag, Heart, Puzzle, UserRound } from 'lucide-react';
import type { EditResult, SetupCheck } from '../shared/api.ts';
import type { ProfileEntry } from '../shared/profiles.ts';
import type { AskingView, RequestView, SyncStatus } from '../shared/sync.ts';
import type { UpdateStatus } from '../shared/updates.ts';
import { ClaudeCard } from './ClaudeCard.tsx';
import { LevelsChip } from './LevelsChip.tsx';
import { ProfileSwitcher } from './profiles/ProfileSwitcher.tsx';
import styles from './Sidebar.module.css';
import { SyncCard } from './sync/SyncCard.tsx';
import { UpdateCard } from './updates/UpdateCard.tsx';
import type { ClaudeStatusView } from './useClaudeStatus.ts';
import type { LevelChoices } from './useLevelChoices.ts';

/** The app's places: the jobs, the fact bank, and everything else about the user. */
export type Page = 'jobs' | 'facts' | 'profile';

/** Steve Hillyer's page on Buy Me a Coffee, where anyone can chip in with a card and no account. */
const COFFEE_URL = 'https://buymeacoffee.com/stevehillyer';

/** Where Report a problem writes to, such as about something wrong that Claude wrote. */
const REPORT_EMAIL = 'steve@factwright.com';

/**
 * Report a problem's email, as a draft in the user's own mail app, which they send themselves:
 * the app sends nothing. It names the version, and asks what happened and where. The Microsoft
 * Store asks an app that shows what an AI writes to let people report it, from inside the app.
 */
export function reportUrl(version: string): string {
  const subject = version ? `A problem in Factwright ${version}` : 'A problem in Factwright';
  const body =
    'What happened, and where? If it’s something Claude wrote, paste it here or attach a screenshot, and say which job it was for.\n\n';
  return `mailto:${REPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/**
 * The sidebar: the open profile when there's more than one, the app's places, then an update when
 * there's one, sync, the user's Claude and the levels it runs at, the browser extension, a way to
 * support Factwright, a way to report a problem, and Factwright's version, so an update shows it
 * landed.
 */
export function Sidebar({
  profiles,
  page,
  onPage,
  gettingStarted,
  claude,
  onRecheckClaude,
  claudeSignIn,
  copyText,
  terminal,
  setup,
  sync,
  linkRequests = [],
  linkAsking = null,
  onOpenSync,
  onOpenClaude,
  onOpenClaudeSettings,
  onOpenExtension,
  levels,
  jobCount,
  factCount,
  factsToVerify,
  update,
  version,
}: {
  /** The profiles on this computer, and switching between them, once they've loaded. */
  profiles?: {
    list: ProfileEntry[];
    busy: boolean;
    onOpen: (profile: ProfileEntry) => void;
    onAdd: () => void;
    onManage: () => void;
  };
  page: Page;
  onPage: (page: Page) => void;
  /** Whether the user is still getting started, which their profile page walks them through. */
  gettingStarted: boolean;
  claude: ClaudeStatusView;
  onRecheckClaude: () => void;
  /** An added profile's own Claude sign-in command, for its card to copy when it's signed out. */
  claudeSignIn?: string | undefined;
  /** Copies a command for the user's terminal that's long to type. */
  copyText?: ((text: string) => Promise<EditResult>) | undefined;
  /** Where the user runs Claude Code's commands: PowerShell on Windows, Terminal on a Mac. */
  terminal?: string;
  /** The latest check of Factwright's setup, and how to run it again. */
  setup: { check: SetupCheck | null; checking: boolean; checkAgain: () => void };
  sync: SyncStatus | 'checking';
  /** Other devices asking to link, which this computer can approve. */
  linkRequests?: RequestView[];
  /** This computer, asking to be linked. */
  linkAsking?: AskingView | null;
  onOpenSync: () => void;
  /** Opens Claude's panel, when it isn't open, for Claude Code's first-run screens. */
  onOpenClaude?: (() => void) | undefined;
  /** Opens Claude's settings: its model, and what it may do without asking. */
  onOpenClaudeSettings: () => void;
  /**
   * Opens Save to Factwright's window: the browser extension, where to get it, and saving straight
   * to Factwright on this computer, which works whatever sync is doing.
   */
  onOpenExtension: () => void;
  /** The user's choices of model and effort, once they've loaded. */
  levels: LevelChoices | null;
  /** How many jobs there are, once they've loaded. */
  jobCount?: number | undefined;
  /** How many facts the fact bank holds, once there are some. */
  factCount?: number | undefined;
  /** How many of them wait for the user to verify them, which shows in place of the count. */
  factsToVerify?: number | undefined;
  /** An update to Factwright that's ready to install, and restarting into it. */
  update: { status: UpdateStatus; busy: boolean; unsaved: () => boolean; onRestart: () => void };
  /** Factwright's version, such as "0.1.1". */
  version: string;
}) {
  return (
    <aside className={styles.sidebar}>
      {profiles && profiles.list.length > 1 && (
        <ProfileSwitcher
          profiles={profiles.list}
          busy={profiles.busy}
          onOpen={profiles.onOpen}
          onAdd={profiles.onAdd}
          onManage={profiles.onManage}
        />
      )}
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
          {...(factsToVerify && { waiting: { count: factsToVerify, label: 'to verify' } })}
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
        <SyncCard status={sync} requests={linkRequests} asking={linkAsking} onOpen={onOpenSync} />
        <div className={styles.claude}>
          <ClaudeCard
            status={claude}
            onRecheck={onRecheckClaude}
            signIn={claudeSignIn}
            copy={copyText}
            {...(terminal && { terminal })}
            setup={setup.check}
            checkingSetup={setup.checking}
            onCheckSetup={setup.checkAgain}
            onOpenClaude={onOpenClaude}
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
          <button type="button" className={styles.link} onClick={onOpenExtension}>
            <Puzzle size={14} aria-hidden="true" />
            Browser extension
          </button>
          <a
            className={`${styles.link} ${styles.support}`}
            href={COFFEE_URL}
            target="_blank"
            rel="noreferrer"
          >
            <Heart size={14} aria-hidden="true" />
            Support Factwright
          </a>
          <a className={styles.link} href={reportUrl(version)} target="_blank" rel="noreferrer">
            <Flag size={14} aria-hidden="true" />
            Report a problem
          </a>
          {version && <p className={styles.version}>Factwright {version}</p>}
        </div>
      </div>
    </aside>
  );
}
