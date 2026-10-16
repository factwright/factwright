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
  callInvite,
  callInviteName,
  callLength,
  callLink,
  callPeople,
  callStart,
  callWhen,
  dayFrom,
  type Invite,
  type InviteOptions,
  type Job,
  type JobProgress,
  type JobStatus,
  MAX_INVITE_LENGTH,
  readInvite,
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
  Bell,
  BellOff,
  CalendarClock,
  CalendarPlus,
  Copy,
  FileText,
  FileUp,
  Mail,
  MessagesSquare,
  Pencil,
  Plus,
  Sparkles,
  X,
} from 'lucide-react';
import { type DragEvent, type FormEvent, useEffect, useId, useRef, useState } from 'react';
import type { FactwrightApi } from '../../shared/api.ts';
import { LIMITS } from '../../shared/limits.ts';
import { REMINDER_LEAD } from '../../shared/reminders.ts';
import { type RunTask, THANKS_SKILL, taskCall, taskJob } from '../../shared/runs.ts';
import { keepsDrafts } from '../unsaved.ts';
import styles from './JobCalls.module.css';
import panel from './JobPanel.module.css';
import { Problem, useEdit } from './JobTracking.tsx';
import { PanelSection } from './PanelSection.tsx';
import { BUSY, type RunControls } from './RunActions.tsx';
import type { ReminderSwitch } from './useCallReminders.ts';

/**
 * How a call went, typed but not saved yet, by the call, so moving away and back keeps it: the
 * job it's for, the words, and what the call said when typing started.
 */
const debriefs = new Map<string, { jobId: string; text: string; base: string }>();
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

