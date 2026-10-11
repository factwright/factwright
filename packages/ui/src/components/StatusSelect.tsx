import { JOB_STATUSES, type JobStatus } from '@factwright/core';
import { ChevronDown } from 'lucide-react';
import { cx } from '../cx.ts';
import pill from './Pill.module.css';
import { JOB_STATUS_DISPLAY } from './StatusPill.tsx';
import styles from './StatusSelect.module.css';

export interface StatusSelectProps {
  status: JobStatus;
  /** Names the menu for screen readers, such as "Status for Acme Robotics". */
  label: string;
  onChange: (status: JobStatus) => void;
  disabled?: boolean;
}

/**
 * A job's status as a tinted pill that opens a menu of every status. It's the system's own
 * menu, so it works with the keyboard and screen readers and looks at home on each platform.
 */
export function StatusSelect({ status, label, onChange, disabled }: StatusSelectProps) {
  return (
    <span className={cx(styles.status, pill[JOB_STATUS_DISPLAY[status].tone])}>
      <select
        className={styles.select}
        aria-label={label}
        value={status}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value as JobStatus)}
      >
        {JOB_STATUSES.map((each) => (
          <option key={each} value={each}>
            {JOB_STATUS_DISPLAY[each].label}
          </option>
        ))}
      </select>
      <ChevronDown className={styles.chevron} size={12} strokeWidth={2.4} aria-hidden="true" />
    </span>
  );
}
