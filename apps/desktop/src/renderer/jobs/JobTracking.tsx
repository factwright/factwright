import {
  CALL_KIND_LABELS,
  CALL_OUTCOME_LABELS,
  type Call,
  type CallPerson,
  callPeople,
  dayFrom,
  type Job,
  type JobProgress,
  shortDate,
} from '@factwright/core';
import { Button, Input, JOB_STATUS_DISPLAY } from '@factwright/ui';
import { History, Route } from 'lucide-react';
import { useCallback, useEffect, useId, useState } from 'react';
import type { EditResult, FactwrightApi } from '../../shared/api.ts';
import { LIMITS } from '../../shared/limits.ts';
import panel from './JobPanel.module.css';
import styles from './JobTracking.module.css';
import { PanelSection } from './PanelSection.tsx';
import { StageTrack } from './StageTrack.tsx';

/** Runs an edit, and keeps its problem, if any, to show beside the control. */
export function useEdit() {
  const [problem, setProblem] = useState<string | null>(null);
  const run = useCallback(async (edit: Promise<EditResult>) => {
    const result = await edit;
    setProblem(result.ok ? null : result.message);
    return result.ok;
  }, []);
  return { problem, run };
}

export function Problem({ message }: { message: string | null }) {
  return message ? (
    <p className={panel.problem} role="alert">
      {message}
    </p>
  ) : null;
}

/** What happens next, and by when. A date puts it in "Needs you" once it's due. */
export function NextStep({ job, api }: { job: Job; api: FactwrightApi }) {
  const [text, setText] = useState(job.nextAction ?? '');
  const { problem, run } = useEdit();
  const id = useId();
  const hintId = useId();
  useEffect(() => setText(job.nextAction ?? ''), [job.nextAction]);
  const saveText = () => {
    if (text.trim() !== (job.nextAction ?? ''))
      void run(api.updateJob(job.id, { nextAction: text }));
  };
  return (
    <section className={styles.nextStep}>
      <label htmlFor={id} className={styles.boxTitle}>
        Next step
      </label>
      <div className={styles.nextRow}>
        <Input
          id={id}
          aria-describedby={hintId}
          value={text}
          maxLength={LIMITS.nextAction}
          placeholder="What happens next?"
          onChange={(event) => setText(event.target.value)}
          onBlur={saveText}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
          }}
        />
        <Input
          className={styles.nextDate}
          type="date"
          aria-label="Next step by"
          value={job.nextOn ?? ''}
          onChange={(event) =>
            void run(api.updateJob(job.id, { nextOn: event.target.value || null }))
          }
        />
      </div>
      <p id={hintId} className={styles.hint}>
        With a date, it shows in Needs you when it’s due.
      </p>
      <Problem message={problem} />
    </section>
  );
}

/** Where a job stands in a few words, for its Progress heading: "Screen since Oct 9". */
export function progressSummary(job: Job, progress: JobProgress, today: string): string {
  const { label } = JOB_STATUS_DISPLAY[progress.status];
  const call = progress.nextCall;
  if (call) return `${CALL_KIND_LABELS[call.kind]} ${dayFrom(call.onDate, today)}`;
  if (progress.status === 'new') return 'Not applied yet';
  const since = job.statusOn ?? job.appliedOn;
  return since ? `${label} since ${shortDate(since, today)}` : label;
}

/**
 * How far the job has come, step by step with each date. Its calls and interviews have a section
 * of their own, and adding one moves the job along.
 */
export function ProgressSection({
  job,
  progress,
  api,
  today,
}: {
  job: Job;
  progress: JobProgress;
  api: FactwrightApi;
  today: string;
}) {
  const { problem, run } = useEdit();
  return (
    <PanelSection
      id="progress"
      title="Progress"
      icon={<Route size={15} />}
      summary={progressSummary(job, progress, today)}
    >
      <StageTrack job={job} progress={progress} api={api} today={today} run={run} />
      <Problem message={problem} />
    </PanelSection>
  );
}

interface HistoryEntry {
  id: string;
  date: string | null;
  text: string;
  /** For another of the user's jobs at the company, its role, to tell them apart. */
  role?: string;
}

/** Someone the user met on a call, with the last call they were on. */
interface PersonMet extends CallPerson {
  last: Call;
}

/** A note's first line, for a line of history. */
const firstLine = (text: string) => text.trim().split(/\r?\n/)[0] ?? '';

/** A call as a line of history: "Panel interview with Dana Lee (Hiring manager): moved forward". */
function callLine(call: Call): string {
  const kind = CALL_KIND_LABELS[call.kind];
  const people = call.people.length > 0 ? ` with ${callPeople(call.people)}` : '';
  if (call.state === 'canceled') return `${kind}${people}: canceled`;
  const outcome = call.outcome ? `: ${CALL_OUTCOME_LABELS[call.outcome].toLowerCase()}` : '';
  return `${kind}${people}${outcome}`;
}