/** Where the job's calls stand, in a few words, for the section's heading. */
export function callsSummary(job: Job, progress: JobProgress, today: string): string {
  const next = progress.nextCall;
  if (next) {
    const prepped = job.callDocs.some((doc) => doc.callId === next.id && doc.kind === 'prep');
    const when = callWhen(next, today);
    return `${CALL_KIND_LABELS[next.kind]} ${when}${prepped ? ' · prep ready' : ''}`;
  }
  const held = job.calls.filter((call) => call.state !== 'canceled').length;
  const canceled = job.calls.length - held;
  if (held > 0) return held === 1 ? '1 call' : `${held} calls`;
  return canceled > 0 ? `${canceled} canceled` : 'None yet';
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

/** The user, by name and email, to leave out of who a dropped invite says the call is with. */
export type InviteMe = InviteOptions['me'];

/** Whether a file is a calendar invite, by its name or its type. */
const isInviteFile = (file: File) => /\.ics$/i.test(file.name) || file.type === 'text/calendar';

/**
 * A calendar invite the user dropped or picked, read here in the window, with nothing sent
 * anywhere, or why it couldn't be.
 */
async function inviteIn(file: File, me: InviteMe): Promise<Invite | string> {
  if (!isInviteFile(file)) {
    return 'That isn’t a calendar invite. Use the .ics file attached to the invite’s email.';
  }
  if (file.size > MAX_INVITE_LENGTH) return 'That file is too big to be an invite.';
  let text: string;
  try {
    text = await file.text();
  } catch {
    return 'That file couldn’t be read. Try saving it again from the email.';
  }
  const limits = { place: LIMITS.place, person: LIMITS.person, people: LIMITS.people };
  return (
    readInvite(text, { me, limits }) ??
    'Factwright couldn’t find a call in that invite. Fill it in yourself instead.'
  );
}

/** What an invite filled in, in words: "the date, time, length, meeting link and 2 people". */
function filledIn(invite: Invite): string {
  const people = invite.people.length;
  const parts = [
    'the date',
    invite.atTime && 'time',
    invite.minutes && 'length',
    invite.place && (invite.online ? 'meeting link' : 'place'),
    people > 0 && (people === 1 ? '1 person' : `${people} people`),
  ].filter((part): part is string => Boolean(part));
  const list =
    parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : 'the date';
  const check = invite.zoneUnread
    ? 'Its time zone wasn’t clear, so check the time.'
    : 'Check them before you add it.';
  return `Filled in ${list} from the invite. ${check}`;
}

/**
 * The form's people, with an invite's added after them: each name once, with the part they
 * played before when they're someone met already.
 */
function withPeople(
  rows: readonly PersonRow[],
  people: readonly CallPerson[],
  known: readonly CallPerson[],
): PersonRow[] {
  const kept = rows.filter((row) => row.name.trim() || row.role.trim());
  const named = new Set(kept.map((row) => row.name.trim().toLowerCase()));
  const added = people
    .filter((person) => !named.has(person.name.toLowerCase()))
    .map((person) => {
      const met = known.find((each) => each.name.toLowerCase() === person.name.toLowerCase());
      return personRow({ name: person.name, role: met?.role ?? null });
    });
  const all = [...kept, ...added].slice(0, LIMITS.people);
  return all.length > 0 ? all : [personRow()];
}

/**
 * Whether a booked call's reminder is still to come, an hour before it starts, as it comes to a
 * job that isn't archived.
 */
function reminderAhead(job: Job, call: Call, today: string, now: string): boolean {
  if (job.archived || call.state !== 'scheduled') return false;
  const start = callStart(call);
  const clock = callStart({ onDate: today, atTime: now });
  return Boolean(start && clock && start.getTime() - REMINDER_LEAD * 60_000 > clock.getTime());
}

/** What a call's calendar file says about it, to tell when the call has changed since. */
const fileFacts = (job: Job, call: Call) =>
  JSON.stringify([
    job.company,
    job.role,
    call.kind,
    call.onDate,
    call.atTime,
    call.minutes,
    call.mode,
    call.place,
    call.people,
    call.notes,
    call.state,
  ]);

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
  me,
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
  /** The user, whom an invite dropped on the form names among its people. */
  me?: InviteMe;
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
  const inviteHintId = useId();
  // The form takes the keyboard's focus as it opens, on its first field.
  const first = useRef<HTMLSelectElement>(null);
  useEffect(() => first.current?.focus(), []);
  const move = call ? null : moveFor(kind, status);
  // A length the call has, or an invite gave, that isn't one of the usual ones, is offered too.
  const odd = [call?.minutes, Number(minutes)].filter(
    (each): each is number => Boolean(each) && !CALL_LENGTHS.includes(each as number),
  );
  const lengths = [...new Set([...CALL_LENGTHS, ...odd])].sort((a, b) => a - b);
  const known = peopleMet(job);
  // What an invite filled in, or why it couldn't, and whether one is being dragged over the form.
  const [invited, setInvited] = useState<string | null>(null);
  const [inviteProblem, setInviteProblem] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const picker = useRef<HTMLInputElement>(null);

  /** Fills in what an invite says: its date, time and length, where, and who it's with. */
  const fillFrom = async (files: readonly File[]) => {
    const file = files.find(isInviteFile) ?? files[0];
    if (!file) return;
    const invite = await inviteIn(file, me);
    const problem =
      typeof invite === 'string'
        ? invite
        : invite.canceled
          ? 'That invite calls the meeting off, so nothing was filled in.'
          : null;
    setInviteProblem(problem);
    if (typeof invite === 'string' || problem) {
      setInvited(null);
      return;
    }
    setOnDate(invite.onDate);
    if (invite.atTime) setAtTime(invite.atTime);
    if (invite.minutes) setMinutes(String(invite.minutes));
    if (invite.place) setPlace(invite.place);
    if (invite.online && !mode) setMode('video');
    if (invite.people.length > 0) setPeople((rows) => withPeople(rows, invite.people, known));
    setInvited(filledIn(invite));
  };
  const onDragOver = (event: DragEvent) => {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setOver(true);
  };

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
    <form
      className={`${styles.form} ${over ? styles.over : ''}`}
      aria-labelledby={titleId}
      onSubmit={submit}
      // An invite dropped on the form to add a call fills it in. The button does it from the
      // keyboard.
      {...(!call && {
        onDragOver,
        onDragLeave: () => setOver(false),
        onDrop: (event: DragEvent) => {
          event.preventDefault();
          setOver(false);
          void fillFrom([...event.dataTransfer.files]);
        },
      })}
    >
      <p id={titleId} className={styles.formTitle}>
        {call ? `Change ${callName(call)}` : 'Add a call'}
      </p>
      {!call && (
        <div className={styles.invite}>
          <Button
            size="sm"
            variant="quiet"
            icon={<FileUp size={13} aria-hidden="true" />}
            aria-describedby={inviteHintId}
            onClick={() => picker.current?.click()}
          >
            Fill in from an invite
          </Button>
          <span id={inviteHintId} className={styles.inviteHint}>
            or drop the invite’s .ics file here
          </span>
          <input
            ref={picker}
            type="file"
            className={styles.picker}
            tabIndex={-1}
            aria-hidden="true"
            accept=".ics,text/calendar"
            onChange={(event) => {
              void fillFrom([...(event.target.files ?? [])]);
              // The same file can be picked again.
              event.target.value = '';
            }}
          />
        </div>
      )}
      {/* Kept on the page, out of sight until there's something to say, so it's read aloud. */}
      <p className={invited ? styles.invited : styles.announce} role="status">
        {invited ?? ''}
      </p>
      <Problem message={inviteProblem} />
      <div className={styles.grid}>
        <Field label="Kind" className={styles.wide}>
          {(control) => (
            <Select
              {...control}
              ref={first}
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
            maxLength={Math.max(LIMITS.callNotes, notes.length)}
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

/**
 * How a call went, in the user's words, saved when the box loses focus. When another device
 * changed it meanwhile, its words stay too, after these.
 */
function Debrief({ jobId, call, api }: { jobId: string; call: Call; api: FactwrightApi }) {
  const saved = call.debrief ?? '';
  const [text, setText] = useState(debriefs.get(call.id)?.text ?? saved);
  const { problem, run } = useEdit();
  const id = useId();
  // A change from elsewhere, such as a sync, shows unless something's being typed here.
  useEffect(() => {
    if (!debriefs.has(call.id)) setText(saved);
  }, [call.id, saved]);
  const type = (value: string) => {
    setText(value);
    const base = debriefs.get(call.id)?.base ?? saved;
    if (value.trim() !== saved) debriefs.set(call.id, { jobId, text: value, base });
    else debriefs.delete(call.id);
  };
  const save = async () => {
    const draft = debriefs.get(call.id);
    if (!draft) return;
    const words = draft.text.trim();
    // Words another device saved since typing started, which these would otherwise replace.
    const theirs = saved !== draft.base && saved && !words.includes(saved) ? saved : '';
    const debrief = [words, theirs].filter(Boolean).join('\n\n') || null;
    if (await run(api.updateCall(call.id, { debrief }))) {
      // What was typed while it saved still waits to be saved.
      if (debriefs.get(call.id)?.text === draft.text) debriefs.delete(call.id);
      if (theirs) setText(debrief ?? '');
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
        maxLength={Math.max(LIMITS.debrief, text.length)}
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

/** A subject line, as the skill writes it, or close to it. */
const SUBJECT = /^(?:\*\*Subject:\*\*|\*\*Subject\*\*:|Subject:)[ \t]*(.+)$/m;

/**
 * The thank-you notes, one for each person, under a heading with their name, and anything said
 * before the first, such as who to send them through. No headings, no notes.
 */
export function thanksNotes(markdown: string): { intro: string; notes: ThanksNote[] } {
  const [before = '', ...parts] = markdown.split(/^## +/m);
  const notes = parts
    .map((part) => {
      const [first = '', ...rest] = part.split(/\r?\n/);
      const text = rest.join('\n');
      const subject = text.match(SUBJECT)?.[1]?.trim() ?? null;
      const body = text.replace(SUBJECT, '').trim();
      return { name: first.trim(), subject, body };
    })
    .filter((note) => note.name && note.body);
  return { intro: before.trim(), notes };
}

/**
 * A note's words to paste into an email: a link as its words and address, and bold as plain
 * words. Underscores stay, as in addresses and names.
 */
export const plainNote = (body: string) =>
  body
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_, words: string, url: string) =>
      words === url ? url : `${words} (${url})`,
    )
    .replace(/\*\*(.+?)\*\*/g, '$1');

/** The thank-you notes, each with buttons to copy its subject and its words. */
function ThanksNotes({ markdown, api }: { markdown: string; api: FactwrightApi }) {
  const [copied, setCopied] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const { intro, notes } = thanksNotes(markdown);
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
      {intro && <Markdown text={intro} />}
      {notes.map((note, i) => (
        <section key={i} className={styles.note} aria-label={`Note to ${note.name}`}>
          <h3 className={styles.noteName}>{note.name}</h3>
          {note.subject && (
            <p className={styles.subject}>
              <span className={styles.subjectText}>Subject: {note.subject}</span>
              <Button
                size="sm"
                variant="quiet"
                icon={<Copy size={13} aria-hidden="true" />}
                aria-label={
                  copied === `subject ${i}`
                    ? `Copied the subject for ${note.name}`
                    : `Copy the subject for ${note.name}`
                }
                onClick={() => copy(`subject ${i}`, note.subject ?? '')}
              >
                {copied === `subject ${i}` ? 'Copied' : 'Copy'}
              </Button>
            </p>
          )}
          <Markdown text={note.body} />
          <Button
            size="sm"
            icon={<Copy size={13} aria-hidden="true" />}
            aria-label={
              copied === `note ${i}`
                ? `Copied the note to ${note.name}`
                : `Copy note to ${note.name}`
            }
            onClick={() => copy(`note ${i}`, plainNote(note.body))}
          >
            {copied === `note ${i}` ? 'Copied' : 'Copy note'}
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
  onDeleted,
  now,
  reminders,
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
  /** Called once the call is deleted, so the keyboard's focus has somewhere to go. */
  onDeleted: () => void;
  /** The time of day now, as "HH:MM". */
  now: string;
  /** Reminders before calls, which the next call says will come, with a switch to turn them off. */
  reminders?: ReminderSwitch | undefined;
}) {
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // The call as its calendar file was saved, to say what to do with it until the call changes.
  const [savedAs, setSavedAs] = useState<string | null>(null);
  const saved = savedAs === fileFacts(job, call);
  const { problem, run: save } = useEdit();
  const change = useRef<HTMLButtonElement>(null);
  const remove = useRef<HTMLButtonElement>(null);
  // Where the keyboard's focus goes back to once the form or the question about deleting closes.
  const back = useRef<'change' | 'delete' | null>(null);
  useEffect(() => {
    if (editing || deleting || !back.current) return;
    (back.current === 'change' ? change : remove).current?.focus();
    back.current = null;
  }, [editing, deleting]);
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
  const link = callLink(call.place);
  // A calendar file for the call, saved where the user picks, to open in their calendar.
  const addToCalendar = async () => {
    setSavedAs(null);
    const facts = fileFacts(job, call);
    const file = callInvite(job, call, new Date());
    const result = file
      ? await api.saveFile(callInviteName(job.company, call), file)
      : ({
          ok: false,
          message: 'This call’s date can’t go in a calendar. Change it first.',
        } as const);
    await save(Promise.resolve(result));
    if (result.ok && result.saved) setSavedAs(facts);
  };
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
          onDone={() => {
            back.current = 'change';
            setEditing(false);
          }}
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
          ref={change}
          label={`Change ${name}`}
          variant="quiet"
          size="sm"
          icon={<Pencil size={13} aria-hidden="true" />}
          onClick={() => setEditing(true)}
        />
        <IconButton
          ref={remove}
          label={`Delete ${name}`}
          variant="quiet"
          size="sm"
          icon={<X size={14} aria-hidden="true" />}
          onClick={() => setDeleting(true)}
        />
      </div>
      {link && (
        <a className={styles.place} href={link.href} target="_blank" rel="noreferrer">
          <span className={styles.link}>Join at {link.shown}</span>
          <ArrowUpRight size={13} aria-hidden="true" />
        </a>
      )}
      {/* What else the place says, such as a passcode after the link, stays to read. */}
      {call.place && !link?.alone && <p className={styles.placeText}>{call.place}</p>}
      {call.people.length > 0 && <p className={styles.with}>With {callPeople(call.people)}</p>}
      {call.notes && <p className={styles.about}>{call.notes}</p>}

      {deleting && (
        <div className={styles.confirm}>
          <span>
            Delete {name}
            {call.debrief || docs.length > 0 ? ', with how it went and Claude’s work for it' : ''}?
          </span>
          <Button
            size="sm"
            onClick={() => {
              back.current = 'delete';
              setDeleting(false);
            }}
          >
            Keep it
          </Button>
          <Button
            size="sm"
            variant="primary"
            // The user just asked to delete it, so the choice to make takes the focus.
            autoFocus
            onClick={async () => {
              if (await save(api.deleteCall(call.id))) {
                debriefs.delete(call.id);
                onDeleted();
              }
            }}
          >
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
          <Button
            size="sm"
            variant="quiet"
            icon={<CalendarPlus size={13} aria-hidden="true" />}
            aria-label={`Add to calendar: ${name}`}
            onClick={addToCalendar}
          >
            Add to calendar
          </Button>
          {prep && (
            <span className={styles.docDate}>Prep from {shortDate(prep.modified, today)}</span>
          )}
          {/* Kept on the page, out of sight until the file's saved, so it's read aloud. */}
          <span className={saved ? styles.docDate : styles.announce} role="status">
            {saved ? 'Saved. Open the file to add the call to your calendar.' : ''}
          </span>
        </div>
      )}

      {reminders && next && reminderAhead(job, call, today, now) && (
        <p className={styles.reminder}>
          {reminders.on ? (
            <Bell size={13} aria-hidden="true" />
          ) : (
            <BellOff size={13} aria-hidden="true" />
          )}
          <span className={styles.reminderText}>
            {reminders.on
              ? 'Factwright reminds you an hour before, while it’s open.'
              : 'Reminders before calls are off.'}
          </span>
          <Button
            size="sm"
            variant="quiet"
            aria-label={
              reminders.on ? 'Turn off reminders before calls' : 'Turn on reminders before calls'
            }
            onClick={() => reminders.turn(!reminders.on)}
          >
            {reminders.on ? 'Turn off' : 'Turn on'}
          </Button>
        </p>
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
          <Debrief key={call.id} jobId={job.id} call={call} api={api} />
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
                      ? `Write again: the thank-you notes for ${name}`
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
  me,
  reminders,
}: {
  job: Job;
  progress: JobProgress;
  api: FactwrightApi;
  today: string;
  run?: RunControls | undefined;
  /** The user, whom an invite dropped on the form to add a call names among its people. */
  me?: InviteMe;
  /** Reminders before calls, and the switch to turn them off. */
  reminders?: ReminderSwitch | undefined;
}) {
  // The kind of call the add form starts on, while it's open.
  const [adding, setAdding] = useState<CallKind | null>(null);
  // Once the form closes, or a call goes, the keyboard's focus goes back to Add a call.
  const add = useRef<HTMLButtonElement>(null);
  const [refocus, setRefocus] = useState(false);
  useEffect(() => {
    if (!refocus || adding !== null) return;
    add.current?.focus();
    setRefocus(false);
  }, [refocus, adding]);
  // How a call went, typed for one of this job's calls that's gone since, as after a sync.
  useEffect(() => {
    for (const [callId, draft] of debriefs) {
      if (draft.jobId === job.id && !job.calls.some((call) => call.id === callId)) {
        debriefs.delete(callId);
      }
    }
  }, [job.id, job.calls]);
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
          <Button ref={add} size="sm" onClick={() => setAdding(nextKind(job, progress.status))}>
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
              onDeleted={() => setRefocus(true)}
              now={now}
              reminders={reminders}
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
          me={me}
          onDone={() => {
            setAdding(null);
            setRefocus(true);
          }}
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
