import { Button } from '@factwright/ui';
import { CircleAlert, CircleArrowUp } from 'lucide-react';
import { useState } from 'react';
import type { UpdateStatus } from '../../shared/updates.ts';
import styles from './UpdateBanner.module.css';
import { useRestart } from './useRestart.ts';
import { WhatsNew } from './WhatsNew.tsx';

/**
 * The strip across the window, under the top bar, once an update has downloaded: it asks the user
 * to restart into it, so they're on the latest version. Remind me tomorrow puts it off for the
 * day, while the sidebar's card keeps the update, which installs the next time the user quits
 * anyway. While Claude is working, or waits on the user, restarting would stop the run, so
 * Restart now waits until Claude is done.
 */
export function UpdateBanner({
  status,
  busy,
  unsaved,
  onRestart,
  onPutOff,
}: {
  status: UpdateStatus;
  /** Whether Claude has work going, which a restart would stop: working, or waiting on the user. */
  busy: boolean;
  /** Whether the user is writing something they haven't saved, which a restart would lose. */
  unsaved: () => boolean;
  /** Restarts into the update. Answers whether it is, as it isn't while Claude has work going. */
  onRestart: () => Promise<boolean>;
  /** Puts the strip off until tomorrow. */
  onPutOff: () => void;
}) {
  const [reading, setReading] = useState(false);
  const restart = useRestart(unsaved, onRestart);
  if (status.state !== 'ready') return null;
  const { version, notes } = status;
  if (restart.asking && !busy) {
    return (
      <section className={`${styles.banner} ${styles.need}`} aria-label="Update">
        <CircleAlert className={styles.icon} size={18} aria-hidden="true" />
        <p className={styles.text} aria-live="polite">
          <strong>Something you’re writing isn’t saved.</strong> Save it first, or restart now and
          lose it.
        </p>
        <div className={styles.actions}>
          <Button size="sm" variant="quiet" onClick={restart.cancel}>
            Cancel
          </Button>
          <Button size="sm" variant="primary" onClick={restart.restartAnyway}>
            Restart anyway
          </Button>
        </div>
      </section>
    );
  }
  return (
    <section className={styles.banner} aria-label="Update">
      <CircleArrowUp className={styles.icon} size={18} aria-hidden="true" />
      <p className={styles.text} aria-live="polite">
        <strong>Please update Factwright.</strong>{' '}
        {busy
          ? `Version ${version} is ready. You can restart into it once Claude is done, or it installs the next time you quit.`
          : restart.refused
            ? 'Factwright didn’t restart. Try again once Claude is done.'
            : `Version ${version} is ready to install, and your job hunt stays as it is.`}
      </p>
      <div className={styles.actions}>
        {notes && (
          <Button size="sm" variant="quiet" onClick={() => setReading(true)}>
            What’s new
          </Button>
        )}
        <Button size="sm" variant="quiet" onClick={onPutOff}>
          Remind me tomorrow
        </Button>
        {!busy && (
          <Button
            size="sm"
            variant="primary"
            disabled={restart.restarting}
            onClick={restart.request}
          >
            {restart.restarting ? 'Restarting…' : 'Restart now'}
          </Button>
        )}
      </div>
      {reading && notes && (
        <WhatsNew version={version} notes={notes} onClose={() => setReading(false)} />
      )}
    </section>
  );
}
