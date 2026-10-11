import {
  CALL_KIND_LABELS,
  CALL_KINDS,
  CALL_OUTCOME_LABELS,
  CALL_STAGE,
  CALL_STATE_LABELS,
  CALL_STATES,
  type Call,
  type CallKind,
  callWhen,
  type Job,
  type JobStatus,
  SETTLED_STATUSES,
  STATUS_RANK,
} from '@factwright/core';
import {
  Button,
  Field,
  IconButton,
  Input,
  JOB_STATUS_DISPLAY,
  Select,
  TextArea,
} from '@factwright/ui';
import { X } from 'lucide-react';
import { type FormEvent, useCallback, useEffect, useId, useRef, useState } from 'react';
import type { EditResult, FactwrightApi } from '../../shared/api.ts';
import { LIMITS } from '../../shared/limits.ts';
import { shortDate } from './format.ts';
import panel from './JobPanel.module.css';
import styles from './JobTracking.module.css';

/** Runs an edit, and keeps its problem, if any, to show beside the control. */
function useEdit() {
  const [problem, setProblem] = useState<string | null>(null);
  const run = useCallback(async (edit: Promise<EditResult>) => {
    const result = await edit;
    setProblem(result.ok ? null : result.message);
    return result.ok;
  }, []);
  return { problem, run };
}

