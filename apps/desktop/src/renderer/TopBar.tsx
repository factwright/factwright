import { Button, Logo, SearchField } from '@factwright/ui';
import { Plus } from 'lucide-react';
import type { Ref } from 'react';
import styles from './TopBar.module.css';

export interface TopBarProps {
  platform: string;
  query: string;
  onQuery: (query: string) => void;
  searchRef: Ref<HTMLInputElement>;
  onAddJob: () => void;
}

/** The bar across the top of the window, with search. It also holds the system's window buttons. */
export function TopBar({ platform, query, onQuery, searchRef, onAddJob }: TopBarProps) {
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
      <Button
        className={styles.add}
        variant="primary"
        icon={<Plus size={16} aria-hidden="true" />}
        onClick={onAddJob}
      >
        Add job
      </Button>
    </header>
  );
}
