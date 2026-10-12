import {
  CLOSED_STATUSES,
  type Job,
  type JobProgress,
  type JobStatus,
  journeyOf,
  STATUS_RANK,
  type StatusChange,
  shortDate,
} from '@factwright/core';
import { Button, JOB_STATUS_DISPLAY } from '@factwright/ui';
import type { CSSProperties } from 'react';
import type { EditResult, FactwrightApi } from '../../shared/api.ts';
import { DateEdit } from './DateEdit.tsx';
import styles from './StageTrack.module.css';

/** How a step's date can be fixed: by the change of status that marked it, or as the applied date. */
type Fix = { kind: 'change'; change: StatusChange } | { kind: 'applied' };

/** A step the job took, where it is now, or the step ahead, as the track shows it. */
export interface TrackStep {
  key: string;
  label: string;
  /** The status whose tint it takes. */
  tone: JobStatus;
  /** When the job got there, or null when that isn't known. */
  date: string | null;
  state: 'done' | 'now' | 'next';
  /** A few words more, such as where the job was found. */
  detail?: string;
  fix?: Fix;
}

/** The steps that follow each other once a job is applied to, for the one ahead. */
const AHEAD: readonly { status: JobStatus; label: string }[] = [
  { status: 'applied', label: 'Applied' },
  { status: 'screen', label: 'Screen' },
  { status: 'interview', label: 'Interview' },
  { status: 'offer', label: 'Offer' },
];

const rank = (status: JobStatus) => STATUS_RANK[status] ?? 0;

/**
 * The steps a job has taken, from being found to where it is now, each dated, then the step
 * ahead. A closed job ends with how it ended instead. A step a change of status marked can have
 * its date fixed, and so can the applied date.
 */
export function trackSteps(job: Job, progress: JobProgress): TrackStep[] {
  const { dates } = journeyOf(job, progress);
  const first = (statuses: readonly JobStatus[]) =>
    job.statusLog.find((change) => statuses.includes(change.status));
  const steps: TrackStep[] = [];
  const add = (step: Omit<TrackStep, 'state'>) => steps.push({ ...step, state: 'done' });
  const when = (date: string | undefined) => date || null;
  /**
   * A step a change of status marked shows that change's date, the one fixing it changes. Else
   * it shows the date the job's story gives it, such as a call's, and can't be fixed here.
   */
  const marked = (
    step: Omit<TrackStep, 'state' | 'date' | 'fix'>,
    change: StatusChange | undefined,
    otherwise: string | undefined,
  ) =>
    add(
      change
        ? { ...step, date: change.at, fix: { kind: 'change', change } }
        : { ...step, date: when(otherwise) },
    );

  add({ key: 'found', label: 'Found', tone: 'new', date: when(dates.found), detail: job.source });
  if (dates.checked !== undefined) {
    const verdict = [job.fit?.verdict, job.fit?.score].filter((part) => part != null).join(' ');
    add({
      key: 'checked',
      label: job.fit ? 'Fit check' : 'Checked',
      tone: 'checked',
      date: when(dates.checked),
      ...(verdict && { detail: verdict }),
    });
  }
  if (dates.resume !== undefined) {
    add({ key: 'resume', label: 'Resume built', tone: 'resume', date: when(dates.resume) });
  }
  if (dates.applied !== undefined) {
    const change = first(['applied']);
    add(
      change
        ? {
            key: 'applied',
            label: 'Applied',
            tone: 'applied',
            date: change.at,
            fix: { kind: 'change', change },
          }
        : // An applied date with no change behind it, or none yet, is fixed as the applied date.
          {
            key: 'applied',
            label: 'Applied',
            tone: 'applied',
            date: job.appliedOn,
            fix: { kind: 'applied' },
          },
    );
  }
  if (dates.screen !== undefined) {
    marked({ key: 'screen', label: 'Screen', tone: 'screen' }, first(['screen']), dates.screen);
  }
  if (dates.interview !== undefined) {
    marked(
      { key: 'interview', label: 'Interview', tone: 'interview' },
      first(['interview']),
      dates.interview,
    );
  }
  if (dates.final !== undefined) {
    add({ key: 'final', label: 'Final round', tone: 'interview', date: when(dates.final) });
  }
  if (dates.offer !== undefined) {
    marked({ key: 'offer', label: 'Offer', tone: 'offer' }, first(['offer']), dates.offer);
  }

  const { status } = progress;
  if (CLOSED_STATUSES.includes(status)) {
    const change = job.statusLog.findLast((each) => each.status === status);
    steps.push({
      key: status,
      label: JOB_STATUS_DISPLAY[status].label,
      tone: status,
      date: change?.at ?? job.statusOn,
      state: 'now',
      ...(change && { fix: { kind: 'change', change } }),
    });
    return steps;
  }
  const last = steps.at(-1);
  if (last) last.state = 'now';
  const reached = Math.max(rank(status), ...steps.map((step) => rank(step.tone)));
  const ahead = AHEAD.find((step) => rank(step.status) > reached);
  if (ahead) {
    steps.push({
      key: `next-${ahead.status}`,
      ...ahead,
      tone: ahead.status,
      date: null,
      state: 'next',
    });
  }
  return steps;
}

