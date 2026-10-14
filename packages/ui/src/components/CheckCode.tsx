import { cx } from '../cx.ts';
import styles from './CheckCode.module.css';

export interface CheckCodeProps {
  /** The emoji, in order, each with its name. */
  items: readonly { emoji: string; name: string }[];
  /** What the list is, for screen readers. */
  label?: string;
  /** Faded, once the person has said it matches here. */
  quiet?: boolean;
}

/**
 * A short check code, as emoji with their names under them, for a person to compare on two
 * screens. Screen readers read the names in order. Six fit on one row in a dialog, and wrap to
 * two rows of three on a phone.
 */
export function CheckCode({ items, label = 'Check code', quiet = false }: CheckCodeProps) {
  return (
    <div className={styles.frame}>
      <ol className={cx(styles.code, quiet && styles.quiet)} aria-label={label}>
        {items.map((item, index) => (
          // An emoji can come up twice, so its place is what tells it apart.
          <li key={`${index}:${item.name}`} className={styles.item}>
            <span className={styles.emoji} aria-hidden="true">
              {item.emoji}
            </span>
            <span className={styles.name}>{item.name}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
