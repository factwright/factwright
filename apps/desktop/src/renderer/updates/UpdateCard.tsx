import { useState } from 'react';
import type { UpdateStatus } from '../../shared/updates.ts';
import { SidebarCard } from '../SidebarCard.tsx';
import styles from './UpdateCard.module.css';
import { useRestart } from './useRestart.ts';
import { WhatsNew } from './WhatsNew.tsx';

/**
 * The card at the bottom of the sidebar for an update: how far its download has got, then, once
 * the user puts off the strip across the window, the update that's ready: restart into it now, or
 * it installs the next time the user quits. While the strip shows, it says so itself, and the card
 * stays out of the way. While Claude is working, or waits on the user, restarting would stop the
 * run, so Restart now waits until Claude is done.
 */
export function UpdateCard({
  status,
  inBanner,
  busy,
  unsaved,
  onRestart,
}: {
  status: UpdateStatus;
  /** Whether the strip across the window shows the update that's ready. */
  inBanner: boolean;
  /** Whether Claude has work going, which a restart would stop: working, or waiting on the user. */
  busy: boolean;
  /** Whether the user is writing something they haven't saved, which a restart would lose. */
  unsaved: () => boolean;
  /** Restarts into the update. Answers whether it is, as it isn't while Claude has work going. */
  onRestart: () => Promise<boolean>;
}) {
  const [reading, setReading] = useState(false);
  const restart = useRestart(unsaved, onRestart);
  if (status.state === 'downloading') {
    return (
      <SidebarCard
        title="Downloading an update"
        tone="checking"
        line={`Factwright ${status.version} · ${status.percent < 100 ? `${status.percent}%` : 'almost ready'}`}
        help="You can keep working meanwhile."
        live={false}
      />
    );
  }
  if (status.state !== 'ready' || inBanner) return null;
  const { version, notes } = status;
  const link = (label: string, onClick: () => void) => (
    <button type="button" className={styles.link} onClick={onClick}>
      {label}
    </button>
  );
  if (restart.asking && !busy) {
    return (
      <SidebarCard
        title="Update ready"
        tone="need"
        line="Something you’re writing isn’t saved"
        help={<>Save it first, or restart now and lose it. {link('Not now', restart.cancel)}</>}
        action={{ label: 'Restart anyway', onClick: restart.restartAnyway }}
      />
    );
  }
  return (
    <>
      <SidebarCard
        title="Update ready"
        tone="ok"
        line={`Factwright ${version}`}
        help={
          <>
            {busy
              ? 'You can restart into it once Claude is done, or it installs the next time you quit.'
              : restart.refused
                ? 'Factwright didn’t restart. Try again once Claude is done.'
                : 'It installs when you restart, or the next time you quit.'}
            {notes && <> {link('What’s new', () => setReading(true))}</>}
          </>
        }
        action={
          busy
            ? null
            : restart.restarting
              ? { label: 'Restarting…', onClick: () => {}, disabled: true }
              : { label: 'Restart now', onClick: restart.request }
        }
      />
      {reading && notes && (
        <WhatsNew version={version} notes={notes} onClose={() => setReading(false)} />
      )}
    </>
  );
}