function Problem({ message }: { message: string | null }) {
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

/** Where a call would move the job, or null when it wouldn't. */
function moveFor(kind: CallKind, status: JobStatus): JobStatus | null {
  if (kind === 'other' || SETTLED_STATUSES.includes(status)) return null;
  const target = CALL_STAGE[kind];
  return (STATUS_RANK[target] ?? 0) > (STATUS_RANK[status] ?? 0) ? target : null;
}

function LogCallForm({
  job,
  status,
  api,
  today,
  onDone,
}: {
  job: Job;
  status: JobStatus;
  api: FactwrightApi;
  today: string;
  onDone: () => void;
}) {
  const [kind, setKind] = useState<CallKind>(
    (STATUS_RANK[status] ?? 0) < (STATUS_RANK.screen ?? 0) ? 'screen' : 'technical',
  );
  const [onDate, setOnDate] = useState(today);
  const [atTime, setAtTime] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const { problem, run } = useEdit();
  const titleId = useId();
  const move = moveFor(kind, status);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    const call = { kind, onDate, atTime: atTime || null, notes: notes.trim() || null };
    const saved = await run(api.addCall(job.id, call));
    setSaving(false);
    if (saved) onDone();
  };

  return (
    <form className={styles.logForm} aria-labelledby={titleId} onSubmit={submit}>
      <p id={titleId} className={styles.boxTitle}>
        Log a call
      </p>
      <div className={styles.formGrid}>
        <Field label="Kind" className={styles.wide}>
          {(control) => (
            <Select
              {...control}
              value={kind}
              onChange={(event) => setKind(event.target.value as CallKind)}
            >
              {CALL_KINDS.map((each) => (
                <option key={each} value={each}>
                  {each === 'other' ? 'Other call' : CALL_KIND_LABELS[each]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Date">
          {(control) => (
            <Input
              {...control}
              type="date"
              required
              value={onDate}
              onChange={(event) => setOnDate(event.target.value)}
            />
          )}
        </Field>
        <Field label="Time, if you know it">
          {(control) => (
            <Input
              {...control}
              type="time"
              value={atTime}
              onChange={(event) => setAtTime(event.target.value)}
            />
          )}
        </Field>
        <Field label="Notes, if any" className={styles.wide}>
          {(control) => (
            <Input
              {...control}
              value={notes}
              maxLength={LIMITS.callNotes}
              placeholder="Who you’ll talk to, what to bring"
              onChange={(event) => setNotes(event.target.value)}
            />
          )}
        </Field>
      </div>
      <p className={styles.hint}>
        {move
          ? `Logging it moves the job to ${JOB_STATUS_DISPLAY[move].label}.`
          : `The job stays at ${JOB_STATUS_DISPLAY[status].label}.`}
      </p>
      <Problem message={problem} />
      <div className={styles.formActions}>
        <Button size="sm" onClick={onDone}>
          Cancel
        </Button>
        <Button size="sm" variant="primary" type="submit" disabled={saving}>
          Log call
        </Button>
      </div>
    </form>
  );
}

function CallItem({ call, api, today }: { call: Call; api: FactwrightApi; today: string }) {
  const { problem, run } = useEdit();
  const label = CALL_KIND_LABELS[call.kind];
  const name = label.toLowerCase();
  return (
    <li className={styles.call}>
      <div className={styles.callHead}>
        <span className={styles.callTitle}>
          <span className={styles.callKind}>{label}</span>
          <span className={styles.callWhen}>{callWhen(call, today)}</span>
        </span>
        <IconButton
          className={styles.delete}
          label={`Delete the ${name}`}
          variant="quiet"
          size="sm"
          icon={<X size={14} aria-hidden="true" />}
          onClick={() => void run(api.deleteCall(call.id))}
        />
      </div>
      <div className={styles.callControls}>
        <Select
          className={`${styles.small} ${styles.stateSelect}`}
          aria-label={`Where the ${name} stands`}
          value={call.state}
          onChange={(event) =>
            void run(api.updateCall(call.id, { state: event.target.value as Call['state'] }))
          }
        >
          {CALL_STATES.map((state) => (
            <option key={state} value={state}>
              {CALL_STATE_LABELS[state]}
            </option>
          ))}
        </Select>
        <Select
          className={`${styles.small} ${styles.outcomeSelect}`}
          aria-label={`How the ${name} went`}
          value={call.outcome ?? ''}
          onChange={(event) =>
            void run(
              api.updateCall(call.id, {
                outcome: (event.target.value || null) as Call['outcome'],
              }),
            )
          }
        >
          <option value="">How did it go?</option>
          {(['advanced', 'waiting', 'rejected'] as const).map((outcome) => (
            <option key={outcome} value={outcome}>
              {CALL_OUTCOME_LABELS[outcome]}
            </option>
          ))}
        </Select>
      </div>
      {call.notes && <p className={styles.callNotes}>{call.notes}</p>}
      <Problem message={problem} />
    </li>
  );
}

/** The calls and interviews logged for a job, and a form to log another. */
export function CallsSection({
  job,
  status,
  api,
  today,
}: {
  job: Job;
  status: JobStatus;
  api: FactwrightApi;
  today: string;
}) {
  const [logging, setLogging] = useState(false);
  return (
    <section className={panel.section}>
      <div className={styles.sectionHead}>
        <h3 className={panel.heading}>Calls and interviews</h3>
        {!logging && (
          <Button size="sm" onClick={() => setLogging(true)}>
            Log a call
          </Button>
        )}
      </div>
      {job.calls.length > 0 && (
        <ul className={styles.calls}>
          {job.calls.map((call) => (
            <CallItem key={call.id} call={call} api={api} today={today} />
          ))}
        </ul>
      )}
      {job.calls.length === 0 && !logging && <p className={panel.quiet}>None logged yet.</p>}
      {logging && (
        <LogCallForm
          job={job}
          status={status}
          api={api}
          today={today}
          onDone={() => setLogging(false)}
        />
      )}
    </section>
  );
}

type SaveState = 'idle' | 'saving' | 'saved' | 'failed';

const SAVE_LABELS: Readonly<Record<SaveState, string>> = {
  idle: 'Saves as you type',
  saving: 'Saving…',
  saved: 'Saved',
  failed: 'Couldn’t save. Keep typing to try again.',
};

/**
 * The user's own notes on a job. They save a moment after typing stops, when the box loses
 * focus, and when the panel moves on to another job.
 */
export function NotesSection({ job, api }: { job: Job; api: FactwrightApi }) {
  const [text, setText] = useState(job.notes ?? '');
  const [state, setState] = useState<SaveState>('idle');
  const pending = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const id = useId();
  const jobId = job.id;

  const save = useCallback(async () => {
    clearTimeout(timer.current);
    const notes = pending.current;
    if (notes === null) return;
    pending.current = null;
    setState('saving');
    const result = await api.updateJob(jobId, { notes });
    setState(result.ok ? 'saved' : 'failed');
  }, [api, jobId]);

  // Whatever is still waiting saves when the panel closes or moves to another job.
  useEffect(() => () => void save(), [save]);

  return (
    <section className={panel.section}>
      <div className={styles.sectionHead}>
        <label htmlFor={id} className={panel.heading}>
          Your notes
        </label>
        <span className={styles.saveState} aria-live="polite">
          {SAVE_LABELS[state]}
        </span>
      </div>
      <TextArea
        id={id}
        className={styles.notes}
        rows={4}
        value={text}
        maxLength={LIMITS.notes}
        placeholder="Names, what they asked, anything to remember"
        onChange={(event) => {
          setText(event.target.value);
          pending.current = event.target.value;
          clearTimeout(timer.current);
          timer.current = setTimeout(() => void save(), 800);
        }}
        onBlur={() => void save()}
      />
    </section>
  );
}

interface HistoryEntry {
  id: string;
  date: string | null;
  text: string;
  /** For a change of status: its id, so its date can be fixed or the change undone. */
  changeId?: string;
}

/** Everything that happened with the job, newest first. Changes of status can be fixed or undone. */
export function HistorySection({
  job,
  api,
  today,
}: {
  job: Job;
  api: FactwrightApi;
  today: string;
}) {
  const { problem, run } = useEdit();
  const latest = job.statusLog.at(-1);
  const entries: HistoryEntry[] = [
    ...job.events.map((event) => ({ id: event.id, date: event.date, text: event.title })),
    ...job.statusLog.map((change) => ({
      id: change.id,
      date: change.at,
      text: `Marked ${JOB_STATUS_DISPLAY[change.status].label}`,
      changeId: change.id,
    })),
    // Calls still to come are under "Calls and interviews", not history yet.
    ...job.calls
      .filter((call) => call.onDate <= today)
      .map((call) => ({
        id: call.id,
        date: call.onDate,
        text: `${CALL_KIND_LABELS[call.kind]}: ${CALL_STATE_LABELS[call.state].toLowerCase()}`,
      })),
  ].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
  if (entries.length === 0) return null;
  return (
    <section className={panel.section}>
      <h3 className={panel.heading}>History</h3>
      <ol className={styles.history}>
        {entries.map((entry) => (
          <li key={entry.id}>
            <span className={styles.when}>
              {entry.changeId && entry.date ? (
                <Input
                  className={styles.whenInput}
                  type="date"
                  max={today}
                  aria-label={`When it was ${entry.text.toLowerCase()}`}
                  value={entry.date}
                  onChange={(event) => {
                    const at = event.target.value;
                    if (at && entry.changeId) void run(api.redateStatusChange(entry.changeId, at));
                  }}
                />
              ) : (
                entry.date && shortDate(entry.date, today)
              )}
            </span>
            <span className={styles.what}>{entry.text}</span>
            {entry.changeId && entry.changeId === latest?.id && (
              <Button
                variant="quiet"
                size="sm"
                aria-label={`Undo “${entry.text}”`}
                onClick={() => void run(api.undoStatusChange(latest.id))}
              >
                Undo
              </Button>
            )}
          </li>
        ))}
      </ol>
      {latest && (
        <p className={styles.hint}>
          Fix a date if you marked something late. Undo takes back the latest change and puts the
          job where it was.
        </p>
      )}
      <Problem message={problem} />
    </section>
  );
}

/** Archiving takes a job out of the lists without losing anything. */
export function ArchiveFooter({ job, api }: { job: Job; api: FactwrightApi }) {
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
      <Problem message={problem} />
    </div>
  );
}
