import { Logo } from '@factwright/ui';
import styles from './TopBar.module.css';

/** The bar across the top of the window, which also holds the system's window buttons. */
export function TopBar({ platform }: { platform: string }) {
  const placement = platform === 'darwin' ? styles.mac : styles.overlay;
  return (
    <header className={`${styles.bar} ${placement}`}>
      <Logo />
      <span className={styles.name}>Factwright</span>
    </header>
  );
}