/** Everything that happened with one job, as lines of history. */
function historyOf(job: Job, today: string): HistoryEntry[] {
  return [
    ...job.events.map((event) => ({ id: event.id, date: event.date, text: event.title })),
    ...job.statusLog.map((change) => ({
      id: change.id,
      date: change.at,
      text: `Marked ${JOB_STATUS_DISPLAY[change.status].label}`,
    })),
    // Calls still to come are in Calls and interviews, not history yet.
    ...job.calls
      .filter((call) => call.onDate <= today)
      .map((call) => ({ id: call.id, date: call.onDate, text: callLine(call) })),
    ...job.notes.map((note) => ({ id: note.id, date: note.on, text: firstLine(note.text) })),
  ];
}

/** Everyone the user has met on the company's calls, most recently met first. */
function peopleMet(jobs: readonly Job[], today: string): PersonMet[] {
  const met = new Map<string, PersonMet>();
  const calls = jobs
    .flatMap((each) => each.calls)
    .filter((call) => call.state !== 'canceled' && call.onDate <= today)
    .sort((a, b) => a.onDate.localeCompare(b.onDate));
  for (const call of calls) {
    for (const person of call.people) {
      const key = person.name.toLowerCase();
      const known = met.get(key);
      met.set(key, { name: person.name, role: person.role ?? known?.role ?? null, last: call });
    }
  }
  return [...met.values()].sort((a, b) => b.last.onDate.localeCompare(a.last.onDate));
}

/**
 * Everything that happened with the company, newest first: each call with who it was with and
 * how it went, the user's notes, each change of status and what Claude did, for this job and the
 * user's other jobs there. Above it, everyone they've met there. Dates of changes are fixed in
 * Progress.
 */
export function HistorySection({
  job,
  related = [],
  today,
}: {
  job: Job;
  /** The user's other jobs at the same company. */
  related?: readonly Job[];
  today: string;
}) {
  const entries = [
    ...historyOf(job, today),
    ...related.flatMap((other) =>
      historyOf(other, today).map((entry) => ({ ...entry, role: other.role || other.company })),
    ),
  ].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
  const people = peopleMet([job, ...related], today);
  if (entries.length === 0) return null;
  const things = entries.length === 1 ? '1 thing' : `${entries.length} things`;
  const met = people.length === 1 ? '1 person met' : `${people.length} people met`;
  return (
    <PanelSection
      id="activity"
      title="History"
      icon={<History size={15} />}
      summary={people.length > 0 ? `${things} · ${met}` : `${things} so far`}
      closedAtFirst
    >
      {people.length > 0 && (
        <>
          <h4 className={styles.subheading}>People you’ve met at {job.company}</h4>
          <ul className={styles.people}>
            {people.map((person) => (
              <li key={person.name}>
                <span className={styles.person}>{person.name}</span>
                {person.role && <span className={styles.role}>{person.role}</span>}
                <span className={styles.lastMet}>
                  {CALL_KIND_LABELS[person.last.kind]}, {shortDate(person.last.onDate, today)}
                </span>
              </li>
            ))}
          </ul>
          <h4 className={styles.subheading}>Everything so far</h4>
        </>
      )}
      <ol className={styles.history}>
        {entries.map((entry) => (
          <li key={entry.id}>
            <span className={styles.when}>{entry.date && shortDate(entry.date, today)}</span>
            <span className={styles.what}>
              {entry.role && <span className={styles.otherRole}>{entry.role}: </span>}
              {entry.text}
            </span>
          </li>
        ))}
      </ol>
    </PanelSection>
  );
}

/** Archiving takes a job out of the lists without losing anything. */
export function ArchiveFooter({
  job,
  api,
  onMerge,
}: {
  job: Job;
  api: FactwrightApi;
  /** Opens Merge with…, for a job found twice. */
  onMerge?: (() => void) | undefined;
}) {
  const { problem, run } = useEdit();
  return (
    <div className={styles.archive}>
      <div className={styles.archiveRow}>
        <Button
          size="sm"
          onClick={() => void run(api.updateJob(job.id, { archived: !job.archived }))}
        >
          {job.archived ? 'Unarchive' : 'Archive this job'}
        </Button>
        <span className={styles.hint}>
          {job.archived
            ? 'Archived. It’s out of your lists until you unarchive it.'
            : 'It leaves your lists but keeps everything. Show it again from Filters.'}
        </span>
      </div>
      {onMerge && (
        <div className={styles.archiveRow}>
          <Button size="sm" onClick={onMerge}>
            Merge with…
          </Button>
          <span className={styles.hint}>The same job found twice? Keep it as one.</span>
        </div>
      )}
      <Problem message={problem} />
    </div>
  );
}
