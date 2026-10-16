import {
  CALL_KIND_LABELS,
  CALL_KINDS,
  CALL_LENGTHS,
  CALL_MODE_LABELS,
  CALL_MODES,
  CALL_OUTCOME_LABELS,
  CALL_OUTCOMES,
  CALL_STAGE,
  CALL_STATE_LABELS,
  CALL_STATES,
  type Call,
  type CallDocKind,
  type CallKind,
  type CallMode,
  type CallPerson,
  type CallState,
  callLength,
  callPeople,
  callWhen,
  dayFrom,
  type Job,
  type JobProgress,
  type JobStatus,
  SETTLED_STATUSES,
  STATUS_RANK,
  shortDate,
} from '@factwright/core';
import {
  Button,
  Dialog,
  Field,
  IconButton,
  Input,
  JOB_STATUS_DISPLAY,
  Markdown,
  Select,
  TextArea,
} from '@factwright/ui';
import {
  ArrowUpRight,
  CalendarClock,
  Copy,
  FileText,
  Mail,
  MessagesSquare,
  Pencil,
  Plus,
  Sparkles,
  X,
} from 'lucide-react';
import { type FormEvent, useEffect, useId, useState } from 'react';
import type { FactwrightApi } from '../../shared/api.ts';
import { LIMITS } from '../../shared/limits.ts';
import { type RunTask, THANKS_SKILL, taskCall, taskJob } from '../../shared/runs.ts';
import { keepsDrafts } from '../unsaved.ts';
import styles from './JobCalls.module.css';
import panel from './JobPanel.module.css';
import { Problem, useEdit } from './JobTracking.tsx';
import { PanelSection } from './PanelSection.tsx';
import { BUSY, type RunControls } from './RunActions.tsx';

/** How a call went, typed but not saved yet, by the call, so moving away and back keeps it. */
const debriefs = new Map<string, string>();
keepsDrafts(() => debriefs.size > 0);

/** The round that usually comes after each kind of call, for the form to start on. */
const NEXT_KIND: Readonly<Record<CallKind, CallKind>> = {
  screen: 'manager',
  manager: 'technical',
  technical: 'panel',
  takehome: 'panel',
  panel: 'final',
  final: 'offer',
  offer: 'offer',
  other: 'other',
};

/** Parts people often play in a hiring process, for the role box to suggest. */
const ROLES = [
  'Recruiter',
  'Hiring manager',
  'Engineering manager',
  'Engineer',
  'Senior engineer',
  'Staff engineer',
  'Product manager',
  'Designer',
  'Director',
  'VP',
  'Founder',
  'CEO',
  'CTO',
];

/** What each document Claude writes for a call is called on screen. */
const DOC_NAMES: Readonly<Record<CallDocKind, string>> = {
  prep: 'Prep sheet',
  thanks: 'Thank-you notes',
};

/** A call's kind, in words that fit in a sentence: "the panel interview". */
const callName = (call: Pick<Call, 'kind'>) => `the ${CALL_KIND_LABELS[call.kind].toLowerCase()}`;