const STATE_WORDS: Readonly<Record<TrackStep['state'], string>> = {
  done: 'Done',
  now: 'Where it is now',
  next: 'Not yet',
};

/**
 * Where a job has been, step by step, with the date of each, and the step ahead. The dates of
 * changes the user made can be fixed in place, and the latest change undone.
 */
export function StageTrack({
  job,
  progress,
  api,
  today,
  run,
}: {
  job: Job;
  progress: JobProgress;
  api: FactwrightApi;
  today: string;
  /** Saves an edit, and shows its problem if it didn't save. */
  run: (edit: Promise<EditResult>) => Promise<boolean>;
}) {
  const steps = trackSteps(job, progress);
  const latest = job.statusLog.at(-1);
  const undoable = latest && latest.status === job.status ? latest : null;
  const redate = (fix: Fix, date: string) =>
    run(
      fix.kind === 'change'
        ? api.redateStatusChange(fix.change.id, date)
        : api.updateJob(job.id, { appliedOn: date }),
    );
  return (
    <ol className={styles.track} aria-label="Where it’s been">
      {steps.map((step) => {
        const tone = JOB_STATUS_DISPLAY[step.tone].tone;
        return (
          <li
            key={step.key}
            className={`${styles.step} ${step.state === 'done' ? '' : styles[step.state]}`}
            style={{ '--step-tone': `var(--fw-tone-${tone}-fg)` } as CSSProperties}
          >
            <span className={styles.dot} role="img" aria-label={STATE_WORDS[step.state]} />
            <span className={styles.label}>
              {step.label}
              {step.detail && <span className={styles.detail}>{step.detail}</span>}
            </span>
            <span className={styles.when}>
              {step.state === 'now' && undoable && step.fix?.kind === 'change' && (
                <Button
                  variant="quiet"
                  size="sm"
                  className={styles.undo}
                  aria-label={`Undo “Marked ${JOB_STATUS_DISPLAY[undoable.status].label}”`}
                  onClick={() => void run(api.undoStatusChange(undoable.id))}
                >
                  Undo
                </Button>
              )}
              {step.state === 'next' ? (
                <span className={styles.notYet}>Not yet</span>
              ) : step.fix ? (
                <DateEdit
                  date={step.date}
                  label={
                    step.key === 'applied' ? 'When you applied' : `When it moved to ${step.label}`
                  }
                  today={today}
                  max={today}
                  onChange={(date) => step.fix && void redate(step.fix, date)}
                />
              ) : (
                step.date && <span className={styles.fixed}>{shortDate(step.date, today)}</span>
              )}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
