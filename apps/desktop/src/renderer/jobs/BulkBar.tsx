import {
  type JobStatus,
  type JobView,
  type PassReason,
  STATUS_GROUPS,
  shortDate,
} from '@factwright/core';
import { Button, IconButton, JOB_STATUS_DISPLAY, Select } from '@factwright/ui';
import { Sparkles, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { EditResult, FactwrightApi, JobChanges } from '../../shared/api.ts';
import styles from './BulkBar.module.css';
import { BackInChoices, FOCUS_NEXT, focusNext, ReasonChips, SORT_MOVES } from './Decide.tsx';
import type { JobRow } from './rows.ts';

/** Jobs just moved together, for what can follow: why they were passed, when they come back. */
export interface Moved {
  status: JobStatus;
  /** Every job the move took, for what follows. */
  jobIds: string[];
  /** Jobs back from Later set aside again, with the day each had, for Undo to put back. */
  again: { id: string; backOn: string | null }[];
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
 * a way to undo the move. Analyze has Claude analyze the jobs picked, in one run, once Claude Code
 * is ready. Its count is read aloud as it changes.
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
  onAnalyze,
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
  /** Closes the bar. Says whether the keyboard's focus was in it, to put it back in the list. */
  onDone: (fromBar: boolean) => void;
  /** Has Claude analyze the jobs picked, in one run, or undefined while Claude isn't ready. */
  onAnalyze?: ((jobIds: string[]) => void) | undefined;
}) {
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const bar = useRef<HTMLElement>(null);
  // A move takes away the button that made it, so the keyboard's focus goes on to what follows.
  const refocus = useRef(false);
  useEffect(() => {
    if (!moved || !refocus.current) return;
    refocus.current = false;
    focusNext(bar.current);
  }, [moved]);
  const run = async (edit: () => Promise<EditResult>) => {
    setBusy(true);
    const result = await edit();
    setBusy(false);
    setProblem(result.ok ? null : result.message);
    return result.ok;
  };
  // Only the jobs not there already move, so Undo and what follows touch only them. A job back
  // from Later is set aside again, starting over with no day, as its panel does.
  const move = async (status: JobStatus) => {
    // Asked before the buttons wait on the move, which can take the focus from them.
    const fromBar = bar.current?.contains(document.activeElement) ?? false;
    const moving = picked.filter((row) => row.job.status !== status);
    const again =
      status === 'later'
        ? picked.filter((row) => row.job.status === 'later' && row.progress.backFromLater)
        : [];
    if (moving.length === 0 && again.length === 0) {
      onClear();
      return;
    }
    const ids = (list: readonly JobRow[]) => list.map((row) => row.job.id);
    // Two changes at most: what one of them moved still counts, with Undo, if the other fails.
    setBusy(true);
    const marked = moving.length > 0 ? await api.updateJobs(ids(moving), { status }) : null;
    const setAside = again.length > 0 ? await api.updateJobs(ids(again), { backOn: null }) : null;
    setBusy(false);
    const failed = [marked, setAside].find((result) => result && !result.ok);
    setProblem(failed && !failed.ok ? failed.message : null);
    const took = [...(marked?.ok ? moving : []), ...(setAside?.ok ? again : [])];
    if (took.length === 0) return;
    refocus.current = fromBar;
    onMoved({
      status,
      jobIds: ids(took),
      again: (setAside?.ok ? again : []).map((row) => ({ id: row.job.id, backOn: row.job.backOn })),
    });
  };
  const after = (changes: JobChanges) => moved && run(() => api.updateJobs(moved.jobIds, changes));
  // Undoes the move for each job still where it went, in turn, and gives back the day each job
  // set aside again had.
  const undo = async () => {
    if (!moved) return;
    const fromBar = bar.current?.contains(document.activeElement) ?? false;
    const undone = await run(async () => {
      for (const id of moved.jobIds) {
        const earlier = moved.again.find((each) => each.id === id);
        if (earlier) {
          const result = await api.updateJob(id, { backOn: earlier.backOn });
          if (!result.ok) return result;
          continue;
        }
        const latest = rows.find((row) => row.job.id === id)?.job.statusLog.at(-1);
        if (latest?.status !== moved.status) continue;
        const result = await api.undoStatusChange(latest.id);
        if (!result.ok) return result;
      }
      return { ok: true };
    });
    if (undone) onDone(fromBar);
  };

  const selecting = picked.length > 0;
  if (!selecting && !moved) return null;
  const movedRows = moved ? rows.filter((row) => moved.jobIds.includes(row.job.id)) : [];
  const reason = shared(movedRows, (row) => row.job.passReason);
  const backOn = shared(movedRows, (row) => row.job.backOn);
  return (
    <section
      ref={bar}
      className={styles.bar}
      aria-label={selecting ? 'Selected jobs' : 'Jobs just moved'}
      onKeyDown={(event) => {
        if (selecting && event.key === 'Escape') onClear();
      }}
    >
      <div className={styles.line}>
        {/* The same live region in both, so what a move did is read aloud. */}
        <span className={styles.count} role="status">
          {selecting ? `${plural(picked.length, 'job')} selected` : moved && movedText(moved)}
        </span>
        {selecting ? (
          <>
            {onAnalyze && (
              <Button
                size="sm"
                icon={<Sparkles size={14} aria-hidden="true" />}
                disabled={busy}
                onClick={() => onAnalyze(picked.map((row) => row.job.id))}
              >
                Analyze
              </Button>
            )}
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
          </>
        ) : (
          <>
            {moved?.status === 'passed' && (
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
            {moved?.status === 'later' && (
              <fieldset className={styles.follow}>
                <legend className={styles.legend}>When they come back</legend>
                <span className={styles.ask}>
                  {backOn ? `Back ${shortDate(backOn, today)}.` : 'Bring them back:'}
                </span>
                <BackInChoices today={today} onPick={(day) => void after({ backOn: day })} />
              </fieldset>
            )}
            <span className={styles.end}>
              <Button
                variant="quiet"
                size="sm"
                disabled={busy}
                onClick={() => void undo()}
                {...(moved?.status !== 'passed' && moved?.status !== 'later' && FOCUS_NEXT)}
              >
                Undo
              </Button>
              <IconButton
                label="Done"
                variant="quiet"
                size="sm"
                icon={<X size={15} aria-hidden="true" />}
                onClick={() => onDone(true)}
              />
            </span>
          </>
        )}
      </div>
      {problem && (
        <p className={styles.problem} role="alert">
          {problem}
        </p>
      )}
    </section>
  );
}
