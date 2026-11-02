import { ChevronRight } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import styles from './FoldedCard.module.css';

/**
 * A part of the Find jobs dialog that's folded until opened, on a card like the places', and says
 * what it holds while folded. In a small window it can open below what shows, so opening brings it
 * into view.
 */
export function FoldedCard({
  title,
  summary,
  children,
}: {
  title: string;
  /** What it's set to or holds: quiet, and the first to give way. */
  summary: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const card = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) card.current?.scrollIntoView({ block: 'nearest' });
  }, [open]);
  return (
    <div ref={card} className={`${styles.card} ${open ? styles.open : ''}`}>
      <button
        type="button"
        className={styles.toggle}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <ChevronRight className={styles.chevron} size={15} aria-hidden="true" />
        <span className={styles.title}>{title}</span>
        <span className={styles.summary}>{summary}</span>
      </button>
      {open && <div className={styles.body}>{children}</div>}
    </div>
  );
}
