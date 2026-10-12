import { ChevronRight } from 'lucide-react';
import { type ReactNode, useId } from 'react';
import { isBoolean, usePref } from '../prefs.ts';
import styles from './PanelSection.module.css';

export interface PanelSectionProps {
  /** Which section it is, so it stays open or closed as the user left it, for every job. */
  id: string;
  title: string;
  icon: ReactNode;
  /** A few words on what's in it, so it says something while it's closed. */
  summary?: ReactNode;
  /** Buttons for it, such as "Log a call", shown while it's open. */
  actions?: ReactNode;
  /** Starts closed, until the user opens it. */
  closedAtFirst?: boolean;
  children: ReactNode;
}

/**
 * One part of a job's panel, under a heading that opens and closes it. It stays as the user left
 * it, for every job, and keeps what's typed in it while it's closed.
 */
export function PanelSection({
  id,
  title,
  icon,
  summary,
  actions,
  closedAtFirst = false,
  children,
}: PanelSectionProps) {
  const [open, setOpen] = usePref(`panel.open.${id}`, !closedAtFirst, isBoolean);
  const titleId = useId();
  const bodyId = useId();
  return (
    <section className={styles.section} aria-labelledby={titleId} data-section={id}>
      <div className={styles.head}>
        <h3 className={styles.heading} aria-labelledby={titleId}>
          <button
            type="button"
            className={styles.toggle}
            aria-expanded={open}
            aria-controls={bodyId}
            onClick={() => setOpen(!open)}
          >
            <ChevronRight
              className={`${styles.chevron} ${open ? styles.turned : ''}`}
              size={15}
              strokeWidth={2.2}
              aria-hidden="true"
            />
            <span className={styles.icon} aria-hidden="true">
              {icon}
            </span>
            <span id={titleId} className={styles.title}>
              {title}
            </span>
            {summary && <span className={styles.summary}>{summary}</span>}
          </button>
        </h3>
        {open && actions && <div className={styles.actions}>{actions}</div>}
      </div>
      <div id={bodyId} className={styles.body} hidden={!open}>
        {children}
      </div>
    </section>
  );
}
