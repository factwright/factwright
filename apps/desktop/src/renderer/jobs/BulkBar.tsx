import {
  type JobStatus,
  type JobView,
  type PassReason,
  STATUS_GROUPS,
  shortDate,
} from '@factwright/core';
import { Button, IconButton, JOB_STATUS_DISPLAY, Select } from '@factwright/ui';
import { X } from 'lucide-react';
import { useState } from 'react';
import type { EditResult, FactwrightApi, JobChanges } from '../../shared/api.ts';
import styles from './BulkBar.module.css';
import { BackInChoices, ReasonChips, SORT_MOVES } from './Decide.tsx';
import type { JobRow } from './rows.ts';

/** Jobs just moved together, for what can follow: why they were passed, when they come back. */
export interface Moved {
  status: JobStatus;
  jobIds: string[];
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

/** The views before applying, where the quick ways to sort a job are offered for several too. */
const SORTING: readonly JobView[] = ['new', 'review', 'apply'];

/** What a move did, in a few words: "Passed on 3 jobs." */
function movedText({ status, jobIds }: Moved): string {
  const jobs = plural(jobIds.length, 'job');
  if (status === 'passed') return `Passed on ${jobs}.`;
  if (status === 'later') return `Set ${jobs} aside.`;
  return `Moved ${jobs} to ${JOB_STATUS_DISPLAY[status].label}.`;
}

/** The one value every row has, or null when they differ. */
function shared<T>(rows: readonly JobRow[], value: (row: JobRow) => T | null): T | null {
  const values = new Set(rows.map(value));
  return values.size === 1 ? ([...values][0] ?? null) : null;
}

/**
 * Moves the jobs picked in the list, all at once, under the list: to a quick choice before
 * applying, or to any status. Then it asks what can follow, such as why they were passed, with
 * a way to undo the move.
 */
export function BulkBar({
  view,
  picked,
  moved,
  rows,
  today,
  api,
  onMoved,
  onClear,
  onDone,
}: {
  view: JobView;
  /** The rows picked, as the list shows them. */
  picked: readonly JobRow[];
  /** The jobs just moved, once nothing's picked. */
  moved: Moved | null;
  /** Every row, to find the jobs just moved. */
  rows: readonly JobRow[];
  today: string;
  api: FactwrightApi;
  onMoved: (moved: Moved) => void;
  onClear: () => void;
  onDone: () => void;
}) {
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (edit: () => Promise<EditResult>) => {
    setBusy(true);
    const result = await edit();
    setBusy(false);
    setProblem(result.ok ? null : result.message);
    return result.ok;
  };
  // Only the jobs not there already move, so Undo and what follows touch only them.
  const move = async (status: JobStatus) => {
    const jobIds = picked.filter((row) => row.job.status !== status).map((row) => row.job.id);
    if (jobIds.length === 0) onClear();
    else if (await run(() => api.updateJobs(jobIds, { status }))) onMoved({ status, jobIds });
  };
  const after = (changes: JobChanges) => moved && run(() => api.updateJobs(moved.jobIds, changes));
  // Undoes the move for each job still where it went, in turn.
  const undo = async () => {
    if (!moved) return;
    const undone = await run(async () => {
      for (const id of moved.jobIds) {
        const latest = rows.find((row) => row.job.id === id)?.job.statusLog.at(-1);
        if (latest?.status !== moved.status) continue;
        const result = await api.undoStatusChange(latest.id);
        if (!result.ok) return result;
      }
      return { ok: true };
    });
    if (undone) onDone();
  };
  const problemLine = problem && (
    <p className={styles.problem} role="alert">
      {problem}
    </p>
  );

  if (picked.length > 0) {
    return (
      <section
        className={styles.bar}
        aria-label="Selected jobs"
        onKeyDown={(event) => {
          if (event.key === 'Escape') onClear();
        }}
      >
        <div className={styles.line}>
          <span className={styles.count}>{plural(picked.length, 'job')} selected</span>
          {SORTING.includes(view) &&
            // The views before applying are named for their statuses, which aren't offered.
            SORT_MOVES.filter((each) => each.status !== view).map((each) => (
              <Button
                key={each.status}
                size="sm"
                disabled={busy}
                onClick={() => void move(each.status)}
              >
                {each.label}
              </Button>
            ))}
          <Select
            className={styles.moveTo}
            aria-label="Move the selected jobs to"
            value=""
            disabled={busy}
            onChange={(event) => {
              if (event.target.value) void move(event.target.value as JobStatus);
            }}
          >
            <option value="">Move to…</option>
            {STATUS_GROUPS.map((group) => (
              <optgroup key={group.label} label={group.label}>
                {group.statuses.map((status) => (
                  <option key={status} value={status}>
                    {JOB_STATUS_DISPLAY[status].label}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
          <Button variant="quiet" size="sm" className={styles.end} onClick={onClear}>
            Clear
          </Button>
        </div>
        {problemLine}
      </section>
    );
  }

  if (!moved) return null;
  const movedRows = rows.filter((row) => moved.jobIds.includes(row.job.id));
  const reason = shared(movedRows, (row) => row.job.passReason);
  const backOn = shared(movedRows, (row) => row.job.backOn);
  return (
    <section className={styles.bar} aria-label="Jobs just moved">
      <div className={styles.line}>
        <span className={styles.count} role="status">
          {movedText(moved)}
        </span>
        {moved.status === 'passed' && (
          <fieldset className={styles.follow}>
            <legend className={styles.legend}>Why you passed</legend>
            <span className={styles.ask} aria-hidden="true">
              Why?
            </span>
            <ReasonChips
              reason={reason}
              onPick={(passReason: PassReason | null) => void after({ passReason })}
            />
          </fieldset>
        )}
        {moved.status === 'later' && (
          <fieldset className={styles.follow}>
            <legend className={styles.legend}>When they come back</legend>
            <span className={styles.ask}>
              {backOn ? `Back ${shortDate(backOn, today)}.` : 'Bring them back:'}
            </span>
            <BackInChoices today={today} onPick={(day) => void after({ backOn: day })} />
          </fieldset>
        )}
        <span className={styles.end}>
          <Button variant="quiet" size="sm" disabled={busy} onClick={() => void undo()}>
            Undo
          </Button>
          <IconButton
            label="Done"
            variant="quiet"
            size="sm"
            icon={<X size={15} aria-hidden="true" />}
            onClick={onDone}
          />
        </span>
      </div>
      {problemLine}
    </section>
  );
}
