import { ChevronRight } from 'lucide-react';
import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { isBoolean, usePref } from '../prefs.ts';
import styles from './PanelSection.module.css';

/** The event that asks a section of the job's panel to open and come into view, by its id. */
const SHOW = 'factwright:show-section';

/**
 * Opens a section of the job's panel and scrolls to it, such as Calls and interviews when a call
 * needs saying how it went. Nothing happens when the panel has no such section.
 */
export function showSection(id: string): void {
  window.dispatchEvent(new CustomEvent(SHOW, { detail: id }));
}

export interface PanelSectionProps {
  /** Which section it is, so it stays open or closed as the user left it, for every job. */
  id: string;
  title: string;
  icon: ReactNode;
  /** A few words on what's in it, so it says something while it's closed. */
  summary?: ReactNode;
  /** How many things it holds, such as resumes and letters, beside its title. */
  count?: number;
  /** Buttons for it, such as "Add a call", shown while it's open. */
  actions?: ReactNode;
  /** Starts closed, until the user opens it. */
  closedAtFirst?: boolean;
  /**
   * Holds nothing yet, so it stays open on what goes there and the button that makes it, such
   * as Tailor a resume, with nothing to close.
   */
  empty?: boolean;
  children: ReactNode;
}

/**
 * One part of a job's panel, under a heading that opens and closes it. It stays as the user left
 * it, for every job, and keeps what's typed in it while it's closed. One with nothing in it yet
 * stays open, on what goes there.
 */
export function PanelSection({
  id,
  title,
  icon,
  summary,
  count,
  actions,
  closedAtFirst = false,
  empty = false,
  children,
}: PanelSectionProps) {
  const [shut, setOpen] = usePref(`panel.open.${id}`, !closedAtFirst, isBoolean);
  const open = empty || shut;
  const titleId = useId();
  const bodyId = useId();
  const section = useRef<HTMLElement>(null);
  // Shown to the user, it lights up for a moment, so it's clear which it is.
  const [lit, setLit] = useState(false);
  useEffect(() => {
    const show = (event: Event) => {
      if ((event as CustomEvent<unknown>).detail !== id) return;
      setOpen(true);
      setLit(true);
      // Once it's open, so it scrolls to where its body starts too.
      requestAnimationFrame(() =>
        section.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }),
      );
    };
    window.addEventListener(SHOW, show);
    return () => window.removeEventListener(SHOW, show);
  }, [id, setOpen]);
  const named = (
    <>
      <span className={styles.icon} aria-hidden="true">
        {icon}
      </span>
      <span id={titleId} className={styles.title}>
        {title}
      </span>
      {/* The summary says it in words, for screen readers. */}
      {count !== undefined && count > 0 && (
        <span className={styles.count} aria-hidden="true">
          {count}
        </span>
      )}
      {summary && <span className={styles.summary}>{summary}</span>}
    </>
  );
  return (
    <section
      ref={section}
      className={`${styles.section} ${lit ? styles.lit : ''}`}
      aria-labelledby={titleId}
      data-section={id}
      onAnimationEnd={() => setLit(false)}
    >
      <div className={styles.head}>
        <h3 className={styles.heading} aria-labelledby={titleId}>
          {empty ? (
            <span className={styles.toggle}>
              <span className={styles.chevron} aria-hidden="true" />
              {named}
            </span>
          ) : (
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
              {named}
            </button>
          )}
        </h3>
        {open && actions && <div className={styles.actions}>{actions}</div>}
      </div>
      <div id={bodyId} className={styles.body} hidden={!open}>
        {children}
      </div>
    </section>
  );
}

/**
 * What goes in a part of the panel that holds nothing yet, in a few words, and the button that
 * makes it, such as "A resume for this job" and Tailor a resume.
 */
export function Placeholder({
  title,
  children,
  action,
}: {
  /** What it's for, when an area has more than one, such as Resume and Cover letter. */
  title?: string;
  children: ReactNode;
  action: ReactNode;
}) {
  return (
    <div className={styles.placeholder}>
      <div className={styles.placeholderText}>
        {title && <h4 className={styles.placeholderTitle}>{title}</h4>}
        <p>{children}</p>
      </div>
      <div className={styles.placeholderAction}>{action}</div>
    </div>
  );
}

/**
 * One kind of thing in an area, under a small heading of its own, such as the resume among the
 * resumes and cover letters, with its buttons, such as New version.
 */
export function Part({
  title,
  summary,
  actions,
  children,
}: {
  title: string;
  /** A few words on it, such as how long a letter is. */
  summary?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const titleId = useId();
  return (
    <section className={styles.part} aria-labelledby={titleId}>
      <div className={styles.partHead}>
        <h4 id={titleId} className={styles.partTitle}>
          {title}
        </h4>
        {summary && <span className={styles.partSummary}>{summary}</span>}
        {actions && <div className={styles.partActions}>{actions}</div>}
      </div>
      {children}
    </section>
  );
}
