import { IconButton } from '@factwright/ui';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import styles from './DialogTurn.module.css';

/**
 * Which of the things Claude's runs wait on the user for a dialog shows: the run that asks, such
 * as "Talkiatry · Tailored resume", and its place among them, with a way to the others.
 */
export interface DialogTurn {
  run: string;
  /** Its place, from 1, among the `of` waiting. */
  at: number;
  of: number;
  go: (offset: -1 | 1) => void;
}

/**
 * The line above a dialog's title that names the run asking, and with several waiting on the user,
 * which of them it is, "1 of 3", with Previous and Next to go through them, or to come back to one.
 */
export function TurnLine({ turn }: { turn: DialogTurn }) {
  return (
    <>
      <span className={styles.run}>{turn.run}</span>
      {turn.of > 1 && (
        <span className={styles.turns}>
          <IconButton
            size="sm"
            variant="quiet"
            label="Previous"
            icon={<ChevronLeft size={15} aria-hidden="true" />}
            disabled={turn.at <= 1}
            onClick={() => turn.go(-1)}
          />
          <span className={styles.count}>
            {turn.at} of {turn.of}
          </span>
          <IconButton
            size="sm"
            variant="quiet"
            label="Next"
            icon={<ChevronRight size={15} aria-hidden="true" />}
            disabled={turn.at >= turn.of}
            onClick={() => turn.go(1)}
          />
        </span>
      )}
    </>
  );
}
