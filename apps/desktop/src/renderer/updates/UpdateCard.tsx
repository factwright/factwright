import { Dialog, Markdown } from '@factwright/ui';
import { useState } from 'react';
import type { UpdateStatus } from '../../shared/updates.ts';
import { SidebarCard } from '../SidebarCard.tsx';
import styles from './UpdateCard.module.css';

/**
 * The card at the bottom of the sidebar once an update has downloaded: restart into it now, or
 * it installs the next time the user quits. While Claude is working, restarting would stop the
 * run, so the card waits for quitting instead.
 */
export function UpdateCard({
  status,
  busy,
  onRestart,
}: {
  status: UpdateStatus;
  /** Whether Claude is working, which a restart would stop. */
  busy: boolean;
  onRestart: () => void;
}) {
  const [reading, setReading] = useState(false);
  if (status.state !== 'ready') return null;
  const { version, notes } = status;
  return (
    <>
      <SidebarCard
        title="Update ready"
        tone="ok"
        line={`Factwright ${version}`}
        help={
          <>
            {busy
              ? 'It installs the next time you quit, once your Claude is done.'
              : 'It installs when you restart, or the next time you quit.'}
            {notes && (
              <>
                {' '}
                <button type="button" className={styles.link} onClick={() => setReading(true)}>
                  What’s new
                </button>
              </>
            )}
          </>
        }
        action={busy ? null : { label: 'Restart now', onClick: onRestart }}
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
