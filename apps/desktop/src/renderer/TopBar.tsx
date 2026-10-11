import { Logo, SearchField } from '@factwright/ui';
import type { Ref } from 'react';
import styles from './TopBar.module.css';

export interface TopBarProps {
  platform: string;
  query: string;
  onQuery: (query: string) => void;
  searchRef: Ref<HTMLInputElement>;
}

/** The bar across the top of the window, with search. It also holds the system's window buttons. */
export function TopBar({ platform, query, onQuery, searchRef }: TopBarProps) {
  const mac = platform === 'darwin';
  return (
    <header className={`${styles.bar} ${mac ? styles.mac : styles.overlay}`}>
      <div className={styles.brand}>
        <Logo />
        <span className={styles.name}>Factwright</span>
      </div>
      <SearchField
        ref={searchRef}
        className={styles.search}
        label="Search jobs, companies and notes"
        shortcut={mac ? '⌘K' : 'Ctrl K'}
        value={query}
        onChange={(event) => onQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onQuery('');
        }}
      />
    </header>
  );
}
