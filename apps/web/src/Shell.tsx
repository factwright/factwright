import { Logo } from '@factwright/ui';
import type { ReactNode } from 'react';
import { navigate } from './route.ts';
import styles from './Shell.module.css';

/** A link within the web view, which moves without reloading. */
export function PageLink({
  to,
  children,
  current = false,
}: {
  to: string;
  children: ReactNode;
  current?: boolean;
}) {
  return (
    <a
      href={to}
      className={styles.navLink}
      aria-current={current ? 'page' : undefined}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey) return;
        event.preventDefault();
        navigate(to);
      }}
    >
      {children}
    </a>
  );
}

/** The frame around every page: the name, where to go, and the page itself. */
export function Shell({
  nav,
  children,
}: {
  /** Links in the header, once the person is signed in. */
  nav?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <a
          href="/"
          className={styles.brand}
          onClick={(event) => {
            event.preventDefault();
            navigate('/');
          }}
        >
          <Logo size={22} />
          <span>Factwright</span>
        </a>
        {nav && (
          <nav className={styles.nav} aria-label="Main">
            {nav}
          </nav>
        )}
      </header>
      <main className={styles.main}>{children}</main>
    </div>
  );
}
