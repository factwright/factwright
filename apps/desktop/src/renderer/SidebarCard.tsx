import { Button } from '@factwright/ui';
import { type ReactNode, useId } from 'react';
import styles from './SidebarCard.module.css';

/** The dot's color: fine, needs the user, broken, busy, or switched off. */
export type CardTone = 'ok' | 'need' | 'bad' | 'checking' | 'off';

export interface CardAction {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}

/**
 * A card at the bottom of the sidebar for something that runs in the background, such as the
 * user's Claude or sync: a dot and a line for how it stands, help when it needs some, and one
 * button for what to do next.
 */
export function SidebarCard({
  title,
  tone,
  line,
  help,
  action,
  live = true,
}: {
  title: string;
  tone: CardTone;
  line: ReactNode;
  help?: ReactNode;
  action?: CardAction | null;
  /**
   * Whether screen readers read the line out when it changes. A line that changes by itself all the
   * time, such as how far a download has got, isn't.
   */
  live?: boolean;
}) {
  const titleId = useId();
  return (
    <section className={styles.card} aria-labelledby={titleId}>
      <h2 id={titleId} className={styles.title}>
        <span className={`${styles.dot} ${styles[tone]}`} aria-hidden="true" />
        {title}
      </h2>
      <p className={styles.line} aria-live={live ? 'polite' : undefined}>
        {line}
      </p>
      {help && <p className={styles.help}>{help}</p>}
      {action && (
        <Button
          className={styles.action}
          size="sm"
          disabled={action.disabled}
          onClick={action.onClick}
        >
          {action.label}
        </Button>
      )}
    </section>
  );
}
