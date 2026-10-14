import { Button, Dialog, DialogActions, JOB_STATUS_DISPLAY } from '@factwright/ui';
import { useState } from 'react';
import type { FactwrightApi } from '../../shared/api.ts';
import type { JobRow } from './rows.ts';
import styles from './WithdrawDialog.module.css';

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

/**
 * Once the user accepts an offer: withdraws from the other jobs still in play, all in one step,
 * each one theirs to leave out. It marks them here only, so it says to tell the companies.
 */
export function WithdrawDialog({
  company,
  rows,
  api,
  onClose,
}: {
  /** The company whose offer the user accepted. */
  company: string;
  /** The other jobs still in play. */
  rows: readonly JobRow[];
  api: FactwrightApi;
  onClose: () => void;
}) {
  const [keep, setKeep] = useState<ReadonlySet<string>>(new Set());
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const chosen = rows.filter((row) => !keep.has(row.job.id));
  const toggle = (jobId: string) =>
    setKeep((current) => {
      const next = new Set(current);
      if (!next.delete(jobId)) next.add(jobId);
      return next;
    });
  const withdraw = async (close: () => void) => {
    setSaving(true);
    const result = await api.updateJobs(
      chosen.map((row) => row.job.id),
      { status: 'withdrawn' },
    );
    setSaving(false);
    if (result.ok) close();
    else setProblem(result.message);
  };
  return (
    <Dialog
      title="Withdraw from your other jobs?"
      description={`You accepted the offer from ${company}. ${
        rows.length === 1 ? 'This job is' : `These ${rows.length} jobs are`
      } still in play.`}
      onClose={onClose}
    >
      {(close) => (
        <>
          <ul className={styles.jobs} aria-label="Jobs still in play">
            {rows.map(({ job, progress }) => (
              <li key={job.id}>
                <label className={styles.job}>
                  <input
                    type="checkbox"
                    checked={!keep.has(job.id)}
                    onChange={() => toggle(job.id)}
                  />
                  <span className={styles.name}>
                    <span className={styles.company}>{job.company}</span>
                    <span className={styles.role}>
                      {job.role || 'Company outreach'} · {JOB_STATUS_DISPLAY[progress.status].label}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <p className={styles.hint}>
            This marks them Withdrawn here. Factwright doesn’t contact anyone, so let each company
            know yourself.
          </p>
          {problem && (
            <p className={styles.problem} role="alert">
              {problem}
            </p>
          )}
          <DialogActions>
            <Button onClick={close}>Not now</Button>
            <Button
              variant="primary"
              disabled={saving || chosen.length === 0}
              onClick={() => void withdraw(close)}
            >
              Withdraw from {plural(chosen.length, 'job')}
            </Button>
          </DialogActions>
        </>
      )}
    </Dialog>
  );
}
