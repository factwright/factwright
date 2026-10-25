import { Dialog, Markdown } from '@factwright/ui';
import { useState } from 'react';
import type { UpdateStatus } from '../../shared/updates.ts';
import { SidebarCard } from '../SidebarCard.tsx';
import styles from './UpdateCard.module.css';

/**
 * The card at the bottom of the sidebar once an update has downloaded: restart into it now, or
 * it installs the next time the user quits. While Claude is working, or waits on the user,
 * restarting would stop the run, so Restart now waits until Claude is done. Claude Code that's
 * done closes as the app restarts.
 */
export function UpdateCard({
  status,
  busy,
  unsaved,
  onRestart,
}: {
  status: UpdateStatus;
  /** Whether Claude has work going, which a restart would stop: working, or waiting on the user. */
  busy: boolean;
  /** Whether the user is writing something they haven't saved, which a restart would lose. */
  unsaved: () => boolean;
  onRestart: () => void;
}) {
  const [reading, setReading] = useState(false);
  const [asking, setAsking] = useState(false);
  if (status.state !== 'ready') return null;
  const { version, notes } = status;
  const link = (label: string, onClick: () => void) => (
    <button type="button" className={styles.link} onClick={onClick}>
      {label}
    </button>
  );
  if (asking && !busy) {
    return (
      <SidebarCard
        title="Update ready"
        tone="need"
        line="Something you’re writing isn’t saved"
        help={
          <>Save it first, or restart now and lose it. {link('Not now', () => setAsking(false))}</>
        }
        action={{ label: 'Restart anyway', onClick: onRestart }}
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
              : 'It installs when you restart, or the next time you quit.'}
            {notes && <> {link('What’s new', () => setReading(true))}</>}
          </>
        }
        action={
          busy
            ? null
            : {
                label: 'Restart now',
                onClick: () => (unsaved() ? setAsking(true) : onRestart()),
              }
        }
      />
      {reading && notes && (
        <Dialog
          title={`What’s new in Factwright ${version}`}
          size="lg"
          onClose={() => setReading(false)}
        >
          <Markdown text={notes} />
        </Dialog>
      )}
    </>
  );
}
