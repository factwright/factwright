import { VisuallyHidden } from '@factwright/ui';
import { Fragment } from 'react';
import styles from './SyncDialog.module.css';

/**
 * A long code, such as a recovery key, as two rows of four groups: easier to read and copy down
 * than one long line. The dashes are there for screen readers and for copying, just not shown.
 */
export function Groups({ code, className }: { code: string; className?: string | undefined }) {
  return (
    <code className={`${styles.groups} ${className ?? ''}`}>
      {code.split('-').map((group, index) => (
        // Groups can repeat, so a group's place is what tells it apart.
        <Fragment key={`${index}:${group}`}>
          {index > 0 && <VisuallyHidden>-</VisuallyHidden>}
          <span>{group}</span>
        </Fragment>
      ))}
    </code>
  );
}
