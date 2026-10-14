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
import { Button, JOB_STATUS_DISPLAY, type Tone } from '@factwright/ui';
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
  /** Its tint. */
  tone: Tone;
  /** How far along it is, as a status rank. */
  rank: number;
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

/** Where a job can be before applying, once the user has said: dated, and theirs to undo. */
const DECIDED: readonly JobStatus[] = ['review', 'apply', 'later'];

const rank = (status: JobStatus) => STATUS_RANK[status] ?? 0;
const tone = (status: JobStatus) => JOB_STATUS_DISPLAY[status].tone;

/**
 * The steps a job has taken, from being found to where it is now, each dated, then the step
 * ahead. A closed job ends with how it ended instead. A step a change of status marked can have
 * its date fixed, and so can the applied date.
 */
export function trackSteps(job: Job, progress: JobProgress, today: string): TrackStep[] {
  const { dates } = journeyOf(job, progress);
  const { status } = progress;
  // What the user decided before applying shows while it's where the job is. With no work of
  // Claude's on the job, that step says it all, with no check of its own before it.
  const decided = DECIDED.includes(status) && job.status === status;
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
    step: Omit<TrackStep, 'state' | 'date' | 'fix' | 'tone' | 'rank'>,
    status: JobStatus,
    otherwise: string | undefined,
  ) => {
    const change = first([status]);
    const known = { ...step, tone: tone(status), rank: rank(status) };
    add(
      change
        ? { ...known, date: change.at, fix: { kind: 'change', change } }
        : { ...known, date: when(otherwise) },
    );
  };

  add({
    key: 'found',
    label: 'Found',
    tone: tone('new'),
    rank: 0,
    date: when(dates.found),
    detail: job.source,
  });
  if (dates.checked !== undefined && !(decided && job.stage === 'new')) {
    const verdict = [job.fit?.verdict, job.fit?.score].filter((part) => part != null).join(' ');
    add({
      key: 'checked',
      label: job.fit ? 'Fit check' : 'Checked',
      tone: 'slate',
      rank: rank('review'),
      date: when(dates.checked),
      ...(verdict && { detail: verdict }),
    });
  }
  if (dates.resume !== undefined) {
    const built = { tone: 'violet', rank: rank('review') } as const;
    add({ key: 'resume', label: 'Resume built', ...built, date: when(dates.resume) });
  }
  // Dated by the latest change, as it's where the job is now.
  if (decided) {
    const change = job.statusLog.findLast((each) => each.status === status);
    const back = status === 'later' && job.backOn ? `Back ${shortDate(job.backOn, today)}` : null;
    add({
      key: status,
      label: JOB_STATUS_DISPLAY[status].label,
      tone: tone(status),
      rank: rank(status),
      date: change?.at ?? job.statusOn,
      ...(back && { detail: back }),
      ...(change && { fix: { kind: 'change', change } }),
    });
  }
  if (dates.applied !== undefined) {
    const change = first(['applied']);
    const applied = { key: 'applied', label: 'Applied', tone: tone('applied'), rank: 3 };
    add(
      change
        ? { ...applied, date: change.at, fix: { kind: 'change', change } }
        : // An applied date with no change behind it, or none yet, is fixed as the applied date.
          { ...applied, date: job.appliedOn, fix: { kind: 'applied' } },
    );
  }
  if (dates.screen !== undefined) {
    marked({ key: 'screen', label: 'Screen' }, 'screen', dates.screen);
  }
  if (dates.interview !== undefined) {
    marked({ key: 'interview', label: 'Interview' }, 'interview', dates.interview);
  }
  if (dates.final !== undefined) {
    const final = { tone: tone('interview'), rank: rank('interview') };
    add({ key: 'final', label: 'Final round', ...final, date: when(dates.final) });
  }
  if (dates.offer !== undefined) {
    marked({ key: 'offer', label: 'Offer' }, 'offer', dates.offer);
  }

  if (CLOSED_STATUSES.includes(status)) {
    const change = job.statusLog.findLast((each) => each.status === status);
    steps.push({
      key: status,
      label: JOB_STATUS_DISPLAY[status].label,
      tone: tone(status),
      rank: rank(status),
      date: change?.at ?? job.statusOn,
      state: 'now',
      ...(change && { fix: { kind: 'change', change } }),
    });
    return steps;
  }
  const last = steps.at(-1);
  if (last) last.state = 'now';
  const reached = Math.max(rank(status), ...steps.map((step) => step.rank));
  const ahead = AHEAD.find((step) => rank(step.status) > reached);
  if (ahead) {
    steps.push({
      key: `next-${ahead.status}`,
      label: ahead.label,
      tone: tone(ahead.status),
      rank: rank(ahead.status),
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
  const steps = trackSteps(job, progress, today);
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
        return (
          <li
            key={step.key}
            className={`${styles.step} ${step.state === 'done' ? '' : styles[step.state]}`}
            style={{ '--step-tone': `var(--fw-tone-${step.tone}-fg)` } as CSSProperties}
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
