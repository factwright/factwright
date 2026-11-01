import { Button, Dialog, DialogActions, Markdown } from '@factwright/ui';
import { ArrowUpRight } from 'lucide-react';
import { useId } from 'react';
import styles from './JustUpdated.module.css';

/** A version's full notes: its release on GitHub, from release-notes/<version>.md. */
const fullNotes = (version: string) =>
  `https://github.com/factwright/factwright/releases/tag/v${version}`;

/** What's new in the version just installed, in a few plain lines, on the first open after it. */
export function JustUpdated({
  version,
  notes,
  onClose,
}: {
  version: string;
  notes: string;
  onClose: () => void;
}) {
  const notesId = useId();
  return (
    // It starts on Got it, so the dialog's description is what has a screen reader say the lines.
    <Dialog title={`What’s new in ${version}`} describedBy={notesId} onClose={onClose}>
      {(close) => (
        <>
          <div id={notesId}>
            <Markdown text={notes} />
          </div>
          <DialogActions>
            <a className={styles.link} href={fullNotes(version)} target="_blank" rel="noreferrer">
              Read the full notes
              <ArrowUpRight size={13} aria-hidden="true" />
            </a>
            <Button variant="primary" data-autofocus onClick={close}>
              Got it
            </Button>
          </DialogActions>
        </>
      )}
    </Dialog>
  );
}