/** The time of day now, as "HH:MM", to tell whether a call today has started. */
function clockNow(): string {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

/**
 * Where a booked call stands today: still to come, so it's time to get ready for it, or started,
 * so it's time to say how it went. A call today with no time given is both, all day.
 */
function timing(call: Call, today: string, now: string): { ahead: boolean; started: boolean } {
  if (call.state !== 'scheduled') return { ahead: false, started: call.state === 'done' };
  if (call.onDate !== today) return { ahead: call.onDate > today, started: call.onDate < today };
  if (!call.atTime) return { ahead: true, started: true };
  return { ahead: now < call.atTime, started: now >= call.atTime };
}

/** A meeting link the app can open, as only https links open from it, or null. */
function meetingLink(place: string | null): URL | null {
  if (!place) return null;
  try {
    const url = new URL(place.trim());
    return url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

/** Where the job's calls stand, in a few words, for the section's heading. */
export function callsSummary(job: Job, progress: JobProgress, today: string): string {
  const next = progress.nextCall;
  if (next) {
    const prepped = job.callDocs.some((doc) => doc.callId === next.id && doc.kind === 'prep');
    const when = callWhen(next, today);
    return `${CALL_KIND_LABELS[next.kind]} ${when}${prepped ? ' · prep ready' : ''}`;
  }
  const held = job.calls.filter((call) => call.state !== 'canceled').length;
  if (held === 0) return 'None yet';
  return held === 1 ? '1 call' : `${held} calls`;
}

/** The kind of call the form starts on: the round after the last one, or the first. */
function nextKind(job: Job, status: JobStatus): CallKind {
  const last = job.calls.findLast((call) => call.state !== 'canceled');
  if (last) return NEXT_KIND[last.kind];
  return (STATUS_RANK[status] ?? 0) < (STATUS_RANK.screen ?? 0) ? 'screen' : 'technical';
}

/** Where adding a call would move the job, or null when it wouldn't. */
function moveFor(kind: CallKind, status: JobStatus): JobStatus | null {
  if (kind === 'other' || SETTLED_STATUSES.includes(status)) return null;
  const target = CALL_STAGE[kind];
  return (STATUS_RANK[target] ?? 0) > (STATUS_RANK[status] ?? 0) ? target : null;
}

/** Everyone the user has met on the job's calls, once each, for the name box to suggest. */
function peopleMet(job: Job): CallPerson[] {
  const met = new Map<string, CallPerson>();
  for (const call of job.calls) {
    for (const person of call.people) {
      const key = person.name.toLowerCase();
      if (!met.has(key) || (person.role && !met.get(key)?.role)) met.set(key, person);
    }
  }
  return [...met.values()];
}

/** A person's row in the form: their name and their part, as typed. */
interface PersonRow {
  key: number;
  name: string;
  role: string;
}

let rowKeys = 0;
const personRow = (person?: CallPerson): PersonRow => ({
  key: ++rowKeys,
  name: person?.name ?? '',
  role: person?.role ?? '',
});

/** What the place box asks for, from how the call happens. */
const PLACE_LABELS: Readonly<Record<CallMode | '', { label: string; placeholder: string }>> = {
  '': { label: 'Where', placeholder: 'A link, a number or an address' },
  phone: { label: 'Number', placeholder: 'Their number, or “they’ll call me”' },
  video: { label: 'Meeting link', placeholder: 'https://' },
  onsite: { label: 'Address', placeholder: 'Where to go, and who to ask for' },
};

/**
 * The form to add a call, or change one: what kind, when and for how long, how it happens and
 * where, who it's with, and what it's about. Changing one can also cancel it.
 */
function CallForm({
  job,
  status,
  api,
  today,
  call,
  startKind,
  onDone,
}: {
  job: Job;
  status: JobStatus;
  api: FactwrightApi;
  today: string;
  /** The call to change, or none to add one. */
  call?: Call;
  /** The kind a new call starts as. */
  startKind?: CallKind;
  onDone: () => void;
}) {
  const [kind, setKind] = useState<CallKind>(call?.kind ?? startKind ?? 'screen');
  const [onDate, setOnDate] = useState(call?.onDate ?? today);
  const [atTime, setAtTime] = useState(call?.atTime ?? '');
  const [minutes, setMinutes] = useState(call?.minutes ? String(call.minutes) : '');
  const [mode, setMode] = useState<CallMode | ''>(call?.mode ?? '');
  const [place, setPlace] = useState(call?.place ?? '');
  const [people, setPeople] = useState<PersonRow[]>(() =>
    call && call.people.length > 0 ? call.people.map(personRow) : [personRow()],
  );
  const [notes, setNotes] = useState(call?.notes ?? '');
  const [state, setState] = useState<CallState>(call?.state ?? 'scheduled');
  const [saving, setSaving] = useState(false);
  const { problem, run } = useEdit();
  const [unnamed, setUnnamed] = useState(false);
  const titleId = useId();
  const namesId = useId();
  const rolesId = useId();
  const move = call ? null : moveFor(kind, status);
  const lengths =
    call?.minutes && !CALL_LENGTHS.includes(call.minutes)
      ? [...CALL_LENGTHS, call.minutes].sort((a, b) => a - b)
      : CALL_LENGTHS;
  const known = peopleMet(job);

  const changePerson = (key: number, change: Partial<PersonRow>) =>
    setPeople((rows) => rows.map((row) => (row.key === key ? { ...row, ...change } : row)));
  // A name picked from the people met already brings their part along, unless one's typed.
  const pickName = (key: number, name: string) => {
    const met = known.find((person) => person.name.toLowerCase() === name.trim().toLowerCase());
    setPeople((rows) =>
      rows.map((row) =>
        row.key === key ? { ...row, name, role: row.role || (met?.role ?? '') } : row,
      ),
    );
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (people.some((row) => !row.name.trim() && row.role.trim())) {
      setUnnamed(true);
      return;
    }
    setUnnamed(false);
    setSaving(true);
    const details = {
      kind,
      onDate,
      atTime: atTime || null,
      minutes: minutes ? Number(minutes) : null,
      mode: mode || null,
      place: place.trim() || null,
      people: people
        .filter((row) => row.name.trim())
        .map((row) => ({ name: row.name.trim(), role: row.role.trim() || null })),
      notes: notes.trim() || null,
    };
    const saved = await run(
      call ? api.updateCall(call.id, { ...details, state }) : api.addCall(job.id, details),
    );
    setSaving(false);
    if (saved) onDone();
  };

  const placeText = PLACE_LABELS[mode];
  return (
    <form className={styles.form} aria-labelledby={titleId} onSubmit={submit}>
      <p id={titleId} className={styles.formTitle}>
        {call ? `Change ${callName(call)}` : 'Add a call'}
      </p>
      <div className={styles.grid}>
        <Field label="Kind" className={styles.wide}>
          {(control) => (
            <Select
              {...control}
              value={kind}
              data-autofocus
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
        <Field label={kind === 'takehome' ? 'Due' : 'Date'}>
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
        <Field label="How long">
          {(control) => (
            <Select
              {...control}
              value={minutes}
              onChange={(event) => setMinutes(event.target.value)}
            >
              <option value="">Not sure</option>
              {lengths.map((each) => (
                <option key={each} value={each}>
                  {callLength(each)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="How">
          {(control) => (
            <Select
              {...control}
              value={mode}
              onChange={(event) => setMode(event.target.value as CallMode | '')}
            >
              <option value="">Not sure</option>
              {CALL_MODES.map((each) => (
                <option key={each} value={each}>
                  {CALL_MODE_LABELS[each]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={placeText.label} className={styles.wide}>
          {(control) => (
            <Input
              {...control}
              value={place}
              maxLength={LIMITS.place}
              placeholder={placeText.placeholder}
              onChange={(event) => setPlace(event.target.value)}
            />
          )}
        </Field>
      </div>
      <fieldset className={styles.people}>
        <legend className={styles.legend}>Who it’s with</legend>
        {people.map((row, i) => (
          <div key={row.key} className={styles.person}>
            <Input
              aria-label={`Name of person ${i + 1}`}
              value={row.name}
              maxLength={LIMITS.person}
              placeholder="Name"
              list={namesId}
              onChange={(event) => pickName(row.key, event.target.value)}
            />
            <Input
              aria-label={`Role of person ${i + 1}`}
              value={row.role}
              maxLength={LIMITS.person}
              placeholder="Their role"
              list={rolesId}
              onChange={(event) => changePerson(row.key, { role: event.target.value })}
            />
            <IconButton
              label={`Remove person ${i + 1}`}
              variant="quiet"
              size="sm"
              icon={<X size={14} aria-hidden="true" />}
              onClick={() =>
                setPeople((rows) =>
                  rows.length > 1 ? rows.filter((each) => each.key !== row.key) : [personRow()],
                )
              }
            />
          </div>
        ))}
        {people.length < LIMITS.people && (
          <Button
            size="sm"
            variant="quiet"
            icon={<Plus size={13} aria-hidden="true" />}
            onClick={() => setPeople((rows) => [...rows, personRow()])}
          >
            Add a person
          </Button>
        )}
        <datalist id={namesId}>
          {known.map((person) => (
            <option key={person.name} value={person.name} />
          ))}
        </datalist>
        <datalist id={rolesId}>
          {ROLES.map((role) => (
            <option key={role} value={role} />
          ))}
        </datalist>
        {unnamed && (
          <p className={panel.problem} role="alert">
            Add a name for each person, or remove the row.
          </p>
        )}
      </fieldset>
      <Field label="What it’s about" className={styles.about}>
        {(control) => (
          <TextArea
            {...control}
            rows={2}
            value={notes}
            maxLength={LIMITS.callNotes}
            placeholder="What they said it covers, what to bring"
            onChange={(event) => setNotes(event.target.value)}
          />
        )}
      </Field>
      {call && (
        <Field label="Where it stands" className={styles.stateField}>
          {(control) => (
            <Select
              {...control}
              value={state}
              onChange={(event) => setState(event.target.value as CallState)}
            >
              {CALL_STATES.map((each) => (
                <option key={each} value={each}>
                  {CALL_STATE_LABELS[each]}
                </option>
              ))}
            </Select>
          )}
        </Field>
      )}
      {!call && (
        <p className={styles.hint}>
          {move
            ? `Adding it moves the job to ${JOB_STATUS_DISPLAY[move].label}.`
            : `The job stays at ${JOB_STATUS_DISPLAY[status].label}.`}
        </p>
      )}
      <Problem message={problem} />
      <div className={styles.formActions}>
        <Button size="sm" onClick={onDone}>
          Cancel
        </Button>
        <Button size="sm" variant="primary" type="submit" disabled={saving}>
          {call ? 'Save' : 'Add call'}
        </Button>
      </div>
    </form>
  );
}

/** How a call went, in the user's words, saved when the box loses focus. */
function Debrief({ call, api }: { call: Call; api: FactwrightApi }) {
  const [text, setText] = useState(debriefs.get(call.id) ?? call.debrief ?? '');
  const { problem, run } = useEdit();
  const id = useId();
  // A change from elsewhere, such as a sync, shows unless something's being typed here.
  useEffect(() => {
    if (!debriefs.has(call.id)) setText(call.debrief ?? '');
  }, [call.id, call.debrief]);
  const type = (value: string) => {
    setText(value);
    if (value.trim() !== (call.debrief ?? '')) debriefs.set(call.id, value);
    else debriefs.delete(call.id);
  };
  const save = async () => {
    if (!debriefs.has(call.id)) return;
    if (await run(api.updateCall(call.id, { debrief: text.trim() || null }))) {
      debriefs.delete(call.id);
    }
  };
  return (
    <div className={styles.debrief}>
      <label htmlFor={id} className={styles.debriefLabel}>
        How it went
      </label>
      <TextArea
        id={id}
        rows={3}
        value={text}
        maxLength={LIMITS.debrief}
        placeholder="What they asked, what landed, what you’d say differently, and what’s next"
        onChange={(event) => type(event.target.value)}
        onBlur={save}
      />
      <Problem message={problem} />
    </div>
  );
}

/** One person's thank-you note, from the Markdown the skill saves: a heading for each. */
interface ThanksNote {
  name: string;
  subject: string | null;
  body: string;
}

/** The thank-you notes, one for each person, or none when they aren't under headings. */
export function thanksNotes(markdown: string): ThanksNote[] {
  return markdown
    .split(/^## +/m)
    .slice(1)
    .map((part) => {
      const [first = '', ...rest] = part.split(/\r?\n/);
      const text = rest.join('\n');
      const subject = text.match(/^\*\*Subject:\*\*[ \t]*(.+)$/m)?.[1]?.trim() ?? null;
      const body = text.replace(/^\*\*Subject:\*\*.*$/m, '').trim();
      return { name: first.trim(), subject, body };
    })
    .filter((note) => note.name && note.body);
}

/** A note's words to paste into an email, without the Markdown's marks for bold and italics. */
const plainNote = (body: string) => body.replace(/\*\*(.+?)\*\*/g, '$1').replace(/_(.+?)_/g, '$1');

/** The thank-you notes, each with buttons to copy its subject and its words. */
function ThanksNotes({ markdown, api }: { markdown: string; api: FactwrightApi }) {
  const [copied, setCopied] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const notes = thanksNotes(markdown);
  if (notes.length === 0) return <Markdown text={markdown} />;
  const copy = async (what: string, text: string) => {
    const result = await api.copyText(text);
    setProblem(result.ok ? null : result.message);
    setCopied(result.ok ? what : null);
    if (result.ok) setTimeout(() => setCopied((now) => (now === what ? null : now)), 2000);
  };
  return (
    <div className={styles.notes}>
      <p className={styles.hint}>Drafts for you to send, the same day if you can.</p>
      {notes.map((note) => (
        <section key={note.name} className={styles.note} aria-label={`Note to ${note.name}`}>
          <h3 className={styles.noteName}>{note.name}</h3>
          {note.subject && (
            <p className={styles.subject}>
              <span className={styles.subjectText}>Subject: {note.subject}</span>
              <Button
                size="sm"
                variant="quiet"
                icon={<Copy size={13} aria-hidden="true" />}
                aria-label={`Copy the subject for ${note.name}`}
                onClick={() => copy(`subject ${note.name}`, note.subject ?? '')}
              >
                {copied === `subject ${note.name}` ? 'Copied' : 'Copy'}
              </Button>
            </p>
          )}
          <Markdown text={note.body} />
          <Button
            size="sm"
            icon={<Copy size={13} aria-hidden="true" />}
            aria-label={`Copy the note to ${note.name}`}
            onClick={() => copy(`note ${note.name}`, plainNote(note.body))}
          >
            {copied === `note ${note.name}` ? 'Copied' : 'Copy note'}
          </Button>
        </section>
      ))}
      <span className={styles.announce} role="status">
        {copied ? 'Copied' : ''}
      </span>
      {problem && (
        <p className={panel.problem} role="alert">
          {problem}
        </p>
      )}
    </div>
  );
}

/** What a call's run is: prep for it, practice for it, or thank-you notes after it. */
type CallRun = 'prep' | 'practice' | 'thanks';

const runTask = (jobId: string, callId: string, kind: CallRun): RunTask =>
  kind === 'thanks'
    ? { skill: THANKS_SKILL, jobId, callId }
    : kind === 'practice'
      ? { skill: 'interview-prep', jobId, callId, practice: true }
      : { skill: 'interview-prep', jobId, callId };

/** Which of a call's runs is the one Claude's panel has, if any. */
function runOf(task: RunTask | null): CallRun | null {
  if (!task || !('callId' in task)) return null;
  if (task.skill === THANKS_SKILL) return 'thanks';
  return 'practice' in task && task.practice ? 'practice' : 'prep';
}

/**
 * One call: when, how long and how, where, who it's with and what it's about, with Claude's prep
 * for it and practice before it, and once it's happened, how it went and thank-you notes after.
 */
function CallCard({
  job,
  call,
  api,
  today,
  run,
  next,
  last,
  status,
  onOpen,
  onAddNext,
  now,
}: {
  job: Job;
  call: Call;
  api: FactwrightApi;
  today: string;
  run?: RunControls | undefined;
  /** Whether it's the next call booked. */
  next: boolean;
  /** Whether it's the latest call, so a good outcome offers the next round. */
  last: boolean;
  status: JobStatus;
  onOpen: (call: Call, kind: CallDocKind) => void;
  onAddNext: (kind: CallKind) => void;
  /** The time of day now, as "HH:MM". */
  now: string;
}) {
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const { problem, run: save } = useEdit();
  const name = callName(call);
  const label = CALL_KIND_LABELS[call.kind];
  const docs = job.callDocs.filter((doc) => doc.callId === call.id);
  const doc = (kind: CallDocKind) => docs.find((each) => each.kind === kind);
  const prep = doc('prep');
  const thanks = doc('thanks');
  const { ahead, started } = timing(call, today, now);
  const canceled = call.state === 'canceled';
  const busy = run ? BUSY.includes(run.phase) : false;
  const mine = run && taskJob(run.task) === job.id && taskCall(run.task) === call.id;
  const running = (kind: CallRun) => Boolean(mine && busy && runOf(run?.task ?? null) === kind);
  const start = (kind: CallRun) => {
    if (!run) return;
    if (running(kind)) run.show();
    else run.start(runTask(job.id, call.id, kind));
  };
  const link = meetingLink(call.place);
  const details = [
    callWhen(call, today),
    call.minutes && callLength(call.minutes),
    call.mode && CALL_MODE_LABELS[call.mode],
  ].filter(Boolean);

  if (editing) {
    return (
      <li className={styles.item}>
        <CallForm
          job={job}
          status={status}
          api={api}
          today={today}
          call={call}
          onDone={() => setEditing(false)}
        />
      </li>
    );
  }

  return (
    <li
      className={`${styles.item} ${styles.call} ${next ? styles.next : ''} ${canceled ? styles.canceled : ''}`}
    >
      <div className={styles.head}>
        <div className={styles.title}>
          <span className={styles.kind}>
            {label}
            {canceled && <span className={styles.tag}>Canceled</span>}
            {next && <span className={styles.tag}>Next</span>}
          </span>
          <span className={styles.when}>{details.join(' · ')}</span>
        </div>
        <IconButton
          label={`Change ${name}`}
          variant="quiet"
          size="sm"
          icon={<Pencil size={13} aria-hidden="true" />}
          onClick={() => setEditing(true)}
        />
        <IconButton
          label={`Delete ${name}`}
          variant="quiet"
          size="sm"
          icon={<X size={14} aria-hidden="true" />}
          onClick={() => setDeleting(true)}
        />
      </div>
      {call.place &&
        (link ? (
          <a className={styles.place} href={link.href} target="_blank" rel="noreferrer">
            <span className={styles.link}>
              Join at {link.host}
              {link.pathname.length > 1 && <span className={styles.path}>{link.pathname}</span>}
            </span>
            <ArrowUpRight size={13} aria-hidden="true" />
          </a>
        ) : (
          <p className={styles.placeText}>{call.place}</p>
        ))}
      {call.people.length > 0 && <p className={styles.with}>With {callPeople(call.people)}</p>}
      {call.notes && <p className={styles.about}>{call.notes}</p>}

      {deleting && (
        <div className={styles.confirm}>
          <span>
            Delete {name}
            {call.debrief || docs.length > 0 ? ', with how it went and Claude’s work for it' : ''}?
          </span>
          <Button size="sm" onClick={() => setDeleting(false)}>
            Keep it
          </Button>
          <Button size="sm" variant="primary" onClick={() => void save(api.deleteCall(call.id))}>
            Delete
          </Button>
        </div>
      )}

      {ahead && (
        <div className={styles.actions}>
          {prep && (
            <Button
              size="sm"
              variant="primary"
              icon={<FileText size={13} aria-hidden="true" />}
              aria-label={`Open the prep sheet for ${name}`}
              onClick={() => onOpen(call, 'prep')}
            >
              Prep sheet
            </Button>
          )}
          {run && (
            <Button
              size="sm"
              variant={prep ? 'quiet' : 'primary'}
              icon={<Sparkles size={13} aria-hidden="true" />}
              disabled={busy && !running('prep')}
              aria-label={
                running('prep')
                  ? `Preparing for ${name}: show Claude`
                  : prep
                    ? `Prep again for ${name}`
                    : `Call prep for ${name}`
              }
              onClick={() => start('prep')}
            >
              {running('prep') ? 'Preparing…' : prep ? 'Prep again' : 'Call prep'}
            </Button>
          )}
          {run && (
            <Button
              size="sm"
              variant="quiet"
              icon={<MessagesSquare size={13} aria-hidden="true" />}
              disabled={busy && !running('practice')}
              aria-label={
                running('practice') ? `Practicing ${name}: show Claude` : `Practice ${name}`
              }
              onClick={() => start('practice')}
            >
              {running('practice') ? 'Practicing…' : 'Practice'}
            </Button>
          )}
          {prep && (
            <span className={styles.docDate}>
              Prep from {shortDate(prep.modified.slice(0, 10), today)}
            </span>
          )}
        </div>
      )}

      {started && (
        <>
          <div className={styles.outcome}>
            <Select
              className={styles.small}
              aria-label={`How ${name} went`}
              value={call.outcome ?? ''}
              onChange={(event) =>
                void save(
                  api.updateCall(call.id, {
                    outcome: (event.target.value || null) as Call['outcome'],
                  }),
                )
              }
            >
              <option value="">How did it go?</option>
              {CALL_OUTCOMES.map((outcome) => (
                <option key={outcome} value={outcome}>
                  {CALL_OUTCOME_LABELS[outcome]}
                </option>
              ))}
            </Select>
            {call.state === 'scheduled' && call.onDate < today && (
              <span className={styles.docDate}>Booked for {dayFrom(call.onDate, today)}</span>
            )}
          </div>
          <Debrief key={call.id} call={call} api={api} />
          <div className={styles.actions}>
            {thanks && (
              <Button
                size="sm"
                icon={<Mail size={13} aria-hidden="true" />}
                aria-label={`Open the thank-you notes for ${name}`}
                onClick={() => onOpen(call, 'thanks')}
              >
                Thank-you notes
              </Button>
            )}
            {run && (
              <Button
                size="sm"
                variant="quiet"
                icon={<Sparkles size={13} aria-hidden="true" />}
                disabled={busy && !running('thanks')}
                aria-label={
                  running('thanks')
                    ? `Writing thank-you notes for ${name}: show Claude`
                    : thanks
                      ? `Write the thank-you notes for ${name} again`
                      : `Write thank-you notes for ${name}`
                }
                onClick={() => start('thanks')}
              >
                {running('thanks') ? 'Writing…' : thanks ? 'Write again' : 'Write thank-you notes'}
              </Button>
            )}
            {prep && !ahead && (
              <Button
                size="sm"
                variant="quiet"
                icon={<FileText size={13} aria-hidden="true" />}
                aria-label={`Open the prep sheet for ${name}`}
                onClick={() => onOpen(call, 'prep')}
              >
                Prep sheet
              </Button>
            )}
            {last && call.outcome === 'advanced' && (
              <Button
                size="sm"
                variant="quiet"
                icon={<Plus size={13} aria-hidden="true" />}
                onClick={() => onAddNext(NEXT_KIND[call.kind])}
              >
                Add the next round
              </Button>
            )}
          </div>
        </>
      )}
      <Problem message={problem} />
    </li>
  );
}

/**
 * The job's calls and interviews, each a step in the company's hiring process, in the order they
 * happen: what each one is and who it's with, Claude's prep for it, and how it went.
 */
export function CallsSection({
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
  run?: RunControls | undefined;
}) {
  // The kind of call the add form starts on, while it's open.
  const [adding, setAdding] = useState<CallKind | null>(null);
  const [open, setOpen] = useState<{ title: string; kind: CallDocKind; text: string } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const latest = job.calls.findLast((call) => call.state !== 'canceled');
  // The time of day, kept current, so a call today turns to how it went once its time comes.
  const [now, setNow] = useState(clockNow);
  useEffect(() => {
    const tick = setInterval(() => setNow(clockNow()), 60_000);
    return () => clearInterval(tick);
  }, []);

  const openDoc = async (call: Call, kind: CallDocKind) => {
    const extras = await api.jobExtras(job.id);
    const text = extras?.calls?.[call.id]?.[kind];
    setProblem(text ? null : 'That isn’t in your workspace anymore.');
    if (text) {
      const when = shortDate(call.onDate, today);
      setOpen({ title: `${DOC_NAMES[kind]}: ${CALL_KIND_LABELS[call.kind]}, ${when}`, kind, text });
    }
  };

  return (
    <PanelSection
      id="calls"
      title="Calls and interviews"
      icon={<CalendarClock size={15} />}
      summary={callsSummary(job, progress, today)}
      actions={
        adding === null && (
          <Button size="sm" onClick={() => setAdding(nextKind(job, progress.status))}>
            Add a call
          </Button>
        )
      }
    >
      {job.calls.length === 0 && adding === null && (
        <p className={panel.quiet}>
          When a company sets up a call, add it here with who it’s with, and your Claude can get you
          ready for it.
        </p>
      )}
      {job.calls.length > 0 && (
        <ol className={styles.calls} aria-label={`Calls and interviews with ${job.company}`}>
          {job.calls.map((call) => (
            <CallCard
              key={call.id}
              job={job}
              call={call}
              api={api}
              today={today}
              run={run}
              next={progress.nextCall?.id === call.id && timing(call, today, now).ahead}
              last={latest?.id === call.id}
              status={progress.status}
              onOpen={openDoc}
              onAddNext={setAdding}
              now={now}
            />
          ))}
        </ol>
      )}
      {adding !== null && (
        <CallForm
          key={adding}
          job={job}
          status={progress.status}
          api={api}
          today={today}
          startKind={adding}
          onDone={() => setAdding(null)}
        />
      )}
      {problem && (
        <p className={panel.problem} role="alert">
          {problem}
        </p>
      )}
      {open && (
        <Dialog title={open.title} size="lg" onClose={() => setOpen(null)}>
          {open.kind === 'thanks' ? (
            <ThanksNotes markdown={open.text} api={api} />
          ) : (
            <Markdown text={open.text} />
          )}
        </Dialog>
      )}
    </PanelSection>
  );
}
