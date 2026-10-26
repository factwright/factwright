import { type Job, jobLikeness } from '@factwright/core';
import { Button, Dialog, DialogActions, JOB_STATUS_DISPLAY, SearchField } from '@factwright/ui';
import { useState } from 'react';
import type { FactwrightApi } from '../../shared/api.ts';
import styles from './MergeDialog.module.css';
import type { JobRow } from './rows.ts';

/** How many jobs the list shows at most, so a long search stays quick to read. */
const MOST = 30;

/** How alike a job is to the one kept, most alike first, as the app tells one job from another. */
const RANK = { posting: 0, role: 1, company: 2 } as const;

const name = (job: Job) => `${job.company}, ${job.role || 'Company outreach'}`;

/**
 * Merges another job into one, for the rare job the app found twice and didn't tell was the
 * same: the user picks the other, and its status, notes, calls and links move to this one. Jobs
 * likely the same come first, with the rest of the company's, and a search finds any other. The
 * job Claude noted might be the same, when the user came from its note, is first and picked.
 */
export function MergeDialog({
  job,
  rows,
  api,
  suggested = null,
  onClose,
}: {
  /** The job kept. */
  job: Job;
  /** Every job, to pick the other from. */
  rows: readonly JobRow[];
  api: FactwrightApi;
  /** The job Claude noted might be the same, by its ID, to pick first. */
  suggested?: string | null;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<string | null>(suggested);
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const others = rows
    .filter((row) => row.job.id !== job.id)
    .map((row) => ({ row, like: jobLikeness(job, row.job) }));
  const rank = (one: (typeof others)[number]) =>
    one.row.job.id === suggested ? -1 : one.like ? RANK[one.like] : 3;
  const listed = (
    words.length > 0
      ? others.filter(({ row }) => words.every((word) => row.searchText.includes(word)))
      : others.filter((one) => one.like !== null || one.row.job.id === suggested)
  )
    .sort(
      (a, b) =>
        rank(a) - rank(b) ||
        (b.row.progress.lastActivity ?? '').localeCompare(a.row.progress.lastActivity ?? ''),
    )
    .slice(0, MOST);
  const chosen = listed.find(({ row }) => row.job.id === picked)?.row ?? null;
  const merge = async (close: () => void) => {
    if (!chosen) return;
    setSaving(true);
    const result = await api.mergeJobs(job.id, chosen.job.id);
    setSaving(false);
    if (result.ok) close();
    else setProblem(result.message);
  };
  return (
    <Dialog
      title="Merge with another job"
      description={`For the same job found twice. Pick the other one: its status, notes, calls and links move to ${name(job)}, and it leaves your list.`}
      onClose={onClose}
    >
      {(close) => (
        <>
          <SearchField
            label="Find the other job"
            placeholder="Find the other job by its company or role"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            data-autofocus
          />
          {listed.length > 0 ? (
            <ul className={styles.jobs} aria-label="Jobs to merge with">
              {listed.map(({ row, like }) => (
                <li key={row.job.id}>
                  <label className={styles.job}>
                    <input
                      type="radio"
                      name="merge-with"
                      checked={picked === row.job.id}
                      onChange={() => setPicked(row.job.id)}
                    />
                    <span className={styles.name}>
                      <span className={styles.company}>
                        {row.job.company}
                        {(like === 'posting' || like === 'role' || row.job.id === suggested) && (
                          <span className={styles.likely}>Likely the same</span>
                        )}
                      </span>
                      <span className={styles.role}>
                        {[
                          row.job.role || 'Company outreach',
                          JOB_STATUS_DISPLAY[row.progress.status].label,
                          row.job.search && `Found in ${row.job.search.source}`,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.hint} role="status">
              {words.length > 0
                ? `No other job matches “${query.trim()}”.`
                : `No other job at ${job.company}. Find the other one by its company or role.`}
            </p>
          )}
          {problem && (
            <p className={styles.problem} role="alert">
              {problem}
            </p>
          )}
          <DialogActions>
            <Button onClick={close}>Cancel</Button>
            <Button
              variant="primary"
              disabled={saving || !chosen}
              onClick={() => void merge(close)}
            >
              Merge
            </Button>
          </DialogActions>
        </>
      )}
    </Dialog>
  );
}
